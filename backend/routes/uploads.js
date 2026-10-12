import express from "express";
import { authMiddleware, roleMiddleware, staffModulePermission } from "../middleware/auth.js";
import uploadController, {
	paymentProofUploadMiddleware,
	productImageUploadMiddleware,
	progressMediaUploadMiddleware,
	reviewPhotoUploadMiddleware,
	uploadMiddleware,
} from "../controllers/uploadController.js";

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
router.post(
	"/review-photos",
	authMiddleware,
	roleMiddleware(["customer", "admin", "super_admin"]),
	reviewPhotoUploadMiddleware,
	uploadController.uploadReviewPhotos
);
router.post(
	"/progress-media",
	authMiddleware,
	roleMiddleware(["admin", "super_admin", "skilled_worker"]),
	staffModulePermission("progress_monitoring", "upload_progress_photo"),
	progressMediaUploadMiddleware,
	uploadController.uploadProgressMedia
);
router.post("/", uploadMiddleware.any(), uploadController.uploadImages);

export default router;
