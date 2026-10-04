import fs from "fs";
import path from "path";
import multer from "multer";
import process from "node:process";
import { createCloudUploadUrl } from "../services/cloudStorage.js";

const uploadsDir = path.join(process.cwd(), "uploads");
const isVercelRuntime = process.env.VERCEL === "1";
if (!isVercelRuntime && !fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname) || ".png";
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.fieldname}${extension}`;
    cb(null, safeName);
  },
});

const allowedMimeTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
];

const fileFilter = (req, file, cb) => {
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname));
  }
};

export const uploadMiddleware = multer({
  storage: isVercelRuntime ? multer.memoryStorage() : diskStorage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 },
});

const cleanupFiles = async (files = []) => {
  await Promise.all(
    files.map(async (file) => {
      if (!file || !file.path) return;
      try {
        await fs.promises.unlink(file.path);
      } catch (err) {
        console.warn("Failed to cleanup upload file:", file.path, err.message);
      }
    })
  );
};

export const uploadImages = async (req, res) => {
  try {
    const { files } = req;
    if (!files || files.length === 0) {
      return res.status(400).json({ success: false, message: "No files uploaded" });
    }

    const saved = files.map((file) => ({
      key: file.fieldname,
      url: `${req.protocol}://${req.get("host")}/uploads/${file.filename}`,
    }));

    res.json({ success: true, files: saved });
  } catch (error) {
    console.error("Upload images error:", error);
    await cleanupFiles(req.files);
    if (error instanceof multer.MulterError) {
      const message =
        error.code === "LIMIT_FILE_SIZE"
          ? "File size exceeds 50MB limit"
          : "Invalid file type: only PDF, JPEG, PNG, WEBP, and GIF are allowed";
      return res.status(400).json({ success: false, message });
    }
    res.status(500).json({ success: false, message: "Unable to upload images", error: error.message });
  }
};

export const createCloudUploadUrlHandler = async (req, res) => {
  try {
    const { fileName, contentType, purpose = "uploads", size } = req.body || {};
    const user = req.user;
    if (!fileName || !contentType || !user?.id) {
      return res.status(400).json({ success: false, message: "File name and content type are required." });
    }
    if (!["uploads", "review-photos", "payment-proofs", "product-images", "progress-media", "contracts", "backup-import"].includes(purpose)) {
      return res.status(400).json({ success: false, message: "Upload purpose is invalid." });
    }
    if (purpose === "backup-import" && !["admin", "super_admin"].includes(user.role)) {
      return res.status(403).json({ success: false, message: "Only administrators can import backups." });
    }
    if (["product-images", "progress-media", "contracts"].includes(purpose) && !["admin", "super_admin", "skilled_worker"].includes(user.role)) {
      return res.status(403).json({ success: false, message: "You are not authorized to upload this file type." });
    }
    if (purpose === "backup-import" && Number(size) > 512 * 1024 * 1024) {
      return res.status(413).json({ success: false, message: "Backup files cannot exceed 512 MB." });
    }
    if (purpose !== "backup-import" && !allowedMimeTypes.includes(contentType)) {
      return res.status(400).json({ success: false, message: "This file type is not allowed." });
    }

    const result = await createCloudUploadUrl({ purpose, fileName, contentType, userId: user.id });
    res.status(200).json(result);
  } catch (error) {
    console.error("Create Cloud Storage upload URL error:", error.message);
    res.status(error.status || 503).json({ success: false, message: error.message || "Unable to authorize file upload." });
  }
};

export default { uploadImages, createCloudUploadUrlHandler, uploadMiddleware };
