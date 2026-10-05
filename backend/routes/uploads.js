import express from "express";
import { authMiddleware, roleMiddleware } from "../middleware/auth.js";
import uploadController, { paymentProofUploadMiddleware, productImageUploadMiddleware, uploadMiddleware } from "../controllers/uploadController.js";

const router = express.Router();

router.post("/cloudinary-signature", authMiddleware, uploadController.createCloudinaryUploadSignature);
router.post(
	"/product-images",
	authMiddleware,
	roleMiddleware("admin"),
	productImageUploadMiddleware,
	uploadController.uploadProductImages
);
router.post(
	"/payment-proofs",
	authMiddleware,
	roleMiddleware(["customer", "admin", "super_admin"]),
	paymentProofUploadMiddleware,
	uploadController.uploadPaymentProof
);
router.post("/", uploadMiddleware.any(), uploadController.uploadImages);

export default router;
