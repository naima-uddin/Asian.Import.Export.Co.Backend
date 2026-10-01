/**
 * Migrate images referenced in the database from Cloudinary onto local
 * `public/uploads/` disk storage, preserving ORIGINAL full quality.
 *
 * THREE MODES — pick based on where you are in the rollout:
 *
 *   --download-only
 *       Download every ORIGINAL Cloudinary image into public/uploads/ at a
 *       DETERMINISTIC path and write a manifest. Does NOT touch the database.
 *       Use this NOW (before the VPS/domain is live) so the files are ready and
 *       can be committed to git. Safe: the live site keeps using Cloudinary.
 *
 *   --rewrite-db
 *       Read the manifest produced above and rewrite the DB URLs/publicIds to
 *       `${ASSET_BASE_URL}/uploads/...`. Does NOT re-download. Run this LATER,
 *       once api.asianimportexport.com is live and serving /uploads.
 *
 *   (no mode flag)  -> one-shot: download (random names) AND rewrite the DB in a
 *       single pass. Use on the live VPS when you want to do everything at once.
 *
 * Extra flags:  --dry (preview, no writes)   --all (migrate any remote URL, not just Cloudinary)
 *
 * Requires in .env:  MONGODB_URI
 *   --rewrite-db / one-shot also need:  ASSET_BASE_URL (e.g. https://api.asianimportexport.com)
 *   Uses if present:  CLOUDINARY_CLOUD_NAME (to rebuild original-quality URLs)
 *
 * Safe to re-run. Idempotent.
 */

require("dotenv").config();
const https = require("https");
const http = require("http");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const crypto = require("crypto");
const mongoose = require("mongoose");

const connectDB = require("../config/db");
const localStorage = require("../config/localStorage");
const MediaAsset = require("../models/MediaAsset");
const Product = require("../models/Product");
const Category = require("../models/Category");

const DRY_RUN = process.argv.includes("--dry");
const MIGRATE_ALL = process.argv.includes("--all");
const DOWNLOAD_ONLY = process.argv.includes("--download-only");
const REWRITE_DB = process.argv.includes("--rewrite-db");
const MODE = DOWNLOAD_ONLY ? "download" : REWRITE_DB ? "rewrite" : "oneshot";
const MAX_RETRIES = 3;

const ASSET_BASE = localStorage.getAssetBaseUrl();
const CLOUD_NAME = String(process.env.CLOUDINARY_CLOUD_NAME || "").trim();
const MANIFEST_PATH = path.join(localStorage.UPLOADS_ROOT, "migration-manifest.json");
const MIGRATION_FOLDER = "catalog";

const stats = {
  downloaded: 0,
  reused: 0,
  skippedLocal: 0,
  skippedEmpty: 0,
  failed: 0,
  mediaUpdated: 0,
  productsUpdated: 0,
  categoriesUpdated: 0,
  notInManifest: 0,
};

const isRemote = (u = "") => /^https?:\/\//i.test(String(u).trim());
const isAlreadyLocal = (u = "") => String(u || "").trim().startsWith(`${ASSET_BASE}/uploads/`);
const isCloudinary = (u = "") => /cloudinary\.com/i.test(String(u || ""));

const needsMigration = (u = "") => {
  const url = String(u || "").trim();
  if (!url) return false;
  if (!isRemote(url)) return false;
  if (isAlreadyLocal(url)) return false;
  if (MIGRATE_ALL) return true;
  return isCloudinary(url);
};

// Stable identity for an asset, used as the manifest key + dedupe key.
const assetKey = ({ publicId = "", url = "" }) => {
  const pid = String(publicId || "").trim();
  if (pid) return pid;
  return String(url || "").trim().split("?")[0]; // strip query
};

const MIME_EXT = {
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp",
  "image/avif": "avif", "image/gif": "gif", "image/svg+xml": "svg", "image/bmp": "bmp", "image/tiff": "tiff",
};
const extFromMime = (m = "") => MIME_EXT[String(m).toLowerCase().split(";")[0].trim()] || "";

