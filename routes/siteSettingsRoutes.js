const express = require("express");
const { authenticate, requireAdmin } = require("../middleware/auth");
const {
  uploadMiddleware,
  getSiteSettings,
  updateSiteSettings,
  uploadLogo,
  uploadFavicon,
  addHomeSlide,
  deleteHomeSlide,
  reorderHomeSlides,
} = require("../controllers/siteSettingsController");

const router = express.Router();

router.get("/", getSiteSettings);
router.put("/", authenticate, requireAdmin, updateSiteSettings);
router.post("/logo", authenticate, requireAdmin, uploadMiddleware, uploadLogo);
router.post(
  "/favicon",
  authenticate,
  requireAdmin,
  uploadMiddleware,
  uploadFavicon,
);

router.post(
  "/slides",
  authenticate,
  requireAdmin,
  uploadMiddleware,
  addHomeSlide,
);
router.delete("/slides", authenticate, requireAdmin, deleteHomeSlide);
router.put("/slides/order", authenticate, requireAdmin, reorderHomeSlides);

module.exports = router;
