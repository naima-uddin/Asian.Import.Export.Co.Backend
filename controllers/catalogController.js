const fs = require("fs/promises");
const path = require("path");
const mongoose = require("mongoose");
const multer = require("multer");
const https = require("https");
const http = require("http");
const url = require("url");
const Category = require("../models/Category");
const Product = require("../models/Product");
const MediaAsset = require("../models/MediaAsset");
const localStorage = require("../config/localStorage");

const upload = multer({ storage: multer.memoryStorage() });

const slugifyText = (value = "") =>
  String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";

const getFrontendCatalogPath = () =>
  path.resolve(__dirname, "..", "..", "Asian.Import.Export.Co.Frontend", "public", "categories.json");

const getFrontendAssetPath = (assetPath = "") =>
  path.resolve(
    __dirname,
    "..",
    "..",
    "Asian.Import.Export.Co.Frontend",
    "public",
    String(assetPath).replace(/^\//, "")
  );

const normalizeNumber = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value || "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

const toPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const buildPaging = (query = {}, { defaultLimit = 20, maxLimit = 100 } = {}) => {
  const page = toPositiveInt(query.page, 1);
  const requestedLimit = toPositiveInt(query.limit, defaultLimit);
  const limit = Math.max(1, Math.min(maxLimit, requestedLimit));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

const normalizeSourceId = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const normalizePricingTiers = (tiers = []) =>
  Array.isArray(tiers)
    ? tiers.map((tier) => ({
        minQuantity: tier?.minQuantity === null ? null : normalizeNumber(tier?.minQuantity ?? tier?.min ?? 0),
        maxQuantity:
          tier?.maxQuantity === null || tier?.max === null
            ? null
            : normalizeNumber(tier?.maxQuantity ?? tier?.max ?? 0),
        pricePerTire: tier?.pricePerTire ? String(tier.pricePerTire) : tier?.price ? String(tier.price) : "",
        note: tier?.note ? String(tier.note) : "",
      }))
    : [];

const normalizeReviews = (reviews = []) =>
  Array.isArray(reviews)
    ? reviews.map((review) => ({
        username: review?.username ? String(review.username) : review?.author ? String(review.author) : "",
        location: review?.location ? String(review.location) : "",
        rating: normalizeNumber(review?.rating ?? 0),
        date: review?.date ? String(review.date) : "",
        title: review?.title ? String(review.title) : "",
        text: review?.text ? String(review.text) : review?.comment ? String(review.comment) : "",
        verified: review?.verified === undefined ? false : Boolean(review.verified),
      }))
    : [];

// Keep stored image URLs host-agnostic: if a value is an absolute URL that points
// at our own `/uploads/...` path, strip the host so only the relative path is saved.
// External URLs (e.g. anything not under /uploads) are left untouched.
const relativizeLocalUrl = (value = "") => {
  const url = String(value || "").trim();
  if (!url) return "";
  const match = url.match(/^https?:\/\/[^/]+(\/uploads\/.+)$/i);
  return match ? match[1] : url;
};

const normalizeAsset = (asset = {}) => {
  if (typeof asset === "string") {
    return {
      url: relativizeLocalUrl(asset),
      publicId: "",
      alt: "",
      width: 0,
      height: 0,
      bytes: 0,
      format: "",
    };
  }

  return {
    url: asset?.url ? relativizeLocalUrl(asset.url) : "",
    publicId: asset?.publicId ? String(asset.publicId) : "",
    alt: asset?.alt ? String(asset.alt) : "",
    width: normalizeNumber(asset?.width ?? 0),
    height: normalizeNumber(asset?.height ?? 0),
    bytes: normalizeNumber(asset?.bytes ?? 0),
    format: asset?.format ? String(asset.format) : "",
  };
};

const uploadCatalogAsset = async (asset, fallbackName = "") => {
  const normalized = normalizeAsset(asset);
  const sourcePath = typeof asset === "string" ? asset : normalized.url;

  if (!sourcePath || normalized.publicId || !sourcePath.startsWith("/assets/")) {
    return normalized;
  }

  const localPath = getFrontendAssetPath(sourcePath);

  try {
    await fs.access(localPath);
    const uploaded = await localStorage.saveLocalFile(localPath, {
      originalname: fallbackName || path.basename(localPath),
    });

    return {
      url: uploaded.url,
      publicId: uploaded.public_id,
      alt: fallbackName,
      width: uploaded.width || 0,
      height: uploaded.height || 0,
      bytes: uploaded.bytes || 0,
      format: uploaded.format || "",
    };
  } catch (_error) {
    return normalized;
  }
};

const upsertImportedMediaAsset = async ({
  asset,
  originalFilename = "",
  relatedType = "",
  relatedId = "",
  metadata = {},
}) => {
  if (!asset?.publicId) return;

  await MediaAsset.findOneAndUpdate(
    { publicId: asset.publicId },
    {
      $set: {
        assetType: "image",
        format: asset.format || "",
        originalFilename: originalFilename || asset.alt || asset.publicId,
        url: asset.url || "",
        optimizedUrl: asset.url || "",
        bytes: asset.bytes || 0,
        width: asset.width || 0,
        height: asset.height || 0,
        folder: localStorage.DEFAULT_FOLDER,
        relatedType,
        relatedId: String(relatedId || ""),
        metadata,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

const normalizeProductPayload = (payload = {}) => {
  const resolvedSourceId = normalizeSourceId(payload.sourceId ?? payload.id);

  return {
    ...(resolvedSourceId !== undefined ? { sourceId: resolvedSourceId } : {}),
    name: String(payload.name || "").trim(),
    slug: String(payload.slug || slugifyText(payload.name)).trim(),
    category: payload.category,
    mainCategory: String(payload.mainCategory || payload.categoryName || "").trim(),
    subCategory: String(payload.subCategory || payload.subcategoryName || "").trim(),
    categoryName: String(payload.categoryName || "").trim(),
    categoryIcon: String(payload.categoryIcon || "").trim(),
    subcategoryId: normalizeNumber(payload.subcategoryId ?? payload.subcategory?.id ?? 0),
    subcategoryName: String(payload.subcategoryName || payload.subcategory?.name || "").trim(),
    subcategorySlug: String(payload.subcategorySlug || slugifyText(payload.subcategoryName || payload.subcategory?.name || "")).trim(),
    pattern: String(payload.pattern || payload.keyAttributes?.Pattern || "").trim(),
    brand: String(payload.brand || payload.keyAttributes?.Brand || "").trim(),
    price: String(payload.price || "").trim(),
    offerPrice: String(payload.offerPrice || "").trim(),
    pricingTiers: normalizePricingTiers(payload.pricingTiers),
    customizationOptions: Array.isArray(payload.customizationOptions) ? payload.customizationOptions.map((item) => String(item)) : [],
    shipping: String(payload.shipping || "").trim(),
    description: String(payload.description || "").trim(),
    image: normalizeAsset(payload.image || {}),
    images: Array.isArray(payload.images) ? payload.images.map((item) => normalizeAsset(item)) : [],
    keyAttributes: payload.keyAttributes || {},
    packagingAndDelivery: payload.packagingAndDelivery || {},
    priceSource: String(payload.priceSource || "").trim(),
    userReviews: normalizeReviews(payload.userReviews),
    tags: Array.isArray(payload.tags) ? payload.tags.map((tag) => String(tag)) : [],
    isFeatured: Boolean(payload.isFeatured),
    isActive: payload.isActive === undefined ? true : Boolean(payload.isActive),
    metadata: payload.metadata || {},
  };
};

const resolveExistingProductForImport = async (productPayload) => {
  const slug = String(productPayload.slug || "").trim();
  const sourceId = productPayload.sourceId;

  if (slug) {
    const existingBySlug = await Product.findOne({ slug });
    if (existingBySlug) {
      if (
        sourceId !== undefined
        && existingBySlug.sourceId !== undefined
        && Number(existingBySlug.sourceId) !== Number(sourceId)
      ) {
        delete productPayload.sourceId;
      }
      return existingBySlug;
    }
  }

  if (sourceId !== undefined) {
    const existingBySource = await Product.findOne({ sourceId });
    if (existingBySource) {
      if (slug && existingBySource.slug && existingBySource.slug !== slug) {
        delete productPayload.sourceId;
        return null;
      }
      return existingBySource;
    }
  }

  return null;
};

const normalizeSubcategories = (subcategories) => {
  // Handle null, undefined, or non-array values
  if (!subcategories) {
    return [];
  }

  // If it's a string (possibly JSON), try to parse it
  if (typeof subcategories === "string") {
    try {
      subcategories = JSON.parse(subcategories);
    } catch {
      return [];
    }
  }

  // Ensure it's an array
  if (!Array.isArray(subcategories)) {
    return [];
  }

  // Normalize each subcategory and filter out invalid ones
  return subcategories
    .map((subcategory, index) => {
      if (!subcategory || typeof subcategory !== "object") {
        return null;
      }

      // Extract name from various possible formats
      const name = String(subcategory.name || subcategory.title || "").trim();
      
      // Skip subcategories without a valid name
      if (!name) {
        return null;
      }

      return {
        id: normalizeNumber(subcategory.id ?? subcategory._id ?? index + 1),
        name,
        slug: String(subcategory.slug || slugifyText(name)).trim(),
        description: String(subcategory.description || "").trim(),
        displayOrder: normalizeNumber(subcategory.displayOrder ?? index),
        isActive: subcategory.isActive === undefined ? true : Boolean(subcategory.isActive),
        image: {
          url: relativizeLocalUrl(
            typeof subcategory.image === "string"
              ? subcategory.image
              : subcategory.image?.url || ""
          ),
          publicId: String(subcategory.image?.publicId || "").trim(),
        },
      };
    })
    .filter((subcategory) => subcategory !== null);
};

const normalizeCategoryPayload = (payload = {}) => ({
  sourceId: normalizeSourceId(payload.sourceId ?? payload.id),
  name: String(payload.name || "").trim(),
  slug: String(payload.slug || slugifyText(payload.name)).trim(),
  icon: String(payload.icon || "").trim(),
  description: String(payload.description || "").trim(),
  displayOrder: normalizeNumber(payload.displayOrder ?? 0),
  isActive: payload.isActive === undefined ? true : Boolean(payload.isActive),
  image: {
    url: relativizeLocalUrl(
      typeof payload.image === "string"
        ? payload.image
        : payload.image?.url || payload.heroImage || ""
    ),
    publicId: String(payload.image?.publicId || payload.heroImagePublicId || "").trim(),
  },
  subcategories: normalizeSubcategories(payload.subcategories),
  metadata: payload.metadata || {},
});

const mapCategory = (category) => ({
  id: category._id,
  sourceId: category.sourceId,
  name: category.name,
  slug: category.slug,
  icon: category.icon,
  description: category.description,
  displayOrder: category.displayOrder,
  isActive: category.isActive,
  image: category.image || { url: "", publicId: "" },
  subcategories: category.subcategories || [],
  metadata: category.metadata || {},
  createdAt: category.createdAt,
  updatedAt: category.updatedAt,
});

const mapProduct = (product) => ({
  id: product._id,
  sourceId: product.sourceId,
  name: product.name,
  slug: product.slug,
  category: product.category?._id || product.category,
  mainCategory: product.mainCategory || product.categoryName,
  subCategory: product.subCategory || product.subcategoryName,
  categoryName: product.categoryName,
  categoryIcon: product.categoryIcon,
  subcategoryId: product.subcategoryId,
  subcategoryName: product.subcategoryName,
  subcategorySlug: product.subcategorySlug,
  pattern: product.pattern || product.keyAttributes?.Pattern || "",
  brand: product.brand || product.keyAttributes?.Brand || "",
  price: product.price,
  offerPrice: product.offerPrice,
  pricingTiers: product.pricingTiers || [],
  customizationOptions: product.customizationOptions || [],
  shipping: product.shipping,
  description: product.description,
  image: product.image || { url: "", publicId: "" },
  images: product.images || [],
  keyAttributes: product.keyAttributes || {},
  packagingAndDelivery: product.packagingAndDelivery || {},
  priceSource: product.priceSource,
  userReviews: product.userReviews || [],
  tags: product.tags || [],
  isFeatured: product.isFeatured,
  isRecentPurchase: Boolean(product.isRecentPurchase),
  isActive: product.isActive,
  metadata: product.metadata || {},
  createdAt: product.createdAt,
  updatedAt: product.updatedAt,
});

const buildQuery = (query = {}) => {
  const clauses = [];

  if (query.search) {
    const regex = { $regex: String(query.search), $options: "i" };
    clauses.push({
      $or: [
        { name: regex },
        { slug: regex },
        { description: regex },
        { mainCategory: regex },
        { subCategory: regex },
        { pattern: regex },
        { "keyAttributes.Pattern": regex },
        { brand: regex },
        { "keyAttributes.Brand": regex },
        { categoryName: regex },
        { subcategoryName: regex },
      ],
    });
  }

  if (query.categoryId && mongoose.Types.ObjectId.isValid(query.categoryId)) {
    clauses.push({ category: query.categoryId });
  }

  if (query.category) {
    clauses.push({ categoryName: { $regex: String(query.category), $options: "i" } });
  }

  if (query.subcategoryId) {
    clauses.push({ subcategoryId: normalizeNumber(query.subcategoryId) });
  }

  if (query.subcategory) {
    clauses.push({ subcategoryName: { $regex: String(query.subcategory), $options: "i" } });
  }

  if (query.pattern) {
    const regex = { $regex: String(query.pattern), $options: "i" };
    clauses.push({ $or: [{ pattern: regex }, { "keyAttributes.Pattern": regex }] });
  }

  if (query.brand) {
    const regex = { $regex: String(query.brand), $options: "i" };
    clauses.push({ $or: [{ brand: regex }, { "keyAttributes.Brand": regex }] });
  }

  if (query.isActive !== undefined) {
    clauses.push({ isActive: query.isActive === "true" || query.isActive === true });
  }

  if (query.isRecentPurchase !== undefined) {
    const value = String(query.isRecentPurchase).toLowerCase();
    clauses.push({ isRecentPurchase: value === "true" || value === "1" || value === "yes" });
  }

  if (!clauses.length) return {};
  if (clauses.length === 1) return clauses[0];
  return { $and: clauses };
};

const syncProductCategoryFields = async (productPayload) => {
  const candidateCategoryId = productPayload.category && mongoose.Types.ObjectId.isValid(String(productPayload.category))
    ? String(productPayload.category)
    : "";

  if (!candidateCategoryId && !productPayload.mainCategory && !productPayload.categoryName) {
    return productPayload;
  }

  const category = candidateCategoryId
    ? await Category.findById(candidateCategoryId)
    : await Category.findOne({
        $or: [
          { name: productPayload.mainCategory },
          { slug: slugifyText(productPayload.mainCategory) },
          { name: productPayload.categoryName },
          { slug: slugifyText(productPayload.categoryName) },
        ],
      });

  if (!category) return productPayload;

  const subcategory = category.subcategories.find((item) => String(item.id) === String(productPayload.subcategoryId));

  return {
    ...productPayload,
    categoryName: category.name,
    categoryIcon: category.icon,
    mainCategory: category.name,
    subCategory: subcategory?.name || productPayload.subCategory || productPayload.subcategoryName,
    subcategoryName: subcategory?.name || productPayload.subcategoryName,
    subcategorySlug: subcategory?.slug || productPayload.subcategorySlug,
    category: category._id,
  };
};

const findProductByRouteId = async (routeId, { populate = false } = {}) => {
  const value = String(routeId || "").trim();
  if (!value) return null;

  const numericSourceId = Number.parseInt(value, 10);
  const candidates = [];

  if (mongoose.Types.ObjectId.isValid(value)) {
    candidates.push({ _id: value });
  }
  if (Number.isFinite(numericSourceId)) {
    candidates.push({ sourceId: numericSourceId });
  }
  if (!candidates.length) return null;

  let query = Product.findOne(candidates.length === 1 ? candidates[0] : { $or: candidates });
  if (populate) query = query.populate("category");
  return query;
};

// Store an uploaded buffer on the backend's local disk and return a Cloudinary-shaped descriptor.
const storeBufferToDisk = (buffer, filename, mimetype = "") =>
  localStorage.saveBuffer(buffer, { originalname: filename, mimetype });

const downloadUrlToBuffer = (urlString) =>
  new Promise((resolve, reject) => {
    try {
      const parsedUrl = url.parse(urlString);
      const protocol = parsedUrl.protocol === "https:" ? https : http;
      const basename = path.basename(parsedUrl.pathname || "image.jpg");

      protocol.get(urlString, { timeout: 10000 }, (response) => {
        if (response.statusCode !== 200) {
          return reject(new Error(`Failed to download URL: HTTP ${response.statusCode}`));
        }

        const mimetype = String(response.headers["content-type"] || "");
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve({ buffer: Buffer.concat(chunks), filename: basename, mimetype }));
        response.on("error", reject);
      }).on("timeout", () => {
        reject(new Error("Download request timed out"));
      });
    } catch (error) {
      reject(error);
    }
  });

const listCategories = async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const sortBy = String(req.query.sort || "main-asc").trim();
    const paginate = req.query.paginate === "true" || req.query.page || req.query.limit;
    const statusFilter = String(req.query.isActive || "all").trim().toLowerCase();

    const filter = {};

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { slug: { $regex: search, $options: "i" } },
        { "subcategories.name": { $regex: search, $options: "i" } },
      ];
    }

    if (statusFilter === "true" || statusFilter === "active") {
      filter.isActive = true;
    } else if (statusFilter === "false" || statusFilter === "inactive") {
      filter.isActive = false;
    }

    const sortStage =
      sortBy === "main-desc"
        ? { name: -1 }
        : sortBy === "sub-asc"
        ? { subcategoryCount: 1, name: 1 }
        : sortBy === "sub-desc"
        ? { subcategoryCount: -1, name: 1 }
        : { name: 1 };

    if (!paginate) {
      const categories = await Category.aggregate([
        { $match: filter },
        {
          $addFields: {
            subcategoryCount: { $size: { $ifNull: ["$subcategories", []] } },
          },
        },
        { $sort: sortStage },
      ]);
      return res.json({ success: true, categories: categories.map(mapCategory) });
    }

    const { page, limit, skip } = buildPaging(req.query, { defaultLimit: 20, maxLimit: 100 });

    const [categories, total] = await Promise.all([
      Category.aggregate([
        { $match: filter },
        {
          $addFields: {
            subcategoryCount: { $size: { $ifNull: ["$subcategories", []] } },
          },
        },
        { $sort: sortStage },
        { $skip: skip },
        { $limit: limit },
      ]),
      Category.countDocuments(filter),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    res.json({
      success: true,
      categories: categories.map(mapCategory),
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const createCategory = async (req, res) => {
  try {
    const payload = normalizeCategoryPayload(req.body);
    
    if (!payload.name) {
      return res.status(400).json({ success: false, message: "Category name is required" });
    }

    const exists = await Category.findOne({ $or: [{ slug: payload.slug }, { name: payload.name }] });
    if (exists) {
      return res.status(409).json({ success: false, message: "Category already exists" });
    }

    const category = await Category.create(payload);
    res.status(201).json({ success: true, category: mapCategory(category) });
  } catch (error) {
    console.error("Create category error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const payload = normalizeCategoryPayload(req.body);

    const category = await Category.findById(categoryId);
    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    category.name = payload.name || category.name;
    category.slug = payload.slug || category.slug;
    category.icon = payload.icon;
    category.description = payload.description;
    category.displayOrder = payload.displayOrder;
    category.isActive = payload.isActive;
    category.image = payload.image;
    
    // Only update subcategories if provided in request
    if (req.body.subcategories !== undefined) {
      category.subcategories = payload.subcategories;
    }
    
    category.metadata = payload.metadata;

    await category.save();
    res.json({ success: true, category: mapCategory(category) });
  } catch (error) {
    console.error("Update category error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteCategory = async (req, res) => {
  try {
    const category = await Category.findById(req.params.categoryId);
    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    await Product.deleteMany({ category: category._id });
    await category.deleteOne();
    res.json({ success: true, message: "Category deleted" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const listProducts = async (req, res) => {
  try {
    const filter = buildQuery(req.query);
    const { page, limit, skip } = buildPaging(req.query, { defaultLimit: 20, maxLimit: 100 });

    const sortBy = String(req.query.sort || "newest");
    let sort = { createdAt: -1 };
    if (sortBy === "name-asc") sort = { name: 1, createdAt: -1 };
    else if (sortBy === "name-desc") sort = { name: -1, createdAt: -1 };
    else if (sortBy === "brand-asc") sort = { brand: 1, name: 1 };
    else if (sortBy === "brand-desc") sort = { brand: -1, name: 1 };

    // Build separate filters for each facet that exclude that specific filter
    // This allows showing all available options even when a filter is selected
    const buildFacetFilter = (excludeField) => {
      const clauses = [];

      if (req.query.search) {
        const regex = { $regex: String(req.query.search), $options: "i" };
        clauses.push({
          $or: [
            { name: regex },
            { slug: regex },
            { description: regex },
            { mainCategory: regex },
            { subCategory: regex },
            { pattern: regex },
            { "keyAttributes.Pattern": regex },
            { brand: regex },
            { "keyAttributes.Brand": regex },
            { categoryName: regex },
            { subcategoryName: regex },
          ],
        });
      }

      if (req.query.categoryId && excludeField !== "categoryId" && mongoose.Types.ObjectId.isValid(req.query.categoryId)) {
        clauses.push({ category: req.query.categoryId });
      }

      if (req.query.category && excludeField !== "category") {
        clauses.push({ categoryName: { $regex: String(req.query.category), $options: "i" } });
      }

      if (req.query.subcategoryId && excludeField !== "subcategoryId") {
        clauses.push({ subcategoryId: normalizeNumber(req.query.subcategoryId) });
      }

      if (req.query.subcategory && excludeField !== "subcategory") {
        clauses.push({ subcategoryName: { $regex: String(req.query.subcategory), $options: "i" } });
      }

      if (req.query.pattern && excludeField !== "pattern") {
        const regex = { $regex: String(req.query.pattern), $options: "i" };
        clauses.push({ $or: [{ pattern: regex }, { "keyAttributes.Pattern": regex }] });
      }

      if (req.query.brand && excludeField !== "brand") {
        const regex = { $regex: String(req.query.brand), $options: "i" };
        clauses.push({ $or: [{ brand: regex }, { "keyAttributes.Brand": regex }] });
      }

      if (req.query.isActive !== undefined) {
        clauses.push({ isActive: req.query.isActive === "true" || req.query.isActive === true });
      }

      if (!clauses.length) return {};
      if (clauses.length === 1) return clauses[0];
      return { $and: clauses };
    };

    // Main filter for products
    // Facet filters for each option (exclude the specific facet to show all available values)
    const facetFilters = {
      brand: buildFacetFilter("brand"),
      category: buildFacetFilter("category"),
      subcategory: buildFacetFilter("subcategoryId"),
      pattern: buildFacetFilter("pattern"),
    };

    const [products, total, allCategories, brandsDirect, brandsFromAttributes, patternsDirect, patternsFromAttributes] = await Promise.all([
      Product.find(filter).sort(sort).skip(skip).limit(limit).populate("category"),
      Product.countDocuments(filter),
      Category.find({ isActive: true }).select("name subcategories").lean(),
      Product.distinct("brand", facetFilters.brand),
      Product.distinct("keyAttributes.Brand", facetFilters.brand),
      Product.distinct("pattern", facetFilters.pattern),
      Product.distinct("keyAttributes.Pattern", facetFilters.pattern),
    ]);

    // Build categoryMap: { categoryName: [subcategoryNames] }
    const categoryMap = {};
    allCategories.forEach((cat) => {
      const catName = String(cat.name || "").trim();
      if (catName) {
        categoryMap[catName] = (cat.subcategories || [])
          .map((sub) => String(sub.name || "").trim())
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b));
      }
    });

    // Extract all category names sorted
    const categories = Object.keys(categoryMap).sort((a, b) => a.localeCompare(b));

    // Extract all subcategory names (flat list for backward compatibility)
    const subcategories = Object.values(categoryMap)
      .flat()
      .filter((value, index, self) => self.indexOf(value) === index)
      .sort((a, b) => a.localeCompare(b));

    const totalPages = Math.max(1, Math.ceil(total / limit));
    const brands = Array.from(
      new Set(
        [...(brandsDirect || []), ...(brandsFromAttributes || [])]
          .map((value) => String(value || "").trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));

    const patterns = Array.from(
      new Set(
        [...(patternsDirect || []), ...(patternsFromAttributes || [])]
          .map((value) => String(value || "").trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));

    res.json({
      success: true,
      products: products.map(mapProduct),
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
      filters: {
        categories,
        subcategories,
        categoryMap,
        brands,
        patterns,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getProduct = async (req, res) => {
  try {
    const product = await findProductByRouteId(req.params.productId, { populate: true });
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    res.json({ success: true, product: mapProduct(product) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const createProduct = async (req, res) => {
  try {
    const payload = normalizeProductPayload(req.body);
    if (!payload.name) {
      return res.status(400).json({ success: false, message: "Product name is required" });
    }

    const resolvedPayload = await syncProductCategoryFields(payload);
    if (!resolvedPayload.category) {
      return res.status(400).json({ success: false, message: "Product main category is required" });
    }

    const product = await Product.create(resolvedPayload);
    res.status(201).json({ success: true, product: mapProduct(product) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateProduct = async (req, res) => {
  try {
    const product = await findProductByRouteId(req.params.productId);
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const payload = await syncProductCategoryFields(normalizeProductPayload(req.body));
    Object.assign(product, payload);
    await product.save();

    res.json({ success: true, product: mapProduct(product) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const setProductRecentPurchase = async (req, res) => {
  try {
    const product = await findProductByRouteId(req.params.productId);
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const value = req.body.isRecentPurchase;
    product.isRecentPurchase =
      value === true || String(value).toLowerCase() === "true";
    await product.save();

    res.json({ success: true, product: mapProduct(product) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteProduct = async (req, res) => {
  try {
    const product = await findProductByRouteId(req.params.productId);
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    await product.deleteOne();
    res.json({ success: true, message: "Product deleted" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const listMedia = async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const paginate = req.query.paginate === "true" || req.query.page || req.query.limit;
    const { page, limit, skip } = buildPaging(req.query, { defaultLimit: 24, maxLimit: 200 });
    const filter = search
      ? {
          $or: [
            { originalFilename: { $regex: search, $options: "i" } },
            { publicId: { $regex: search, $options: "i" } },
            { folder: { $regex: search, $options: "i" } },
          ],
        }
      : {};

    if (!paginate) {
      const media = await MediaAsset.find(filter).sort({ createdAt: -1 });
      return res.json({
        success: true,
        media,
        pagination: {
          page: 1,
          limit: media.length || 1,
          total: media.length,
          totalPages: 1,
          hasNextPage: false,
          hasPrevPage: false,
        },
      });
    }

    const [media, total] = await Promise.all([
      MediaAsset.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      MediaAsset.countDocuments(filter),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));
    res.json({
      success: true,
      media,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const uploadMedia = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "Image file is required" });
    }

    const uploaded = await storeBufferToDisk(req.file.buffer, req.file.originalname, req.file.mimetype);
    const metadata = req.body.metadata ? JSON.parse(req.body.metadata) : {};

    const media = await MediaAsset.create({
      publicId: uploaded.public_id,
      assetType: uploaded.resource_type || "image",
      format: uploaded.format || "",
      originalFilename: uploaded.originalFilename || req.file.originalname,
      url: uploaded.url,
      optimizedUrl: uploaded.optimizedUrl,
      bytes: uploaded.bytes || 0,
      width: uploaded.width || 0,
      height: uploaded.height || 0,
      folder: uploaded.folder || localStorage.DEFAULT_FOLDER,
      relatedType: req.body.relatedType || "",
      relatedId: req.body.relatedId || "",
      uploadedBy: {
        id: String(req.authUser?._id || req.authUser?.id || ""),
        name: String(req.authUser?.fullName || ""),
        role: String(req.authUser?.role || ""),
        email: String(req.authUser?.email || ""),
      },
      metadata,
    });

    res.status(201).json({ success: true, media });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const uploadMediaFromUrl = async (req, res) => {
  try {
    const imageUrl = String(req.body.url || "").trim();
    if (!imageUrl) {
      return res.status(400).json({ success: false, message: "Image URL is required" });
    }

    // Validate URL format
    try {
      new url.URL(imageUrl);
    } catch (_error) {
      return res.status(400).json({ success: false, message: "Invalid URL format" });
    }

    // Download URL to buffer
    const { buffer, filename, mimetype } = await downloadUrlToBuffer(imageUrl);

    // Store buffer on the backend's local disk
    const uploaded = await storeBufferToDisk(buffer, filename, mimetype);
    const metadata = req.body.metadata ? JSON.parse(req.body.metadata) : {};

    // Create media record
    const media = await MediaAsset.create({
      publicId: uploaded.public_id,
      assetType: uploaded.resource_type || "image",
      format: uploaded.format || "",
      originalFilename: uploaded.originalFilename || filename,
      url: uploaded.url,
      optimizedUrl: uploaded.optimizedUrl,
      bytes: uploaded.bytes || 0,
      width: uploaded.width || 0,
      height: uploaded.height || 0,
      folder: uploaded.folder || localStorage.DEFAULT_FOLDER,
      relatedType: req.body.relatedType || "",
      relatedId: req.body.relatedId || "",
      uploadedBy: {
        id: String(req.authUser?._id || req.authUser?.id || ""),
        name: String(req.authUser?.fullName || ""),
        role: String(req.authUser?.role || ""),
        email: String(req.authUser?.email || ""),
      },
      metadata: {
        ...metadata,
        sourceUrl: imageUrl,
      },
    });

    res.status(201).json({ success: true, media });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteMedia = async (req, res) => {
  try {
    const publicId = decodeURIComponent(req.params.publicId);
    const media = await MediaAsset.findOne({ publicId });

    if (!media) {
      return res.status(404).json({ success: false, message: "Media not found" });
    }

    await localStorage.deleteFile(publicId);
    await MediaAsset.deleteOne({ publicId });

    await Product.updateMany(
      { $or: [{ "image.publicId": publicId }, { "images.publicId": publicId }] },
      {
        $set: {
          "image.url": "",
          "image.publicId": "",
        },
        $pull: { images: { publicId } },
      }
    );

    await Category.updateMany(
      { "image.publicId": publicId },
      {
        $set: {
          "image.url": "",
          "image.publicId": "",
        },
      }
    );

    res.json({ success: true, message: "Media deleted" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const importCatalogFromJson = async (_req, res) => {
  try {
    const catalogPath = getFrontendCatalogPath();
    const raw = await fs.readFile(catalogPath, "utf8");
    const parsed = JSON.parse(raw);
    const categories = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.categories) ? parsed.categories : [];

    let categoryCount = 0;
    let productCount = 0;

    for (const sourceCategory of categories) {
      const categoryPayload = normalizeCategoryPayload(sourceCategory);
      categoryPayload.image = await uploadCatalogAsset(sourceCategory.image || sourceCategory.heroImage || "", sourceCategory.name);
      const category = await Category.findOneAndUpdate(
        { sourceId: categoryPayload.sourceId || sourceCategory.id, slug: categoryPayload.slug },
        { $set: categoryPayload },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      await upsertImportedMediaAsset({
        asset: categoryPayload.image,
        originalFilename: sourceCategory.name,
        relatedType: "category-image",
        relatedId: category._id,
        metadata: { source: "catalog-import", categoryName: category.name },
      });

      categoryCount += 1;

      for (const sourceSubcategory of sourceCategory.subcategories || []) {
        for (const sourceProduct of sourceSubcategory.products || []) {
          const productPayload = normalizeProductPayload({
            ...sourceProduct,
            category: category._id,
            mainCategory: category.name,
            categoryName: category.name,
            categoryIcon: category.icon,
            subcategoryId: sourceSubcategory.id,
            subcategoryName: sourceSubcategory.name,
            subCategory: sourceSubcategory.name,
            subcategorySlug: slugifyText(sourceSubcategory.name),
          });

          productPayload.image = await uploadCatalogAsset(sourceProduct.image || "", sourceProduct.name);
          productPayload.images = await Promise.all(
            (sourceProduct.images || []).map((asset, index) =>
              uploadCatalogAsset(asset, `${sourceProduct.name} ${index + 1}`)
            )
          );

          const existingProduct = await resolveExistingProductForImport(productPayload);
          let product;
          if (existingProduct) {
            Object.assign(existingProduct, productPayload);
            product = await existingProduct.save();
          } else {
            product = await Product.create(productPayload);
          }

          await upsertImportedMediaAsset({
            asset: productPayload.image,
            originalFilename: sourceProduct.name,
            relatedType: "product-image",
            relatedId: product._id,
            metadata: {
              source: "catalog-import",
              categoryName: category.name,
              subcategoryName: sourceSubcategory.name,
              productName: sourceProduct.name,
            },
          });

          for (const [index, galleryAsset] of (productPayload.images || []).entries()) {
            await upsertImportedMediaAsset({
              asset: galleryAsset,
              originalFilename: `${sourceProduct.name} ${index + 1}`,
              relatedType: "product-gallery",
              relatedId: product._id,
              metadata: {
                source: "catalog-import",
                categoryName: category.name,
                subcategoryName: sourceSubcategory.name,
                productName: sourceProduct.name,
                index,
              },
            });
          }

          productCount += 1;
        }
      }
    }

    if (!categories.length && Array.isArray(parsed?.products)) {
      for (const sourceProduct of parsed.products) {
        const productPayload = normalizeProductPayload(sourceProduct);
        if (!productPayload.name) continue;

        productPayload.image = await uploadCatalogAsset(sourceProduct.image || "", sourceProduct.name);
        productPayload.images = await Promise.all(
          (sourceProduct.images || []).map((asset, index) =>
            uploadCatalogAsset(asset, `${sourceProduct.name} ${index + 1}`)
          )
        );

        const category = await Category.findOne({
          $or: [
            { name: sourceProduct.mainCategory },
            { slug: slugifyText(sourceProduct.mainCategory) },
          ],
        });

        if (category) {
          productPayload.category = category._id;
          productPayload.mainCategory = category.name;
          productPayload.categoryName = category.name;
          productPayload.categoryIcon = category.icon;

          const subcategory = category.subcategories.find((item) => item.name === sourceProduct.subCategory || item.name === sourceProduct.subcategoryName);
          productPayload.subcategoryId = subcategory?.id || productPayload.subcategoryId || 0;
          productPayload.subcategoryName = subcategory?.name || productPayload.subCategory || productPayload.subcategoryName;
          productPayload.subCategory = subcategory?.name || productPayload.subCategory || productPayload.subcategoryName;
          productPayload.subcategorySlug = subcategory?.slug || productPayload.subcategorySlug || slugifyText(productPayload.subcategoryName);
        }

        const existingProduct = await resolveExistingProductForImport(productPayload);
        let product;
        if (existingProduct) {
          Object.assign(existingProduct, productPayload);
          product = await existingProduct.save();
        } else {
          product = await Product.create(productPayload);
        }

        await upsertImportedMediaAsset({
          asset: productPayload.image,
          originalFilename: sourceProduct.name,
          relatedType: "product-image",
          relatedId: product._id,
          metadata: {
            source: "catalog-import",
            categoryName: productPayload.categoryName,
            subcategoryName: productPayload.subcategoryName,
            productName: sourceProduct.name,
          },
        });

        for (const [index, galleryAsset] of (productPayload.images || []).entries()) {
          await upsertImportedMediaAsset({
            asset: galleryAsset,
            originalFilename: `${sourceProduct.name} ${index + 1}`,
            relatedType: "product-gallery",
            relatedId: product._id,
            metadata: {
              source: "catalog-import",
              categoryName: productPayload.categoryName,
              subcategoryName: productPayload.subcategoryName,
              productName: sourceProduct.name,
              index,
            },
          });
        }

        productCount += 1;
      }
    }

    res.json({ success: true, message: "Catalog imported from JSON", categoryCount, productCount });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  uploadMiddleware: upload.single("file"),
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  setProductRecentPurchase,
  deleteProduct,
  listMedia,
  uploadMedia,
  uploadMediaFromUrl,
  deleteMedia,
  importCatalogFromJson,
  normalizeCategoryPayload,
  normalizeSubcategories,
  normalizeProductPayload,
  mapCategory,
  mapProduct,
};