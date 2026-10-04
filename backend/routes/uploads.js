import express from "express";
import process from "node:process";
import { authMiddleware, roleMiddleware } from "../middleware/auth.js";
import uploadController, { productImageUploadMiddleware, uploadMiddleware } from "../controllers/uploadController.js";

const router = express.Router();

router.post("/token", uploadController.createBlobUploadToken);
router.post("/backup-token", uploadController.createPrivateBackupUploadToken);
router.post(
	"/product-images",
	authMiddleware,
	roleMiddleware("admin"),
	productImageUploadMiddleware,
	uploadController.uploadProductImages
);
router.post("/", (req, res, next) => {
	if (process.env.VERCEL === "1") {
		return res.status(410).json({ success: false, message: "Use direct Blob uploads in production." });
	}
	return next();
}, uploadMiddleware.any(), uploadController.uploadImages);

export default router;
