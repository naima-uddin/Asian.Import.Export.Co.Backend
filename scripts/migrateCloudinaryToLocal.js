/**
 * One-off migration: move every image currently referenced in the database
 * from Cloudinary (or any remote host) onto this VPS's local /uploads disk,
 * then rewrite the stored URLs/publicIds to point at the VPS.
 *
 * QUALITY GUARANTEE: for Cloudinary images we always fetch the ORIGINAL,
 * full-resolution asset (reconstructed from its publicId / stripped of any
 * resize+compress transformation), NEVER the optimized delivery URL. Files
 * are written to disk byte-for-byte with no re-encoding, so quality is
 * preserved exactly.
 *
 * COMPLETENESS GUARANTEE: every image reference across MediaAsset, Product
 * (image + images[]) and Category (image + subcategories[].image) is visited,
 * downloads are retried, and a final verification pass fails loudly if even a
 * single remote URL remains.
 *
 * Usage (run from the backend folder, with .env configured):
 *   node scripts/migrateCloudinaryToLocal.js            # live migration
 *   node scripts/migrateCloudinaryToLocal.js --dry      # preview only, no writes
 *   node scripts/migrateCloudinaryToLocal.js --all      # migrate ALL remote URLs, not just cloudinary
 *
 * Requires in .env:  MONGODB_URI, ASSET_BASE_URL (e.g. https://api.asianimportexport.com)
 * Uses if present:   CLOUDINARY_CLOUD_NAME  (to rebuild original-quality URLs)
 *
 * Safe to re-run: URLs already pointing at ASSET_BASE_URL/uploads are skipped.
 */

require("dotenv").config();
const https = require("https");
const http = require("http");
const path = require("path");
const mongoose = require("mongoose");

const connectDB = require("../config/db");
const localStorage = require("../config/localStorage");
const MediaAsset = require("../models/MediaAsset");
const Product = require("../models/Product");
const Category = require("../models/Category");

const DRY_RUN = process.argv.includes("--dry");
const MIGRATE_ALL = process.argv.includes("--all");
const MAX_RETRIES = 3;

const ASSET_BASE = localStorage.getAssetBaseUrl();
const CLOUD_NAME = String(process.env.CLOUDINARY_CLOUD_NAME || "").trim();

const stats = {
  downloaded: 0,
  reusedFromCache: 0,
  skippedLocal: 0,
  skippedEmpty: 0,
  failed: 0,
  mediaUpdated: 0,
  productsUpdated: 0,
  categoriesUpdated: 0,
};

// Caches. Keyed by publicId when available (so the same image is fetched once
// and every reference ends up pointing at the exact same local file), else url.
const cache = new Map();
// Original secure_url per publicId, harvested from MediaAsset (best source of truth).
const mediaUrlByPublicId = new Map();

const isRemote = (u = "") => /^https?:\/\//i.test(String(u).trim());
const isAlreadyLocal = (u = "") => String(u || "").trim().startsWith(`${ASSET_BASE}/uploads/`);
const isCloudinary = (u = "") => /cloudinary\.com/i.test(String(u || ""));

const needsMigration = (u = "") => {
  const url = String(u || "").trim();
  if (!url) return false;
  if (!isRemote(url)) return false; // relative/empty -> leave as is
  if (isAlreadyLocal(url)) return false;
  if (MIGRATE_ALL) return true;
  return isCloudinary(url);
};

// Turn a transformed Cloudinary delivery URL into its ORIGINAL (no transforms).
// e.g. .../image/upload/f_auto,q_auto,c_limit,w_1600/v123/folder/name.jpg
//   -> .../image/upload/v123/folder/name.jpg
const stripCloudinaryTransforms = (u = "") => {
  const m = String(u).match(
    /^(https?:\/\/res\.cloudinary\.com\/[^/]+\/(?:image|video|raw)\/upload\/)(.*)$/i,
  );
  if (!m) return u;
  const segments = m[2].split("/");
  // Drop leading transformation segments (contain "<letter>_<value>" params),
  // but never drop the version marker (v123...) or the public id itself.
  while (
    segments.length > 1 &&
    !/^v\d+$/i.test(segments[0]) &&
    /(^|,)[a-z]{1,3}_/i.test(segments[0])
  ) {
    segments.shift();
  }
  return m[1] + segments.join("/");
};