// Turn a transformed Cloudinary delivery URL into its ORIGINAL (no transforms).
const stripCloudinaryTransforms = (u = "") => {
  const m = String(u).match(/^(https?:\/\/res\.cloudinary\.com\/[^/]+\/(?:image|video|raw)\/upload\/)(.*)$/i);
  if (!m) return u;
  const segments = m[2].split("/");
  while (segments.length > 1 && !/^v\d+$/i.test(segments[0]) && /(^|,)[a-z]{1,3}_/i.test(segments[0])) {
    segments.shift();
  }
  return m[1] + segments.join("/");
};

// Best candidate URLs for the ORIGINAL asset, most-reliable first.
const originalCandidates = ({ url = "", publicId = "", format = "" } = {}) => {
  const candidates = [];
  if (publicId && CLOUD_NAME && !isRemote(publicId)) {
    const base = `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/${publicId}`;
    if (format) candidates.push(`${base}.${format}`);
    candidates.push(base);
  }
  if (isCloudinary(url)) candidates.push(stripCloudinaryTransforms(url));
  if (url) candidates.push(url);
  return [...new Set(candidates.filter(Boolean))];
};

const downloadOnce = (urlString, redirects = 0) =>
  new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error("Too many redirects"));
    let parsed;
    try {
      parsed = new URL(urlString);
    } catch (error) {
      return reject(error);
    }
    const protocol = parsed.protocol === "https:" ? https : http;
    const basename = path.basename(parsed.pathname || "image.jpg") || "image.jpg";
    protocol
      .get(urlString, { timeout: 30000 }, (response) => {
        const { statusCode, headers } = response;
        if (statusCode >= 300 && statusCode < 400 && headers.location) {
          response.resume();
          return resolve(downloadOnce(new URL(headers.location, urlString).toString(), redirects + 1));
        }
        if (statusCode !== 200) {
          response.resume();
          return reject(new Error(`HTTP ${statusCode}`));
        }
        const chunks = [];
        response.on("data", (c) => chunks.push(c));
        response.on("end", () =>
          resolve({ buffer: Buffer.concat(chunks), filename: basename, mimetype: String(headers["content-type"] || "") }),
        );
        response.on("error", reject);
      })
      .on("timeout", function onTimeout() {
        this.destroy(new Error("Timeout"));
      })
      .on("error", reject);
  });

const downloadFirstAvailable = async (candidates) => {
  let lastError = null;
  for (const candidate of candidates) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        const result = await downloadOnce(candidate);
        if (result.buffer && result.buffer.length > 0) return { ...result, sourceUrl: candidate };
        lastError = new Error("Empty body");
      } catch (error) {
        lastError = error;
        if (attempt < MAX_RETRIES) await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
  }
  throw lastError || new Error("No candidates");
};

// ---- Deterministic local path (download + rewrite agree via the manifest) ----
const usedLocalIds = new Set();
const buildLocalPublicId = (key, ext) => {
  let leaf = String(key).split("/").pop().split("?")[0].replace(/[^a-z0-9_-]/gi, "").toLowerCase();
  if (!leaf) leaf = crypto.createHash("md5").update(String(key)).digest("hex").slice(0, 16);
  const safeExt = (ext || "jpg").replace(/^\./, "");
  let rel = `${MIGRATION_FOLDER}/${leaf}.${safeExt}`;
  if (usedLocalIds.has(rel)) {
    const h = crypto.createHash("md5").update(String(key)).digest("hex").slice(0, 6);
    rel = `${MIGRATION_FOLDER}/${leaf}-${h}.${safeExt}`;
  }
  usedLocalIds.add(rel);
  return rel;
};

// ---------- Collect every asset reference across the DB ----------
const collectReferences = async () => {
  const refs = []; // { source: {url, publicId, format}, apply: (localPublicId) => void (mutates doc), doc }
  const media = await MediaAsset.find({});
  const products = await Product.find({});
  const categories = await Category.find({});
  return { media, products, categories, refs };
};

