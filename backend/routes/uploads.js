import express from "express";
import process from "node:process";
import uploadController, { uploadMiddleware } from "../controllers/uploadController.js";
import { authMiddleware, roleMiddleware } from "../middleware/auth.js";

const router = express.Router();

router.post("/signed-url", authMiddleware, roleMiddleware(["customer", "admin", "super_admin", "skilled_worker"]), uploadController.createCloudUploadUrlHandler);
router.post("/", (req, res, next) => {
	if (process.env.VERCEL === "1") {
		return res.status(410).json({ success: false, message: "Use direct Cloud Storage uploads in production." });
	}
	return next();
}, uploadMiddleware.any(), uploadController.uploadImages);

export default router;