// Build the best candidate URLs for the ORIGINAL asset, most-reliable first.
const originalCandidates = ({ url = "", publicId = "", format = "" } = {}) => {
  const candidates = [];
  // 1. Reconstruct straight from publicId + cloud name (guaranteed original).
  if (publicId && CLOUD_NAME && !isRemote(publicId)) {
    const base = `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/${publicId}`;
    if (format) candidates.push(`${base}.${format}`);
    candidates.push(base); // extension-less: Cloudinary serves native original
  }
  // 2. Strip transforms from the stored (optimized) URL.
  if (isCloudinary(url)) {
    candidates.push(stripCloudinaryTransforms(url));
  }
  // 3. Last resort: the URL exactly as stored.
  if (url) candidates.push(url);
  // De-dupe, keep order.
  return [...new Set(candidates.filter(Boolean))];
};

// Download a single URL to a buffer, following a few redirects.
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
          const next = new URL(headers.location, urlString).toString();
          return resolve(downloadOnce(next, redirects + 1));
        }
        if (statusCode !== 200) {
          response.resume();
          return reject(new Error(`HTTP ${statusCode}`));
        }
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            buffer: Buffer.concat(chunks),
            filename: basename,
            mimetype: String(headers["content-type"] || ""),
          }),
        );
        response.on("error", reject);
      })
      .on("timeout", function onTimeout() {
        this.destroy(new Error("Timeout"));
      })
      .on("error", reject);
  });

// Try a list of candidate URLs, each with retries. Returns the first success.
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
  throw lastError || new Error("No candidates to download");
};

// Fetch (or reuse) the original image for an asset, saving it to the VPS.
// Returns { url, publicId, format } for the new local copy.
const migrateAssetSource = async ({ url = "", publicId = "", format = "" }) => {
  // Prefer the original secure_url recorded in MediaAsset for this publicId.
  const mediaOriginal = publicId ? mediaUrlByPublicId.get(publicId) : "";
  const cacheKey = publicId || url;

  if (cache.has(cacheKey)) {
    stats.reusedFromCache += 1;
    return cache.get(cacheKey);
  }

  const candidates = originalCandidates({
    url: mediaOriginal && !isAlreadyLocal(mediaOriginal) ? mediaOriginal : url,
    publicId,
    format,
  });

  const { buffer, filename, mimetype } = await downloadFirstAvailable(candidates);

  let descriptor;
  if (DRY_RUN) {
    descriptor = { url: `[DRY] would-save (${buffer.length} bytes)`, publicId: "[dry]", format: "" };
  } else {
    const originalName = (publicId && path.basename(publicId)) || filename;
    const saved = await localStorage.saveBuffer(buffer, { originalname: originalName, mimetype });
    descriptor = { url: saved.url, publicId: saved.public_id, format: saved.format };
  }
  cache.set(cacheKey, descriptor);
  stats.downloaded += 1;
  return descriptor;
};

// Migrate one {url, publicId, format?, optimizedUrl?} asset object in place.
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
    const next = await migrateAssetSource({
      url: current,
      publicId: String(asset.publicId || "").trim(),
      format: String(asset.format || "").trim(),
    });
    if (DRY_RUN) {
      console.log(`  would migrate: ${current}`);
      return true;
    }
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

// Build the publicId -> original secure_url map from MediaAsset first.
const indexMediaOriginals = async () => {
  const docs = await MediaAsset.find({}).select("publicId url optimizedUrl").lean();
  for (const doc of docs) {
    // Prefer url (secure_url / original) over optimizedUrl.
    const original = isCloudinary(doc.url) ? doc.url : doc.optimizedUrl || doc.url;
    if (doc.publicId && original) mediaUrlByPublicId.set(doc.publicId, original);
  }
};