// Build the set of unique sources that need migrating (for --download-only).
const gatherUniqueSources = ({ media, products, categories }) => {
  const map = new Map(); // key -> {url, publicId, format}
  const consider = (asset) => {
    if (!asset) return;
    const url = String(asset.url || "").trim();
    if (!url) {
      stats.skippedEmpty += 1;
      return;
    }
    if (!needsMigration(url)) {
      if (isAlreadyLocal(url)) stats.skippedLocal += 1;
      return;
    }
    const key = assetKey({ publicId: asset.publicId, url });
    if (!map.has(key)) {
      map.set(key, { url, publicId: String(asset.publicId || "").trim(), format: String(asset.format || "").trim() });
    }
  };
  media.forEach((m) => consider({ url: m.url || m.optimizedUrl, publicId: m.publicId, format: m.format }));
  products.forEach((p) => {
    consider(p.image);
    (p.images || []).forEach(consider);
  });
  categories.forEach((c) => {
    consider(c.image);
    (c.subcategories || []).forEach((s) => consider(s.image));
  });
  return map;
};

// =================== MODE: download-only ===================
const runDownloadOnly = async ({ media, products, categories }) => {
  const sources = gatherUniqueSources({ media, products, categories });
  console.log(`\nUnique Cloudinary images to download: ${sources.size}`);

  const manifest = { generatedAt: new Date().toISOString(), cloudName: CLOUD_NAME, entries: {} };
  // Reuse an existing manifest so re-runs don't re-download.
  if (fs.existsSync(MANIFEST_PATH)) {
    try {
      const prev = JSON.parse(await fsp.readFile(MANIFEST_PATH, "utf8"));
      Object.assign(manifest.entries, prev.entries || {});
      Object.values(manifest.entries).forEach((e) => e.localPublicId && usedLocalIds.add(e.localPublicId));
    } catch (_e) {
      /* ignore */
    }
  }

  let i = 0;
  for (const [key, source] of sources) {
    i += 1;
    const existing = manifest.entries[key];
    if (existing && existing.localPublicId && fs.existsSync(path.join(localStorage.UPLOADS_ROOT, existing.localPublicId))) {
      stats.reused += 1;
      continue;
    }
    try {
      const { buffer, mimetype } = await downloadFirstAvailable(originalCandidates(source));
      const ext = source.format || extFromMime(mimetype) || "jpg";
      const localPublicId = (existing && existing.localPublicId) || buildLocalPublicId(key, ext);
      if (!DRY_RUN) await localStorage.saveBufferAs(buffer, localPublicId);
      manifest.entries[key] = { localPublicId, format: ext, bytes: buffer.length };
      stats.downloaded += 1;
      if (i % 50 === 0) console.log(`  ...${i}/${sources.size}`);
    } catch (error) {
      stats.failed += 1;
      console.warn(`  FAILED: ${key}\n    -> ${error.message}`);
    }
  }

  if (!DRY_RUN) {
    await fsp.mkdir(path.dirname(MANIFEST_PATH), { recursive: true });
    await fsp.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
    console.log(`\nManifest written: ${MANIFEST_PATH} (${Object.keys(manifest.entries).length} entries)`);
  }
  console.log("\nDB was NOT modified. Files are in public/uploads/ — commit them, then run --rewrite-db once the VPS is live.");
};

// =================== MODE: rewrite-db ===================
const loadManifest = async () => {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`Manifest not found at ${MANIFEST_PATH}. Run --download-only first.`);
  }
  const parsed = JSON.parse(await fsp.readFile(MANIFEST_PATH, "utf8"));
  return parsed.entries || {};
};

const applyFromManifest = (asset, entries) => {
  if (!asset) return false;
  const url = String(asset.url || "").trim();
  if (!url || !needsMigration(url)) return false;
  const key = assetKey({ publicId: asset.publicId, url });
  const entry = entries[key];
  if (!entry || !entry.localPublicId) {
    stats.notInManifest += 1;
    console.warn(`  not in manifest: ${key}`);
    return false;
  }
  asset.url = localStorage.buildUrlFromPublicId(entry.localPublicId);
  asset.publicId = entry.localPublicId;
  if ("format" in asset && entry.format) asset.format = entry.format;
  if ("optimizedUrl" in asset) asset.optimizedUrl = asset.url;
  return true;
};

