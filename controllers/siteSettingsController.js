const SiteSettings = require("../models/SiteSettings");

const cleanText = (value) => (value === undefined || value === null ? undefined : String(value).trim());

const defaultSiteSettings = () => ({
  contact: {
    footerWhatsAppNumber: "18083015788",
    footerWhatsAppDisplay: "+1 808-301-5788",
    floatingWhatsAppNumber: "18083015788",
    floatingWhatsAppDisplay: "+1 (808) 301-5788",
  },
});

const normalizeSettingsPayload = (payload = {}) => ({
  contact: {
    footerWhatsAppNumber: cleanText(payload?.contact?.footerWhatsAppNumber),
    footerWhatsAppDisplay: cleanText(payload?.contact?.footerWhatsAppDisplay),
    floatingWhatsAppNumber: cleanText(payload?.contact?.floatingWhatsAppNumber),
    floatingWhatsAppDisplay: cleanText(payload?.contact?.floatingWhatsAppDisplay),
  },
});

const mergeSettings = (source = {}, fallback = defaultSiteSettings()) => ({
  contact: {
    footerWhatsAppNumber:
      source?.contact?.footerWhatsAppNumber || fallback.contact.footerWhatsAppNumber,
    footerWhatsAppDisplay:
      source?.contact?.footerWhatsAppDisplay || fallback.contact.footerWhatsAppDisplay,
    floatingWhatsAppNumber:
      source?.contact?.floatingWhatsAppNumber || fallback.contact.floatingWhatsAppNumber,
    floatingWhatsAppDisplay:
      source?.contact?.floatingWhatsAppDisplay || fallback.contact.floatingWhatsAppDisplay,
  },
});

const getSiteSettings = async (_req, res) => {
  try {
    const latestSettings = await SiteSettings.findOne().sort({ updatedAt: -1 }).lean();
    return res.status(200).json({
      success: true,
      settings: mergeSettings(latestSettings),
    });
  } catch (error) {
    console.error("Get site settings error:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching site settings",
      error: error.message,
    });
  }
};

const updateSiteSettings = async (req, res) => {
  try {
    const payload = normalizeSettingsPayload(req.body);
    const existing = await SiteSettings.findOne().sort({ updatedAt: -1 });

    const nextSettings = mergeSettings(payload, existing ? existing.toObject() : defaultSiteSettings());

    const updatedSettings = existing
      ? Object.assign(existing, nextSettings)
      : new SiteSettings(nextSettings);

    await updatedSettings.save();

    return res.status(200).json({
      success: true,
      message: "Site settings updated successfully",
      settings: mergeSettings(updatedSettings.toObject()),
    });
  } catch (error) {
    console.error("Update site settings error:", error);
    return res.status(500).json({
      success: false,
      message: "Error updating site settings",
      error: error.message,
    });
  }
};

module.exports = {
  getSiteSettings,
  updateSiteSettings,
};