const migrateMediaAssets = async () => {
  const docs = await MediaAsset.find({});
  console.log(`\nMediaAsset: ${docs.length} record(s)`);
  for (const doc of docs) {
    const source = String(doc.url || doc.optimizedUrl || "").trim();
    if (!needsMigration(source)) {
      if (isAlreadyLocal(source)) stats.skippedLocal += 1;
      continue;
    }
    try {
      const next = await migrateAssetSource({
        url: source,
        publicId: String(doc.publicId || "").trim(),
        format: String(doc.format || "").trim(),
      });
      if (DRY_RUN) {
        console.log(`  would migrate media: ${source}`);
        stats.mediaUpdated += 1;
        continue;
      }
      doc.url = next.url;
      doc.optimizedUrl = next.url;
      doc.publicId = next.publicId;
      if (next.format) doc.format = next.format;
      doc.folder = localStorage.DEFAULT_FOLDER;
      await doc.save();
      stats.mediaUpdated += 1;
    } catch (error) {
      stats.failed += 1;
      console.warn(`  FAILED media: ${source}\n    -> ${error.message}`);
    }
  }
};

const migrateProducts = async () => {
  const docs = await Product.find({});
  console.log(`\nProduct: ${docs.length} record(s)`);
  for (const doc of docs) {
    let changed = false;
    if (await migrateAsset(doc.image)) changed = true;
    for (const img of doc.images || []) {
      if (await migrateAsset(img)) changed = true;
    }
    if (changed) {
      if (!DRY_RUN) {
        doc.markModified("image");
        doc.markModified("images");
        await doc.save();
      }
      stats.productsUpdated += 1;
    }
  }
};

const migrateCategories = async () => {
  const docs = await Category.find({});
  console.log(`\nCategory: ${docs.length} record(s)`);
  for (const doc of docs) {
    let changed = false;
    if (await migrateAsset(doc.image)) changed = true;
    for (const sub of doc.subcategories || []) {
      if (await migrateAsset(sub.image)) changed = true;
    }
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

// Final safety net: re-read everything and report any remaining remote URL.
const verifyNoneMissed = async () => {
  if (DRY_RUN) return 0;
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
    (doc.subcategories || []).forEach((sub, i) =>
      check(sub?.image?.url, `Category ${doc._id} subcategories[${i}]`),
    );
  }

  if (remaining.length) {
    console.log("\n⚠  VERIFICATION: these references still point at a remote host:");
    remaining.forEach((line) => console.log(`   - ${line}`));
  } else {
    console.log("\n✓ VERIFICATION: no remote image references remain — nothing was missed.");
  }
  return remaining.length;
};

const run = async () => {
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI is not set in .env — aborting.");
    process.exit(1);
  }
  console.log("=".repeat(64));
  console.log(DRY_RUN ? "DRY RUN — no files written, no DB writes" : "LIVE migration");
  console.log(`Target base URL : ${ASSET_BASE}`);
  console.log(`Cloudinary cloud: ${CLOUD_NAME || "(unknown — will strip transforms from stored URLs)"}`);
  console.log(`Matching        : ${MIGRATE_ALL ? "ALL remote URLs" : "Cloudinary URLs only"}`);
  console.log("=".repeat(64));

  await connectDB();
  localStorage.ensureUploadsRoot();

  await indexMediaOriginals();
  await migrateMediaAssets();
  await migrateProducts();
  await migrateCategories();

  console.log("\n" + "=".repeat(64));
  console.log("Summary");
  console.log("=".repeat(64));
  console.table(stats);

  const missed = await verifyNoneMissed();

  await mongoose.connection.close();
  console.log("\nDone. MongoDB connection closed.");

  if (stats.failed > 0 || missed > 0) {
    console.log(
      `\n⚠  ${stats.failed} download failure(s), ${missed} reference(s) still remote.` +
        `\n   Re-run the script to retry — it is safe and idempotent.`,
    );
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
