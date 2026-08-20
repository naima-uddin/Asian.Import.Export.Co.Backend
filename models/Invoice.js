const mongoose = require("mongoose");

const invoiceItemSchema = new mongoose.Schema(
  {
    productId: {
      type: String,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    title: {
      type: String,
      trim: true,
    },
    brand: {
      type: String,
      trim: true,
      default: "",
    },
    pattern: {
      type: String,
      trim: true,
      default: "",
    },
    size: {
      type: String,
      trim: true,
      default: "",
    },
    ply: {
      type: String,
      trim: true,
      default: "",
    },
    image: {
      type: String,
      trim: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    unitPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    discount: {
      type: Number,
      default: 0,
      min: 0,
    },
    lineTotal: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false }
);

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    inquiry: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Inquiry",
      required: true,
      unique: true,
      index: true,
    },
    // Optional: invoices generated from guest inquiries have no linked account.
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    customerSnapshot: {
      name: { type: String, required: true, trim: true },
      email: { type: String, required: true, trim: true, lowercase: true },
      phone: { type: String, trim: true },
      companyName: { type: String, trim: true },
      address: { type: String, trim: true },
      city: { type: String, trim: true },
      state: { type: String, trim: true },
      zone: { type: String, trim: true },
      zipCode: { type: String, trim: true },
      notes: { type: String, trim: true },
      paymentMethod: { type: String, trim: true, default: "bank" },
    },
    items: {
      type: [invoiceItemSchema],
      validate: {
        validator: (items) => Array.isArray(items) && items.length > 0,
        message: "At least one item is required",
      },
    },
    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },
    productSubtotal: {
      type: Number,
      default: 0,
      min: 0,
    },
    vatRate: {
      type: Number,
      default: 0,
      min: 0,
    },
    vatAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    discountRate: {
      type: Number,
      default: 0,
      min: 0,
    },
    discountAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    shippingCost: {
      type: Number,
      default: 0,
      min: 0,
    },
    total: {
      type: Number,
      required: true,
      min: 0,
    },
    paidAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    balanceDue: {
      type: Number,
      default: 0,
      min: 0,
    },
    paymentStatus: {
      type: String,
      enum: ["due", "unpaid", "partial", "full"],
      default: "unpaid",
      index: true,
    },
    currency: {
      type: String,
      default: "USD",
      trim: true,
    },
    invoiceStatus: {
      type: String,
      enum: ["issued", "cancelled"],
      default: "issued",
    },
    notes: {
      type: String,
      trim: true,
    },
    extraNotes: {
      type: String,
      trim: true,
    },
    termsAndConditions: {
      type: String,
      trim: true,
    },
    additionalMessages: {
      type: String,
      trim: true,
    },
    issuedAt: {
      type: Date,
      default: Date.now,
    },
    createdBy: {
      id: { type: String, trim: true },
      name: { type: String, trim: true },
      email: { type: String, trim: true, lowercase: true },
      role: { type: String, trim: true },
    },
  },
  {
    timestamps: true,
  }
);

invoiceSchema.index({ customer: 1, createdAt: -1 });
invoiceSchema.index({ createdAt: -1 });

const Invoice = mongoose.model("Invoice", invoiceSchema);

module.exports = Invoice;
