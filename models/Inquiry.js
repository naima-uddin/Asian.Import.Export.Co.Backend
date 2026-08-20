const mongoose = require("mongoose");

const inquiryItemSchema = new mongoose.Schema(
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

const inquirySchema = new mongoose.Schema(
  {
    inquiryNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    // Optional: guest checkouts have no linked account.
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    isGuest: {
      type: Boolean,
      default: false,
      index: true,
    },
    customerSnapshot: {
      name: { type: String, required: true, trim: true },
      email: { type: String, required: true, trim: true, lowercase: true },
      phone: { type: String, required: true, trim: true },
      companyName: { type: String, trim: true },
      address: { type: String, required: true, trim: true },
      city: { type: String, required: true, trim: true },
      state: { type: String, trim: true },
      zone: { type: String, required: true, trim: true },
      zipCode: { type: String, trim: true },
      notes: { type: String, trim: true },
      whatsappNumber: { type: String, trim: true },
    },
    items: {
      type: [inquiryItemSchema],
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
    total: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: "USD",
      trim: true,
    },
    paymentMethod: {
      type: String,
      enum: ["credit-card", "bank"],
      default: "bank",
    },
    status: {
      type: String,
      enum: ["in_process", "invoice_sent", "cancelled"],
      default: "in_process",
      index: true,
    },
    contactChannel: {
      type: String,
      enum: ["email", "whatsapp", "phone", "mixed"],
      default: "mixed",
    },
    internalNotes: {
      type: String,
      trim: true,
    },
    payment: {
      confirmed: { type: Boolean, default: false },
      paidAmount: { type: Number, min: 0, default: 0 },
      confirmedAt: { type: Date },
      notes: { type: String, trim: true },
    },
    linkedInvoice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invoice",
      index: true,
    },
    hiddenByCustomer: {
      type: Boolean,
      default: false,
      index: true,
    },
    hiddenAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

inquirySchema.index({ customer: 1, createdAt: -1 });
inquirySchema.index({ status: 1, createdAt: -1 });

const Inquiry = mongoose.model("Inquiry", inquirySchema);

module.exports = Inquiry;