const runRewriteDb = async ({ media, products, categories }) => {
  const entries = await loadManifest();
  console.log(`\nManifest entries: ${Object.keys(entries).length}`);
  console.log(`Rewriting DB URLs to base: ${ASSET_BASE}`);

  for (const doc of media) {
    const fakeAsset = { url: doc.url || doc.optimizedUrl, publicId: doc.publicId, format: doc.format, optimizedUrl: doc.optimizedUrl };
    if (applyFromManifest(fakeAsset, entries)) {
      if (!DRY_RUN) {
        doc.url = fakeAsset.url;
        doc.optimizedUrl = fakeAsset.url;
        doc.publicId = fakeAsset.publicId;
        if (fakeAsset.format) doc.format = fakeAsset.format;
        doc.folder = MIGRATION_FOLDER;
        await doc.save();
      }
      stats.mediaUpdated += 1;
    }
  }
  for (const doc of products) {
    let changed = false;
    if (applyFromManifest(doc.image, entries)) changed = true;
    (doc.images || []).forEach((img) => {
      if (applyFromManifest(img, entries)) changed = true;
    });
    if (changed) {
      if (!DRY_RUN) {
        doc.markModified("image");
        doc.markModified("images");
        await doc.save();
      }
      stats.productsUpdated += 1;
    }
  }
  for (const doc of categories) {
    let changed = false;
    if (applyFromManifest(doc.image, entries)) changed = true;
    (doc.subcategories || []).forEach((s) => {
      if (applyFromManifest(s.image, entries)) changed = true;
    });
    if (changed) {
      if (!DRY_RUN) {
        doc.markModified("image");
        doc.markModified("subcategories");
        await doc.save();
      }
      stats.categoriesUpdated += 1;
    }
  }
};

// =================== MODE: one-shot (download + rewrite together) ===================
const cache = new Map();
const migrateAssetSource = async ({ url = "", publicId = "", format = "" }) => {
  const cacheKey = publicId || url;
  if (cache.has(cacheKey)) {
    stats.reused += 1;
    return cache.get(cacheKey);
  }
  const { buffer, filename, mimetype } = await downloadFirstAvailable(originalCandidates({ url, publicId, format }));
  let descriptor;
  if (DRY_RUN) {
    descriptor = { url: "[DRY]", publicId: "[dry]", format: "" };
  } else {
    const originalName = (publicId && path.basename(publicId)) || filename;
    const saved = await localStorage.saveBuffer(buffer, { originalname: originalName, mimetype });
    descriptor = { url: saved.url, publicId: saved.public_id, format: saved.format };
  }
  cache.set(cacheKey, descriptor);
  stats.downloaded += 1;
  return descriptor;
};
const migrateAsset = async (asset) => {
  if (!asset) return false;
  const current = String(asset.url || "").trim();
  if (!current) {
    stats.skippedEmpty += 1;
    return false;
  }
  if (!needsMigration(current)) {
    if (isAlreadyLocal(current)) stats.skippedLocal += 1;
    return false;
  }
  try {
    const next = await migrateAssetSource({ url: current, publicId: String(asset.publicId || "").trim(), format: String(asset.format || "").trim() });
    if (DRY_RUN) return true;
    asset.url = next.url;
    asset.publicId = next.publicId;
    if ("format" in asset && next.format) asset.format = next.format;
    if ("optimizedUrl" in asset) asset.optimizedUrl = next.url;
    return true;
  } catch (error) {
    stats.failed += 1;
    console.warn(`  FAILED: ${current}\n    -> ${error.message}`);
    return false;
  }
};
const runOneShot = async ({ media, products, categories }) => {
  for (const doc of media) {
    const src = String(doc.url || doc.optimizedUrl || "").trim();
    if (!needsMigration(src)) {
      if (isAlreadyLocal(src)) stats.skippedLocal += 1;
      continue;
    }
    try {
      const next = await migrateAssetSource({ url: src, publicId: String(doc.publicId || "").trim(), format: String(doc.format || "").trim() });
      if (!DRY_RUN) {
        doc.url = next.url;
        doc.optimizedUrl = next.url;
        doc.publicId = next.publicId;
        if (next.format) doc.format = next.format;
        doc.folder = MIGRATION_FOLDER;
        await doc.save();
      }
      stats.mediaUpdated += 1;
    } catch (error) {
      stats.failed += 1;
      console.warn(`  FAILED media: ${src}\n    -> ${error.message}`);
    }
  }
  for (const doc of products) {
    let changed = false;
    if (await migrateAsset(doc.image)) changed = true;
    for (const img of doc.images || []) if (await migrateAsset(img)) changed = true;
    if (changed) {
      if (!DRY_RUN) {
        doc.markModified("image");
        doc.markModified("images");
        await doc.save();
      }
      stats.productsUpdated += 1;
    }
  }
  for (const doc of categories) {
    let changed = false;
    if (await migrateAsset(doc.image)) changed = true;
    for (const s of doc.subcategories || []) if (await migrateAsset(s.image)) changed = true;
    if (changed) {
      if (!DRY_RUN) {
        doc.markModified("image");
        doc.markModified("subcategories");
        await doc.save();
      }
      stats.categoriesUpdated += 1;
    }
  }
};

