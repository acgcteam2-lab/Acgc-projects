import express from "express";
import { authMiddleware, roleMiddleware } from "../middleware/auth.js";
import uploadController, { productImageUploadMiddleware, uploadMiddleware } from "../controllers/uploadController.js";

const router = express.Router();

router.post("/cloudinary-signature", authMiddleware, uploadController.createCloudinaryUploadSignature);
router.post(
	"/product-images",
	authMiddleware,
	roleMiddleware("admin"),
	productImageUploadMiddleware,
	uploadController.uploadProductImages
);
router.post("/", uploadMiddleware.any(), uploadController.uploadImages);

export default router;
