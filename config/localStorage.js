const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

// Root folder on the VPS where all uploaded images live.
// Served statically at `${ASSET_BASE_URL}/uploads/...` (see index.js).
const UPLOADS_ROOT = path.resolve(__dirname, "..", "uploads");

const DEFAULT_FOLDER = process.env.LOCAL_UPLOAD_FOLDER || "catalog";

// Absolute, public base URL of THIS backend (the VPS), used to build image URLs
// that are stored in the database and rendered by the frontend.
// e.g. https://api.asianimportexport.com
const getAssetBaseUrl = () => {
  const raw =
    process.env.ASSET_BASE_URL ||
    process.env.PUBLIC_BACKEND_URL ||
    process.env.BACKEND_URL ||
    `http://localhost:${process.env.PORT || 5000}`;
  return String(raw).trim().replace(/\/+$/, "");
};

// Map a common mime type to a file extension (fallback when the filename has none).
const extFromMime = (mime = "") => {
  const map = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/avif": ".avif",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
    "image/bmp": ".bmp",
    "image/tiff": ".tiff",
  };
  return map[String(mime).toLowerCase().split(";")[0].trim()] || "";
};

const slugifyBase = (value = "") =>
  String(value)
    .toLowerCase()
    .trim()
    .replace(/\.[a-z0-9]+$/i, "") // drop extension
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "image";

const resolveExtension = (originalname = "", mimetype = "") => {
  const fromName = path.extname(String(originalname || "")).toLowerCase();
  if (fromName && /^\.[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  const fromMime = extFromMime(mimetype);
  if (fromMime) return fromMime;
  return ".jpg";
};

// Build the public URL for a stored publicId (relative path incl. extension).
const buildUrlFromPublicId = (publicId = "") => {
  const clean = String(publicId || "").replace(/^\/+/, "");
  if (!clean) return "";
  return `${getAssetBaseUrl()}/uploads/${clean}`;
};

// Resolve a publicId to an absolute path on disk, guarding against path traversal.
const resolveDiskPath = (publicId = "") => {
  const clean = String(publicId || "").replace(/^\/+/, "");
  const target = path.resolve(UPLOADS_ROOT, clean);
  if (target !== UPLOADS_ROOT && !target.startsWith(UPLOADS_ROOT + path.sep)) {
    throw new Error("Invalid storage path");
  }
  return target;
};

/**
 * Persist a buffer to the VPS disk.
 * Returns a Cloudinary-like descriptor so callers barely change.
 * `public_id` is the relative path (incl. extension), which is also how we delete later.
 */
const saveBuffer = async (buffer, { originalname = "", mimetype = "", folder = DEFAULT_FOLDER } = {}) => {
  const safeFolder = String(folder || DEFAULT_FOLDER).replace(/[^a-z0-9/_-]/gi, "").replace(/^\/+|\/+$/g, "") || DEFAULT_FOLDER;
  const ext = resolveExtension(originalname, mimetype);
  const filename = `${slugifyBase(originalname)}-${Date.now()}-${crypto.randomBytes(5).toString("hex")}${ext}`;
  const relativePath = `${safeFolder}/${filename}`;

  const absoluteDir = path.join(UPLOADS_ROOT, safeFolder);
  await fsp.mkdir(absoluteDir, { recursive: true });
  await fsp.writeFile(path.join(absoluteDir, filename), buffer);

  return {
    public_id: relativePath,
    publicId: relativePath,
    url: buildUrlFromPublicId(relativePath),
    secure_url: buildUrlFromPublicId(relativePath),
    optimizedUrl: buildUrlFromPublicId(relativePath),
    resource_type: "image",
    format: ext.replace(/^\./, ""),
    bytes: buffer.length,
    width: 0,
    height: 0,
    folder: safeFolder,
    originalFilename: originalname,
  };
};

// Copy an existing local file (e.g. a bundled /assets/... source) into the uploads dir.
const saveLocalFile = async (sourcePath, { originalname = "", folder = DEFAULT_FOLDER } = {}) => {
  const buffer = await fsp.readFile(sourcePath);
  return saveBuffer(buffer, {
    originalname: originalname || path.basename(sourcePath),
    folder,
  });
};

// Remove a stored file. Safe no-op if it does not exist or publicId is empty/non-local.
const deleteFile = async (publicId = "") => {
  if (!publicId || /^https?:\/\//i.test(publicId)) return false;
  try {
    const target = resolveDiskPath(publicId);
    await fsp.unlink(target);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    throw error;
  }
};

// Ensure the uploads root exists at startup.
const ensureUploadsRoot = () => {
  try {
    fs.mkdirSync(UPLOADS_ROOT, { recursive: true });
  } catch (_error) {
    /* ignore */
  }
};

module.exports = {
  UPLOADS_ROOT,
  DEFAULT_FOLDER,
  getAssetBaseUrl,
  buildUrlFromPublicId,
  resolveDiskPath,
  saveBuffer,
  saveLocalFile,
  deleteFile,
  ensureUploadsRoot,
};
