const mongoose = require("mongoose");
const Counter = require("./Counter");

const PRODUCT_SOURCE_COUNTER_KEY = "product-source-id";

const ensureProductCounterSeeded = async () => {
  const existingCounter = await Counter.findById(PRODUCT_SOURCE_COUNTER_KEY).lean();
  if (existingCounter) {
    return;
  }

  const maxProduct = await mongoose
    .model("Product")
    .findOne({ sourceId: { $exists: true, $ne: null } })
    .sort({ sourceId: -1 })
    .select({ sourceId: 1 })
    .lean();

  const seed = Number(maxProduct?.sourceId) || 0;

  try {
    await Counter.create({
      _id: PRODUCT_SOURCE_COUNTER_KEY,
      seq: seed,
    });
  } catch (error) {
    if (error?.code !== 11000) {
      throw error;
    }
  }
};

const getNextProductSourceId = async () => {
  await ensureProductCounterSeeded();

  const counter = await Counter.findByIdAndUpdate(
    PRODUCT_SOURCE_COUNTER_KEY,
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  return counter.seq;
};

const pricingTierSchema = new mongoose.Schema(
  {
    minQuantity: { type: Number, default: 0 },
    maxQuantity: { type: Number, default: 0 },
    pricePerTire: { type: String, trim: true, default: "" },
    note: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const reviewSchema = new mongoose.Schema(
  {
    username: { type: String, trim: true, default: "" },
    location: { type: String, trim: true, default: "" },
    rating: { type: Number, default: 0 },
    date: { type: String, trim: true, default: "" },
    title: { type: String, trim: true, default: "" },
    text: { type: String, trim: true, default: "" },
    verified: { type: Boolean, default: false },
  },
  { _id: false }
);

const assetSchema = new mongoose.Schema(
  {
    url: { type: String, trim: true, default: "" },
    publicId: { type: String, trim: true, default: "" },
    alt: { type: String, trim: true, default: "" },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    bytes: { type: Number, default: 0 },
    format: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const productSchema = new mongoose.Schema(
  {
    sourceId: { type: Number, unique: true, sparse: true, index: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true, index: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true, index: true },
    mainCategory: { type: String, trim: true, default: "" },
    subCategory: { type: String, trim: true, default: "" },
    categoryName: { type: String, trim: true, default: "" },
    categoryIcon: { type: String, trim: true, default: "" },
    subcategoryId: { type: Number, default: 0 },
    subcategoryName: { type: String, trim: true, default: "" },
    subcategorySlug: { type: String, trim: true, default: "" },
    pattern: { type: String, trim: true, default: "" },
    brand: { type: String, trim: true, default: "" },
    price: { type: String, trim: true, default: "" },
    offerPrice: { type: String, trim: true, default: "" },
    pricingTiers: { type: [pricingTierSchema], default: [] },
    customizationOptions: { type: [String], default: [] },
    shipping: { type: String, trim: true, default: "" },
    description: { type: String, trim: true, default: "" },
    image: { type: assetSchema, default: () => ({}) },
    images: { type: [assetSchema], default: [] },
    keyAttributes: { type: mongoose.Schema.Types.Mixed, default: {} },
    packagingAndDelivery: { type: mongoose.Schema.Types.Mixed, default: {} },
    priceSource: { type: String, trim: true, default: "" },
    userReviews: { type: [reviewSchema], default: [] },
    tags: { type: [String], default: [] },
    isFeatured: { type: Boolean, default: false },
    isRecentPurchase: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

productSchema.index({ category: 1, subcategoryId: 1, createdAt: -1 });

productSchema.pre("validate", async function autoAssignSourceId(next) {
  try {
    if (this.sourceId === undefined || this.sourceId === null || this.sourceId === "") {
      this.sourceId = await getNextProductSourceId();
      return next();
    }

    const numericSourceId = Number(this.sourceId);
    if (Number.isFinite(numericSourceId) && numericSourceId > 0) {
      await Counter.findByIdAndUpdate(
        PRODUCT_SOURCE_COUNTER_KEY,
        { $max: { seq: numericSourceId } },
        { upsert: true, setDefaultsOnInsert: true }
      );
      this.sourceId = numericSourceId;
    }

    return next();
  } catch (error) {
    return next(error);
  }
});

const Product = mongoose.model("Product", productSchema);

module.exports = Product;