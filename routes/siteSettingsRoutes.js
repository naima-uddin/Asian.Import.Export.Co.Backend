const express = require("express");
const { authenticate, requireAdmin } = require("../middleware/auth");
const {
  getSiteSettings,
  updateSiteSettings,
} = require("../controllers/siteSettingsController");

const router = express.Router();

router.get("/", getSiteSettings);
router.put("/", authenticate, requireAdmin, updateSiteSettings);

module.exports = router;
