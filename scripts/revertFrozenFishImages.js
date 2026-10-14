/**
 * revertFrozenFishImages.js
 * ------------------------------------------------------------------
 * Restores Frozen Fish product images back to their original
 * /assets/... paths from categories.json (undoes the previous
 * seed that overwrote them with backend localStorage URLs).
 *
 * Usage:
 *   node scripts/revertFrozenFishImages.js
 * ------------------------------------------------------------------
 */

require("dotenv").config();
const fs        = require("fs/promises");
const path      = require("path");
const connectDB = require("../config/db");
const Product   = require("../models/Product");

const slugify = (v = "") =>
  String(v).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";

const catalogPath = () =>
  path.resolve(
    __dirname, "..", "..",
    "Asian.Import.Export.Co.Frontend", "public", "categories.json"
  );

const run = async () => {
  await connectDB();
  console.log("✅ Connected to MongoDB\n");

  const raw     = await fs.readFile(catalogPath(), "utf8");
  const catalog = JSON.parse(raw);

  const frozenFish = catalog.find((c) => c.name === "Frozen Fish");
  if (!frozenFish) { console.error("❌ Not found"); process.exit(1); }

  let reverted = 0;

  for (const sub of frozenFish.subcategories || []) {
    for (const p of sub.products || []) {
      const slug = slugify(p.name);

      const existing = await Product.findOne({
        $or: [
          ...(p.id ? [{ sourceId: p.id }] : []),
          ...(slug ? [{ slug }]            : []),
        ],
      });

      if (!existing) continue;

      // Only restore image if it was overwritten (publicId set by seed)
      const originalImagePath = String(p.image || "");

      await Product.updateOne(
        { _id: existing._id },
        {
          $set: {
            "image.url":       originalImagePath,
            "image.publicId":  "",
            "image.alt":       p.name,
            "image.width":     0,
            "image.height":    0,
            "image.bytes":     0,
            "image.format":    "",
          },
        }
      );

      reverted++;
      console.log(`  ✅ Image restored: "${p.name}" → ${originalImagePath}`);
    }
  }

  console.log(`\n🎉 Reverted ${reverted} product images.\n`);
  process.exit(0);
};

run().catch((err) => {
  console.error("❌ Revert failed:", err);
  process.exit(1);
});
