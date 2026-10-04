import fs from "fs";
import path from "path";
import multer from "multer";
import jwt from "jsonwebtoken";
import process from "node:process";
import { handleUpload } from "@vercel/blob/client";

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

const createBlobUploadTokenForStore = async (req, res, privateBackupStore = false) => {
  try {
    const token = privateBackupStore ? process.env.BLOB_PRIVATE_READ_WRITE_TOKEN : process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) throw Object.assign(new Error(privateBackupStore ? "Private Blob backup storage is not configured." : "Blob media storage is not configured."), { status: 503 });

    const result = await handleUpload({
      request: req,
      body: req.body,
      token,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        let payload;
        try {
          payload = JSON.parse(clientPayload || "{}");
        } catch {
          throw Object.assign(new Error("Invalid upload authorization."), { status: 401 });
        }

        let user;
        try {
          user = jwt.verify(payload.authToken, process.env.JWT_SECRET || "your-secret-key");
        } catch {
          throw Object.assign(new Error("A valid sign-in is required to upload files."), { status: 401 });
        }

        if (!user?.id || !["customer", "admin", "super_admin", "skilled_worker"].includes(user.role)) {
          throw Object.assign(new Error("You are not authorized to upload files."), { status: 403 });
        }
        if (pathname.startsWith("/") || pathname.split("/").some((part) => !part || part === "." || part === "..")) {
          throw Object.assign(new Error("Invalid upload path."), { status: 400 });
        }

        const allowedPurposes = ["uploads", "review-photos", "payment-proofs", "product-images", "progress-media", "contracts", "backup-import"];
        if (!allowedPurposes.includes(payload.purpose) || privateBackupStore !== (payload.purpose === "backup-import")) {
          throw Object.assign(new Error("Upload purpose does not match its storage."), { status: 400 });
        }
        if (["product-images", "progress-media", "contracts"].includes(payload.purpose) && !["admin", "super_admin", "skilled_worker"].includes(user.role)) {
          throw Object.assign(new Error("You are not authorized to upload this file type."), { status: 403 });
        }
        if (privateBackupStore && !["admin", "super_admin"].includes(user.role)) {
          throw Object.assign(new Error("Only administrators can import backups."), { status: 403 });
        }

        return {
          allowedContentTypes: privateBackupStore
            ? [...allowedMimeTypes, "application/zip", "application/x-gzip", "application/gzip", "application/octet-stream"]
            : allowedMimeTypes,
          maximumSizeInBytes: privateBackupStore ? 512 * 1024 * 1024 : 50 * 1024 * 1024,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ userId: user.id }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        if (!blob?.url || !tokenPayload) throw new Error("Uploaded file metadata is incomplete.");
      },
    });

    res.status(200).json(result);
  } catch (error) {
    console.error("Create Blob upload token error:", error.message);
    res.status(error.status || 400).json({ success: false, message: error.message || "Unable to authorize file upload." });
  }
};

export const createBlobUploadToken = (req, res) => createBlobUploadTokenForStore(req, res);
export const createPrivateBackupUploadToken = (req, res) => createBlobUploadTokenForStore(req, res, true);

export default { uploadImages, createBlobUploadToken, createPrivateBackupUploadToken, uploadMiddleware };
