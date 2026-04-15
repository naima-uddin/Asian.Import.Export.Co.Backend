const mongoose = require("mongoose");
const Category = require("../models/Category");
const Product = require("../models/Product");

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

const slugifyText = (value = "") =>
  String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";

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

// ─────────────────────────────────────────────────────────────────────────────
// SUBCATEGORY NORMALIZATION - FIXED VERSION
// ─────────────────────────────────────────────────────────────────────────────

const normalizeSubcategory = (subcategory, index) => {
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
      url: String(
        typeof subcategory.image === "string"
          ? subcategory.image
          : subcategory.image?.url || ""
      ).trim(),
      publicId: String(subcategory.image?.publicId || "").trim(),
    },
  };
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
    .map((subcategory, index) => normalizeSubcategory(subcategory, index))
    .filter((subcategory) => subcategory !== null);
};

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY PAYLOAD NORMALIZATION
// ─────────────────────────────────────────────────────────────────────────────

const normalizeCategoryPayload = (payload = {}) => {
  const name = String(payload.name || "").trim();
  const subcategories = normalizeSubcategories(payload.subcategories);

  return {
    sourceId: normalizeSourceId(payload.sourceId ?? payload.id),
    name,
    slug: String(payload.slug || slugifyText(name)).trim(),
    icon: String(payload.icon || "").trim(),
    description: String(payload.description || "").trim(),
    displayOrder: normalizeNumber(payload.displayOrder ?? 0),
    isActive: payload.isActive === undefined ? true : Boolean(payload.isActive),
    image: {
      url: String(
        typeof payload.image === "string"
          ? payload.image
          : payload.image?.url || payload.heroImage || ""
      ).trim(),
      publicId: String(payload.image?.publicId || payload.heroImagePublicId || "").trim(),
    },
    subcategories,
    metadata: payload.metadata || {},
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY MAPPING FOR RESPONSE
// ─────────────────────────────────────────────────────────────────────────────

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
  subcategories: (category.subcategories || []).map((sub) => ({
    id: sub.id,
    name: sub.name,
    slug: sub.slug,
    description: sub.description,
    displayOrder: sub.displayOrder,
    isActive: sub.isActive,
    image: sub.image || { url: "", publicId: "" },
    createdAt: sub.createdAt,
    updatedAt: sub.updatedAt,
  })),
  subcategoryCount: (category.subcategories || []).length,
  metadata: category.metadata || {},
  createdAt: category.createdAt,
  updatedAt: category.updatedAt,
});

const mapPublicProduct = (product) => {
  const productId = product.sourceId ?? product._id;
  const imageUrl = typeof product.image === "string" ? product.image : product.image?.url || "";

  return {
    id: productId,
    sourceId: product.sourceId,
    dbId: product._id,
    name: product.name,
    slug: product.slug,
    category: product.category?._id || product.category,
    categoryName: product.categoryName || product.mainCategory || "",
    categoryIcon: product.categoryIcon || "",
    subcategoryId: product.subcategoryId,
    subcategoryName: product.subcategoryName || product.subCategory || "",
    subcategorySlug: product.subcategorySlug || "",
    pattern: product.pattern || product.keyAttributes?.Pattern || "",
    brand: product.brand || product.keyAttributes?.Brand || "",
    price: product.price,
    offerPrice: product.offerPrice,
    pricingTiers: product.pricingTiers || [],
    customizationOptions: product.customizationOptions || [],
    shipping: product.shipping,
    description: product.description,
    image: imageUrl,
    images: Array.isArray(product.images)
      ? product.images
          .map((asset) => (typeof asset === "string" ? asset : asset?.url || ""))
          .filter(Boolean)
      : [],
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
  };
};

const getPublicProductPrice = (product) => normalizeNumber(product?.offerPrice || product?.price || 0);

