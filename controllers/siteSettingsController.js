const multer = require("multer");
const SiteSettings = require("../models/SiteSettings");
const localStorage = require("../config/localStorage");

const BRANDING_FOLDER = "branding";
const HOME_SLIDES_FOLDER = "home-slides";

const upload = multer({ storage: multer.memoryStorage() });

const cleanText = (value) =>
  value === undefined || value === null ? undefined : String(value).trim();

const defaultSiteSettings = () => ({
  branding: {
    siteName: "Asian Import Export Co LTD",
    tagline: "Global Trade Solutions",
    logo: { url: "", publicId: "" },
    favicon: { url: "", publicId: "" },
  },
  contact: {
    footerWhatsAppNumber: "18083015788",
    footerWhatsAppDisplay: "+1 808-301-5788",
    floatingWhatsAppNumber: "18083015788",
    floatingWhatsAppDisplay: "+1 (808) 301-5788",
  },
  homeSlides: [],
});

const normalizeSlides = (slides) =>
  (Array.isArray(slides) ? slides : [])
    .map((slide, index) => ({
      url: String(slide?.url || "").trim(),
      publicId: String(slide?.publicId || "").trim(),
      order: Number.isFinite(slide?.order) ? Number(slide.order) : index,
    }))
    .filter((slide) => slide.url)
    .sort((a, b) => a.order - b.order)
    .map((slide, index) => ({ ...slide, order: index }));

// Only text fields are editable through the JSON update endpoint.
// Logo / favicon files go through the dedicated upload endpoints.
const normalizeSettingsPayload = (payload = {}) => ({
  branding: {
    siteName: cleanText(payload?.branding?.siteName),
    tagline: cleanText(payload?.branding?.tagline),
  },
  contact: {
    footerWhatsAppNumber: cleanText(payload?.contact?.footerWhatsAppNumber),
    footerWhatsAppDisplay: cleanText(payload?.contact?.footerWhatsAppDisplay),
    floatingWhatsAppNumber: cleanText(payload?.contact?.floatingWhatsAppNumber),
    floatingWhatsAppDisplay: cleanText(
      payload?.contact?.floatingWhatsAppDisplay,
    ),
  },
});

const mergeMediaRef = (source = {}, fallback = {}) => ({
  url: source?.url ?? fallback?.url ?? "",
  publicId: source?.publicId ?? fallback?.publicId ?? "",
});

const mergeSettings = (source = {}, fallback = defaultSiteSettings()) => ({
  branding: {
    siteName: source?.branding?.siteName || fallback.branding.siteName,
    tagline: source?.branding?.tagline || fallback.branding.tagline,
    logo: mergeMediaRef(source?.branding?.logo, fallback.branding.logo),
    favicon: mergeMediaRef(source?.branding?.favicon, fallback.branding.favicon),
  },
  contact: {
    footerWhatsAppNumber:
      source?.contact?.footerWhatsAppNumber ||
      fallback.contact.footerWhatsAppNumber,
    footerWhatsAppDisplay:
      source?.contact?.footerWhatsAppDisplay ||
      fallback.contact.footerWhatsAppDisplay,
    floatingWhatsAppNumber:
      source?.contact?.floatingWhatsAppNumber ||
      fallback.contact.floatingWhatsAppNumber,
    floatingWhatsAppDisplay:
      source?.contact?.floatingWhatsAppDisplay ||
      fallback.contact.floatingWhatsAppDisplay,
  },
  homeSlides: normalizeSlides(
    Array.isArray(source?.homeSlides) ? source.homeSlides : fallback.homeSlides,
  ),
});

const loadSettingsDoc = async () => SiteSettings.findOne().sort({ updatedAt: -1 });

