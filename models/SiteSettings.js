const mongoose = require("mongoose");

const contactSchema = new mongoose.Schema(
  {
    footerWhatsAppNumber: { type: String, default: "" },
    footerWhatsAppDisplay: { type: String, default: "" },
    floatingWhatsAppNumber: { type: String, default: "" },
    floatingWhatsAppDisplay: { type: String, default: "" },
  },
  { _id: false },
);

const mediaRefSchema = new mongoose.Schema(
  {
    url: { type: String, default: "" },
    publicId: { type: String, default: "" },
  },
  { _id: false },
);

const brandingSchema = new mongoose.Schema(
  {
    siteName: { type: String, default: "" },
    tagline: { type: String, default: "" },
    logo: { type: mediaRefSchema, default: () => ({}) },
    favicon: { type: mediaRefSchema, default: () => ({}) },
  },
  { _id: false },
);

const homeSlideSchema = new mongoose.Schema(
  {
    url: { type: String, default: "" },
    publicId: { type: String, default: "" },
    order: { type: Number, default: 0 },
  },
  { _id: false },
);

const siteSettingsSchema = new mongoose.Schema(
  {
    branding: {
      type: brandingSchema,
      default: () => ({}),
    },
    contact: {
      type: contactSchema,
      default: () => ({}),
    },
    homeSlides: {
      type: [homeSlideSchema],
      default: [],
    },
  },
  { timestamps: true },
);

module.exports =
  mongoose.models.SiteSettings ||
  mongoose.model("SiteSettings", siteSettingsSchema);
