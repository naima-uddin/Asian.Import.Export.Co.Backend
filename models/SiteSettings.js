const mongoose = require("mongoose");

const contactSchema = new mongoose.Schema(
  {
    footerWhatsAppNumber: { type: String, default: "" },
    footerWhatsAppDisplay: { type: String, default: "" },
    floatingWhatsAppNumber: { type: String, default: "" },
    floatingWhatsAppDisplay: { type: String, default: "" },
  },
  { _id: false }
);

const siteSettingsSchema = new mongoose.Schema(
  {
    contact: {
      type: contactSchema,
      default: () => ({}),
    },
  },
  { timestamps: true }
);

module.exports = mongoose.models.SiteSettings || mongoose.model("SiteSettings", siteSettingsSchema);