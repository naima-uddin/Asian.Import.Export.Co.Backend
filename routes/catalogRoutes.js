const express = require("express");
const {
  uploadMiddleware,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  setProductRecentPurchase,
  deleteProduct,
  listMedia,
  uploadMedia,
  uploadMediaFromUrl,
  deleteMedia,
  importCatalogFromJson,
} = require("../controllers/catalogController");
const { authenticate, requireAdmin, requireStaff } = require("../middleware/auth");

const router = express.Router();

router.get("/categories",  listCategories);
router.post("/categories", authenticate, requireStaff, createCategory);
router.put("/categories/:categoryId", authenticate, requireStaff, updateCategory);
router.delete("/categories/:categoryId", authenticate, requireAdmin, deleteCategory);
router.post("/categories/import", authenticate, requireAdmin, importCatalogFromJson);

router.get("/products",  listProducts);
router.get("/products/:productId", authenticate, requireStaff, getProduct);
router.post("/products", authenticate, requireStaff, createProduct);
router.put("/products/:productId", authenticate, requireStaff, updateProduct);
router.delete("/products/:productId", authenticate, requireAdmin, deleteProduct);
router.patch("/products/:productId/recent-purchase", authenticate, requireStaff, setProductRecentPurchase);

router.get("/media", authenticate, requireStaff, listMedia);
router.post("/media/upload", authenticate, requireStaff, uploadMiddleware, uploadMedia);
router.post("/media/upload-from-url", authenticate, requireStaff, uploadMediaFromUrl);
router.delete("/media/:publicId", authenticate, requireStaff, deleteMedia);

module.exports = router;