const getSiteSettings = async (_req, res) => {
  try {
    const latestSettings = await loadSettingsDoc();
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
    const existing = await loadSettingsDoc();

    const nextSettings = mergeSettings(
      payload,
      existing ? existing.toObject() : defaultSiteSettings(),
    );

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

// Handle logo / favicon file uploads. `assetType` is "logo" or "favicon".
const uploadBrandingAsset = (assetType) => async (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "Image file is required" });
    }

    const uploaded = await localStorage.saveBuffer(req.file.buffer, {
      originalname: req.file.originalname || assetType,
      mimetype: req.file.mimetype,
      folder: BRANDING_FOLDER,
    });

    const existing = await loadSettingsDoc();
    const previousPublicId = existing?.branding?.[assetType]?.publicId;

    const base = existing ? existing.toObject() : defaultSiteSettings();
    const merged = mergeSettings(base);
    merged.branding[assetType] = {
      url: uploaded.url,
      publicId: uploaded.public_id,
    };

    const updatedSettings = existing
      ? Object.assign(existing, merged)
      : new SiteSettings(merged);

    await updatedSettings.save();

    // Remove the old file from disk (best-effort, never blocks the response).
    if (previousPublicId && previousPublicId !== uploaded.public_id) {
      localStorage.deleteFile(previousPublicId).catch(() => {});
    }

    return res.status(200).json({
      success: true,
      message: `${assetType} updated successfully`,
      settings: mergeSettings(updatedSettings.toObject()),
    });
  } catch (error) {
    console.error(`Upload ${assetType} error:`, error);
    return res.status(500).json({
      success: false,
      message: `Error uploading ${assetType}`,
      error: error.message,
    });
  }
};

// Persist a new slides array onto the (single) settings document.
const saveSlides = async (slides) => {
  const existing = await loadSettingsDoc();
  const base = existing ? existing.toObject() : defaultSiteSettings();
  const merged = mergeSettings(base);
  merged.homeSlides = normalizeSlides(slides);

  const updatedSettings = existing
    ? Object.assign(existing, merged)
    : new SiteSettings(merged);

  await updatedSettings.save();
  return mergeSettings(updatedSettings.toObject());
};

const addHomeSlide = async (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "Image file is required" });
    }

    const uploaded = await localStorage.saveBuffer(req.file.buffer, {
      originalname: req.file.originalname || "slide",
      mimetype: req.file.mimetype,
      folder: HOME_SLIDES_FOLDER,
    });

    const existing = await loadSettingsDoc();
    const current = existing?.homeSlides || [];
    const nextSlides = [
      ...current,
      { url: uploaded.url, publicId: uploaded.public_id, order: current.length },
    ];

    const settings = await saveSlides(nextSlides);

    return res.status(200).json({
      success: true,
      message: "Slide added successfully",
      settings,
    });
  } catch (error) {
    console.error("Add home slide error:", error);
    return res.status(500).json({
      success: false,
      message: "Error adding slide",
      error: error.message,
    });
  }
};

const deleteHomeSlide = async (req, res) => {
  try {
    const publicId = String(req.body?.publicId || "").trim();
    if (!publicId) {
      return res
        .status(400)
        .json({ success: false, message: "publicId is required" });
    }

    const existing = await loadSettingsDoc();
    const current = existing?.homeSlides || [];
    const nextSlides = current.filter((slide) => slide.publicId !== publicId);

    const settings = await saveSlides(nextSlides);

    // Best-effort file removal.
    localStorage.deleteFile(publicId).catch(() => {});

    return res.status(200).json({
      success: true,
      message: "Slide removed successfully",
      settings,
    });
  } catch (error) {
    console.error("Delete home slide error:", error);
    return res.status(500).json({
      success: false,
      message: "Error removing slide",
      error: error.message,
    });
  }
};

const reorderHomeSlides = async (req, res) => {
  try {
    const publicIds = Array.isArray(req.body?.publicIds)
      ? req.body.publicIds.map((id) => String(id))
      : [];

    const existing = await loadSettingsDoc();
    const current = existing?.homeSlides || [];

    // Reorder by the given publicId sequence; append any not listed.
    const byId = new Map(current.map((slide) => [slide.publicId, slide]));
    const ordered = [];
    publicIds.forEach((id) => {
      if (byId.has(id)) {
        ordered.push(byId.get(id));
        byId.delete(id);
      }
    });
    byId.forEach((slide) => ordered.push(slide));

    const settings = await saveSlides(ordered);

    return res.status(200).json({
      success: true,
      message: "Slides reordered successfully",
      settings,
    });
  } catch (error) {
    console.error("Reorder home slides error:", error);
    return res.status(500).json({
      success: false,
      message: "Error reordering slides",
      error: error.message,
    });
  }
};

module.exports = {
  uploadMiddleware: upload.single("file"),
  getSiteSettings,
  updateSiteSettings,
  uploadLogo: uploadBrandingAsset("logo"),
  uploadFavicon: uploadBrandingAsset("favicon"),
  addHomeSlide,
  deleteHomeSlide,
  reorderHomeSlides,
};
