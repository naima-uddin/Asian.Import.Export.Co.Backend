require("dotenv").config();
const fs = require("fs/promises");
const path = require("path");
const connectDB = require("../config/db");
const Category = require("../models/Category");
const Product = require("../models/Product");
const MediaAsset = require("../models/MediaAsset");
const {
  normalizeCategoryPayload,
  normalizeProductPayload,
} = require("../controllers/catalogController");
const localStorage = require("../config/localStorage");

const slugifyText = (value = "") =>
  String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";

const getCatalogPath = () =>
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

const uploadCatalogAsset = async (asset, fallbackName = "") => {
  const normalizedAsset = typeof asset === "string" ? { url: asset, publicId: "", alt: "" } : asset || {};
  const sourcePath = typeof asset === "string" ? asset : normalizedAsset.url;

  if (!sourcePath || normalizedAsset.publicId || !sourcePath.startsWith("/assets/")) {
    return {
      url: normalizedAsset.url || "",
      publicId: normalizedAsset.publicId || "",
      alt: normalizedAsset.alt || fallbackName,
      width: normalizedAsset.width || 0,
      height: normalizedAsset.height || 0,
      bytes: normalizedAsset.bytes || 0,
      format: normalizedAsset.format || "",
    };
  }

  const localPath = getFrontendAssetPath(sourcePath);

  try {
    // Copy the bundled asset onto the backend's local disk byte-for-byte (no re-encoding).
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
    return {
      url: sourcePath,
      publicId: "",
      alt: fallbackName,
      width: 0,
      height: 0,
      bytes: 0,
      format: "",
    };
  }
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

const run = async () => {
  await connectDB();
  const raw = await fs.readFile(getCatalogPath(), "utf8");
  const parsed = JSON.parse(raw);
  const catalog = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.categories) ? parsed.categories : [];

  let categoryCount = 0;
  let productCount = 0;

  for (const sourceCategory of catalog) {
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
      metadata: { source: "catalog-seed", categoryName: category.name },
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
            source: "catalog-seed",
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
              source: "catalog-seed",
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

  if (!catalog.length && Array.isArray(parsed?.products)) {
    for (const sourceProduct of parsed.products) {
      const productPayload = normalizeProductPayload(sourceProduct);
      if (!productPayload.name) continue;

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

      productPayload.image = await uploadCatalogAsset(sourceProduct.image || "", sourceProduct.name);
      productPayload.images = await Promise.all(
        (sourceProduct.images || []).map((asset, index) => uploadCatalogAsset(asset, `${sourceProduct.name} ${index + 1}`))
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
          source: "catalog-seed",
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
            source: "catalog-seed",
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

  console.log(`Imported ${categoryCount} categories and ${productCount} products.`);
  process.exit(0);
};

run().catch((error) => {
  console.error("Catalog seed failed:", error);
  process.exit(1);
});