// Verification: no remote URL should remain (only meaningful after a DB write).
const verifyNoneMissed = async () => {
  if (DRY_RUN || MODE === "download") return 0;
  const remaining = [];
  const check = (u, where) => {
    const url = String(u || "").trim();
    if (url && needsMigration(url)) remaining.push(`${where}: ${url}`);
  };
  for (const doc of await MediaAsset.find({}).lean()) check(doc.url, `MediaAsset ${doc._id}`);
  for (const doc of await Product.find({}).lean()) {
    check(doc.image?.url, `Product ${doc._id} image`);
    (doc.images || []).forEach((img, i) => check(img?.url, `Product ${doc._id} images[${i}]`));
  }
  for (const doc of await Category.find({}).lean()) {
    check(doc.image?.url, `Category ${doc._id} image`);
    (doc.subcategories || []).forEach((s, i) => check(s?.image?.url, `Category ${doc._id} sub[${i}]`));
  }
  if (remaining.length) {
    console.log("\n⚠  VERIFICATION: these references still point at a remote host:");
    remaining.forEach((l) => console.log(`   - ${l}`));
  } else {
    console.log("\n✓ VERIFICATION: no remote image references remain.");
  }
  return remaining.length;
};

const run = async () => {
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI is not set in .env — aborting.");
    process.exit(1);
  }
  console.log("=".repeat(64));
  console.log(`Mode            : ${MODE}${DRY_RUN ? " (DRY RUN)" : ""}`);
  console.log(`Target base URL : ${ASSET_BASE}`);
  console.log(`Cloudinary cloud: ${CLOUD_NAME || "(unknown)"}`);
  console.log(`Matching        : ${MIGRATE_ALL ? "ALL remote URLs" : "Cloudinary URLs only"}`);
  console.log(`Uploads root    : ${localStorage.UPLOADS_ROOT}`);
  console.log("=".repeat(64));

  await connectDB();
  localStorage.ensureUploadsRoot();

  const data = await collectReferences();
  console.log(`\nRecords: MediaAsset=${data.media.length}, Product=${data.products.length}, Category=${data.categories.length}`);

  if (MODE === "download") await runDownloadOnly(data);
  else if (MODE === "rewrite") await runRewriteDb(data);
  else await runOneShot(data);

  console.log("\n" + "=".repeat(64));
  console.log("Summary");
  console.log("=".repeat(64));
  console.table(stats);

  const missed = await verifyNoneMissed();

  await mongoose.connection.close();
  console.log("\nDone. MongoDB connection closed.");

  if (stats.failed > 0 || missed > 0 || stats.notInManifest > 0) {
    console.log(`\n⚠  failures=${stats.failed}, stillRemote=${missed}, notInManifest=${stats.notInManifest}. Re-run to retry (idempotent).`);
    process.exit(2);
  }
  process.exit(0);
};

run().catch(async (error) => {
  console.error("Migration crashed:", error);
  try {
    await mongoose.connection.close();
  } catch (_e) {
    /* ignore */
  }
  process.exit(1);
});
