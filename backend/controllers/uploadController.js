import fs from "fs";
import path from "path";
import multer from "multer";
import jwt from "jsonwebtoken";
import process from "node:process";
import { handleUpload } from "@vercel/blob/client";
import { uploadImageBuffer } from "../config/cloudinary.js";

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

const productImageUploadParser = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    if (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.mimetype)) {
      return cb(null, true);
    }
    const error = new Error("Product photos must be JPEG, PNG, WEBP, or GIF images.");
    error.status = 400;
    return cb(error);
  },
  limits: { fileSize: 4 * 1024 * 1024, files: 5 },
}).fields([
  { name: "main", maxCount: 1 },
  { name: "left", maxCount: 1 },
  { name: "right", maxCount: 1 },
  { name: "top", maxCount: 1 },
  { name: "bottom", maxCount: 1 },
  { name: "files", maxCount: 5 },
]);

export const productImageUploadMiddleware = (req, res, next) => {
  productImageUploadParser(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      const message = error.code === "LIMIT_FILE_SIZE"
        ? "Product photos must be 4 MB or smaller."
        : error.code === "LIMIT_FILE_COUNT"
        ? "Upload no more than 5 product photos at a time."
        : "Unable to process product photos.";
      return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ success: false, message });
    }
    return res.status(error.status || 400).json({ success: false, message: error.message });
  });
};

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

export const uploadProductImages = async (req, res) => {
  const files = Object.entries(req.files || {}).flatMap(([key, fieldFiles]) =>
    fieldFiles.map((file) => ({ key: key === "files" ? file.fieldname : key, file }))
  );

  if (files.length === 0) {
    return res.status(400).json({ success: false, message: "No product photos uploaded." });
  }
  if (files.reduce((size, { file }) => size + file.size, 0) > 4 * 1024 * 1024) {
    return res.status(413).json({ success: false, message: "Product photos must total 4 MB or less per upload." });
  }

  try {
    const saved = await Promise.all(files.map(async ({ key, file }) => {
      const result = await uploadImageBuffer(file.buffer, { folder: "acgc/products" });
      return {
        key,
        url: result.secure_url,
        filename: result.public_id,
        width: result.width,
        height: result.height,
        format: result.format,
      };
    }));

    return res.status(201).json({ success: true, files: saved });
  } catch (error) {
    const upstreamStatus = Number(error.http_code || error.status) || null;
    const upstreamMessage = (error.message || "Cloudinary upload failed")
      .replace(process.env.CLOUDINARY_API_KEY || "\u0000", "[redacted]")
      .replace(process.env.CLOUDINARY_API_SECRET || "\u0000", "[redacted]");
    console.error("Product image Cloudinary upload failed:", {
      status: upstreamStatus,
      message: upstreamMessage,
    });

    const isDisabledApiKey = upstreamStatus === 401 && /disabled api[_ ]key/i.test(upstreamMessage);
    const message = error.status === 503
      ? error.message
      : isDisabledApiKey
      ? "Cloudinary says the configured API key is disabled. Create or copy an active API key from the same Cloudinary account, update the backend environment variables, then redeploy."
      : upstreamStatus === 401
      ? "Cloudinary rejected the API credentials. Verify that CLOUDINARY_URL or the split Cloudinary variables contain the matching active credentials from the same Cloudinary account, then redeploy the backend."
      : upstreamStatus === 400
      ? "Cloudinary rejected the image data. Try a valid JPEG, PNG, WEBP, or GIF under 4 MB."
      : "Cloudinary upload failed. Check the backend function logs for the upstream error.";

    return res.status(error.status || 502).json({
      success: false,
      message,
      ...(upstreamStatus ? { upstreamStatus } : {}),
    });
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

export default {
  uploadImages,
  uploadProductImages,
  createBlobUploadToken,
  createPrivateBackupUploadToken,
  uploadMiddleware,
};
