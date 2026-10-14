/**
 * seedFrozenFish.js
 * ------------------------------------------------------------------
 * ONLY patches the `pricingTiers` field on existing Frozen Fish
 * products.  Every other field (image, description, price, etc.)
 * is left completely untouched.
 *
 * Usage:
 *   node scripts/seedFrozenFish.js
 * ------------------------------------------------------------------
 */

require("dotenv").config();
const fs        = require("fs/promises");
const path      = require("path");
const connectDB = require("../config/db");
const Product   = require("../models/Product");

// ─── helpers ─────────────────────────────────────────────────────────────────

const slugify = (v = "") =>
  String(v).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";

const catalogPath = () =>
  path.resolve(
    __dirname, "..", "..",
    "Asian.Import.Export.Co.Frontend", "public", "categories.json"
  );

// ─── pricing tier normaliser ──────────────────────────────────────────────────
/**
 * Shape A  (Eel, Crab)  → { minWeight, maxWeight, pricePerKg }
 * Shape B  (Shrimp)     → { size, pricePerTon }
 * Shape C  (Tilapia)    → { minQuantity, maxQuantity, pricePerKg }
 * Shape D  (standard)   → { minQuantity, maxQuantity, pricePerTire, note }
 */
const normaliseTiers = (tiers) => {
  if (!Array.isArray(tiers)) return [];

  return tiers.map((t) => {
    // Shape A — weight-based (Eel, Crab)
    if (t.minWeight !== undefined || t.maxWeight !== undefined || t.pricePerKg !== undefined && t.minWeight !== undefined) {
      return {
        minQuantity:  t.minWeight  != null ? Number(t.minWeight)  : 0,
        maxQuantity:  t.maxWeight  != null ? Number(t.maxWeight)  : null,
        pricePerTire: String(t.pricePerKg || t.price || ""),
        note: `Price per kg; weight range: ${t.minWeight ?? ""}g – ${t.maxWeight ?? "∞"}g`,
      };
    }

    // Shape B — size label (Shrimp)
    if (t.size !== undefined || t.pricePerTon !== undefined) {
      return {
        minQuantity:  0,
        maxQuantity:  null,
        pricePerTire: String(t.pricePerTon || t.price || ""),
        note:         String(t.size || ""),
      };
    }

    // Shape C — quantity-based with pricePerKg
    if (t.pricePerKg !== undefined) {
      return {
        minQuantity:  t.minQuantity != null ? Number(t.minQuantity) : 0,
        maxQuantity:  t.maxQuantity != null ? Number(t.maxQuantity) : null,
        pricePerTire: String(t.pricePerKg),
        note:         "Price per kg",
      };
    }

    // Shape D — already normalised
    return {
      minQuantity:  t.minQuantity != null ? Number(t.minQuantity) : 0,
      maxQuantity:  t.maxQuantity != null ? Number(t.maxQuantity) : null,
      pricePerTire: String(t.pricePerTire ?? t.price ?? ""),
      note:         String(t.note || ""),
    };
  });
};

// ─── main ─────────────────────────────────────────────────────────────────────

const run = async () => {
  await connectDB();
  console.log("✅ Connected to MongoDB\n");

  const raw     = await fs.readFile(catalogPath(), "utf8");
  const catalog = JSON.parse(raw);

  const frozenFish = catalog.find((c) => c.name === "Frozen Fish");
  if (!frozenFish) {
    console.error("❌  'Frozen Fish' not found in categories.json");
    process.exit(1);
  }

  let updated = 0;
  let skipped = 0;

  for (const sub of frozenFish.subcategories || []) {
    console.log(`📁 Subcategory: ${sub.name}`);

    for (const p of sub.products || []) {
      const tiers = normaliseTiers(p.pricingTiers);
      const slug  = slugify(p.name);

      // Find existing product — ONLY by sourceId or slug, touch NOTHING else
      const existing = await Product.findOne({
        $or: [
          ...(p.id   ? [{ sourceId: p.id }]  : []),
          ...(slug   ? [{ slug }]             : []),
        ],
      });

      if (!existing) {
        console.log(`  ⚠  Not found in DB — skipped: "${p.name}"`);
        skipped++;
        continue;
      }

      // ONLY update pricingTiers — nothing else
      await Product.updateOne(
        { _id: existing._id },
        { $set: { pricingTiers: tiers } }
      );

      updated++;

      const tierSummary = tiers.length
        ? tiers.map((t) => `      • ${t.note || "tier"} → ${t.pricePerTire}`).join("\n")
        : "      • (no tiers)";

      console.log(`  ✅ "${p.name}" → ${tiers.length} tier(s) added`);
      console.log(tierSummary);
    }

    console.log();
  }

  console.log(`🎉 Done! Updated: ${updated}  |  Skipped (not in DB): ${skipped}\n`);
  process.exit(0);
};

run().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