const comparePublicProductsByPrice = (left, right, direction) => {
  const leftPrice = getPublicProductPrice(left);
  const rightPrice = getPublicProductPrice(right);

  if (leftPrice !== rightPrice) {
    return direction * (leftPrice - rightPrice);
  }

  const leftSourceId = Number.parseInt(String(left?.sourceId ?? left?._id ?? 0), 10);
  const rightSourceId = Number.parseInt(String(right?.sourceId ?? right?._id ?? 0), 10);

  if (Number.isFinite(leftSourceId) && Number.isFinite(rightSourceId) && leftSourceId !== rightSourceId) {
    return leftSourceId - rightSourceId;
  }

  return String(left?.name || "").localeCompare(String(right?.name || ""));
};

// ─────────────────────────────────────────────────────────────────────────────
// CONTROLLER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List categories with filtering, sorting, and pagination
 */
const listCategories = async (req, res) => {
  try {
    const { search, isActive, all } = req.query;

    const filter = {};
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { slug: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }
    if (isActive !== undefined) {
      filter.isActive = String(isActive).toLowerCase() === "true";
    }

    const sortBy = String(req.query.sort || "displayOrder");
    let sortStage = { displayOrder: 1, name: 1 };
    if (sortBy === "name-asc") sortStage = { name: 1, displayOrder: 1 };
    else if (sortBy === "name-desc") sortStage = { name: -1, displayOrder: 1 };
    else if (sortBy === "newest") sortStage = { createdAt: -1, name: 1 };
    else if (sortBy === "oldest") sortStage = { createdAt: 1, name: 1 };

    // Return all categories without pagination
    if (String(all).toLowerCase() === "true") {
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

/**
 * Create a new category
 */
const createCategory = async (req, res) => {
  try {
    const payload = normalizeCategoryPayload(req.body);

    if (!payload.name) {
      return res.status(400).json({ success: false, message: "Category name is required" });
    }

    const exists = await Category.findOne({
      $or: [{ slug: payload.slug }, { name: payload.name }],
    });
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

/**
 * Update an existing category
 */
const updateCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const payload = normalizeCategoryPayload(req.body);

    const category = await Category.findById(categoryId);
    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    // Update fields
    category.name = payload.name || category.name;
    category.slug = payload.slug || category.slug;
    category.icon = payload.icon;
    category.description = payload.description;
    category.displayOrder = payload.displayOrder;
    category.isActive = payload.isActive;
    category.image = payload.image;
    category.metadata = payload.metadata;

    // Handle subcategories - preserve existing if not provided in payload
    if (req.body.subcategories !== undefined) {
      category.subcategories = payload.subcategories;
    }

    await category.save();
    res.json({ success: true, category: mapCategory(category) });
  } catch (error) {
    console.error("Update category error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Delete a category and all associated products
 */
const deleteCategory = async (req, res) => {
  try {
    const category = await Category.findById(req.params.categoryId);
    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    // Delete all products in this category
    await Product.deleteMany({ category: category._id });
    await category.deleteOne();

    res.json({ success: true, message: "Category deleted" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get a single category by ID
 */
const getCategory = async (req, res) => {
  try {
    const category = await Category.findById(req.params.categoryId);
    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    res.json({ success: true, category: mapCategory(category) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Public product list for storefront (read-only)
 */
const listPublicProducts = async (req, res) => {
  try {
    const { search, category, subcategory, brand, pattern, isFeatured, all } = req.query;
    const sortBy = String(req.query.sort || "newest");
    const isPriceSort = sortBy === "price-low-high" || sortBy === "price-high-low";
    const priceSortDirection = sortBy === "price-high-low" ? -1 : 1;
    const normalize = (value = "") => String(value).trim().toLowerCase();
    const isVehicleTruckTireDataset =
      normalize(category) === "vehicle parts and accessories" &&
      ["truck tires", "truck tyre", "truck tyres"].includes(normalize(subcategory)) &&
      !brand &&
      sortBy === "newest";
    const doubleCoinClause = {
      $or: [
        { brand: { $regex: "^double\\s*coin$", $options: "i" } },
        { "keyAttributes.Brand": { $regex: "^double\\s*coin$", $options: "i" } },
      ],
    };

    const andClauses = [{ isActive: true }];

    if (search) {
      const regex = { $regex: String(search), $options: "i" };
      andClauses.push({
        $or: [
        { name: regex },
        { slug: regex },
        { description: regex },
        { brand: regex },
        { "keyAttributes.Brand": regex },
        { pattern: regex },
        { "keyAttributes.Pattern": regex },
        { categoryName: regex },
        { subcategoryName: regex },
        ],
      });
    }

    if (category) {
      andClauses.push({ categoryName: { $regex: String(category), $options: "i" } });
    }

    if (subcategory) {
      andClauses.push({ subcategoryName: { $regex: String(subcategory), $options: "i" } });
    }

    if (brand) {
      const regex = { $regex: String(brand), $options: "i" };
      andClauses.push({ $or: [{ brand: regex }, { "keyAttributes.Brand": regex }] });
    }

    if (pattern) {
      const regex = { $regex: String(pattern), $options: "i" };
      andClauses.push({ $or: [{ pattern: regex }, { "keyAttributes.Pattern": regex }] });
    }

    if (isFeatured !== undefined) {
      andClauses.push({ isFeatured: String(isFeatured).toLowerCase() === "true" });
    }

    if (isRecentPurchase !== undefined) {
      andClauses.push({ isRecentPurchase: String(isRecentPurchase).toLowerCase() === "true" });
    }

    const filter = andClauses.length === 1 ? andClauses[0] : { $and: andClauses };

    const facetClauses = [{ isActive: true }];
    if (category) {
      facetClauses.push({ categoryName: { $regex: String(category), $options: "i" } });
    }
    if (subcategory) {
      facetClauses.push({ subcategoryName: { $regex: String(subcategory), $options: "i" } });
    }
    const facetFilter = facetClauses.length === 1 ? facetClauses[0] : { $and: facetClauses };

    let sortStage = { createdAt: -1 };
    if (sortBy === "name-asc") sortStage = { name: 1, createdAt: -1 };
    else if (sortBy === "name-desc") sortStage = { name: -1, createdAt: -1 };
    else if (sortBy === "brand-asc") sortStage = { brand: 1, name: 1 };
    else if (sortBy === "brand-desc") sortStage = { brand: -1, name: 1 };

    if (String(all).toLowerCase() === "true") {
      const [productsDefault, priorityProducts, otherProducts, brandsDirect, brandsFromAttributes, patternsDirect, patternsFromAttributes] = await Promise.all([
        Product.find(filter).populate("category"),
        !isPriceSort && isVehicleTruckTireDataset
          ? Product.find({ $and: [filter, doubleCoinClause] }).sort(sortStage).populate("category")
          : Promise.resolve([]),
        !isPriceSort && isVehicleTruckTireDataset
          ? Product.find({ $and: [filter, { $nor: doubleCoinClause.$or }] }).sort(sortStage).populate("category")
          : Promise.resolve([]),
        Product.distinct("brand", facetFilter),
        Product.distinct("keyAttributes.Brand", facetFilter),
        Product.distinct("pattern", facetFilter),
        Product.distinct("keyAttributes.Pattern", facetFilter),
      ]);

      const products = isPriceSort
        ? [...productsDefault].sort((left, right) => comparePublicProductsByPrice(left, right, priceSortDirection))
        : isVehicleTruckTireDataset
          ? [...priorityProducts, ...otherProducts]
          : productsDefault;

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

      return res.json({
        success: true,
        products: products.map(mapPublicProduct),
        filters: { brands, patterns },
      });
    }

    const { page, limit, skip } = buildPaging(req.query, { defaultLimit: 50, maxLimit: 200 });

    let products = [];
    let total = 0;
    let brandsDirect = [];
    let brandsFromAttributes = [];
    let patternsDirect = [];
    let patternsFromAttributes = [];

    if (isPriceSort) {
      const [allProducts, totalCount, bd, bfa, pd, pfa] = await Promise.all([
        Product.find(filter).populate("category"),
        Product.countDocuments(filter),
        Product.distinct("brand", facetFilter),
        Product.distinct("keyAttributes.Brand", facetFilter),
        Product.distinct("pattern", facetFilter),
        Product.distinct("keyAttributes.Pattern", facetFilter),
      ]);

      total = totalCount;
      brandsDirect = bd;
      brandsFromAttributes = bfa;
      patternsDirect = pd;
      patternsFromAttributes = pfa;

      const sortedProducts = [...allProducts].sort((left, right) => comparePublicProductsByPrice(left, right, priceSortDirection));
      products = sortedProducts.slice(skip, skip + limit);
    } else if (isVehicleTruckTireDataset) {
      const [priorityCount, otherCount, bd, bfa, pd, pfa] = await Promise.all([
        Product.countDocuments({ $and: [filter, doubleCoinClause] }),
        Product.countDocuments({ $and: [filter, { $nor: doubleCoinClause.$or }] }),
        Product.distinct("brand", facetFilter),
        Product.distinct("keyAttributes.Brand", facetFilter),
        Product.distinct("pattern", facetFilter),
        Product.distinct("keyAttributes.Pattern", facetFilter),
      ]);

      total = priorityCount + otherCount;
      brandsDirect = bd;
      brandsFromAttributes = bfa;
      patternsDirect = pd;
      patternsFromAttributes = pfa;

      if (skip < priorityCount) {
        const priorityLimit = Math.min(limit, priorityCount - skip);
        const remainingLimit = limit - priorityLimit;

        const [priorityChunk, otherChunk] = await Promise.all([
          Product.find({ $and: [filter, doubleCoinClause] })
            .sort(sortStage)
            .skip(skip)
            .limit(priorityLimit)
            .populate("category"),
          remainingLimit > 0
            ? Product.find({ $and: [filter, { $nor: doubleCoinClause.$or }] })
                .sort(sortStage)
                .skip(0)
                .limit(remainingLimit)
                .populate("category")
            : Promise.resolve([]),
        ]);

        products = [...priorityChunk, ...otherChunk];
      } else {
        products = await Product.find({ $and: [filter, { $nor: doubleCoinClause.$or }] })
          .sort(sortStage)
          .skip(skip - priorityCount)
          .limit(limit)
          .populate("category");
      }
    } else {
      [products, total, brandsDirect, brandsFromAttributes, patternsDirect, patternsFromAttributes] =
        await Promise.all([
          Product.find(filter).sort(sortStage).skip(skip).limit(limit).populate("category"),
          Product.countDocuments(filter),
          Product.distinct("brand", facetFilter),
          Product.distinct("keyAttributes.Brand", facetFilter),
          Product.distinct("pattern", facetFilter),
          Product.distinct("keyAttributes.Pattern", facetFilter),
        ]);
    }

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
      products: products.map(mapPublicProduct),
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
      filters: { brands, patterns },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Public single product lookup for storefront (read-only)
 */
const getPublicProduct = async (req, res) => {
  try {
    const routeId = String(req.params.productId || "").trim();
    if (!routeId) {
      return res.status(400).json({ success: false, message: "Product id is required" });
    }

    const numericSourceId = Number.parseInt(routeId, 10);
    const clauses = [{ sourceId: Number.isFinite(numericSourceId) ? numericSourceId : null }].filter(
      (clause) => clause.sourceId !== null
    );
    if (mongoose.Types.ObjectId.isValid(routeId)) {
      clauses.push({ _id: routeId });
    }

    if (!clauses.length) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const product = await Product.findOne({
      isActive: true,
      ...(clauses.length === 1 ? clauses[0] : { $or: clauses }),
    }).populate("category");

    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    res.json({ success: true, product: mapPublicProduct(product) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getCategory,
  listPublicProducts,
  getPublicProduct,
  normalizeCategoryPayload,
  normalizeSubcategories,
  mapCategory,
};
