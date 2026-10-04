import { randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { Storage } from "@google-cloud/storage";

let storageClient;

const readCredentials = () => {
  const rawCredentials = process.env.GOOGLE_CLOUD_CREDENTIALS_JSON;
  if (!rawCredentials) return undefined;
  try {
    return JSON.parse(rawCredentials);
  } catch {
    throw new Error("GOOGLE_CLOUD_CREDENTIALS_JSON must contain valid service-account JSON.");
  }
};

const getStorageClient = () => {
  if (!storageClient) {
    const credentials = readCredentials();
    storageClient = new Storage({
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID || credentials?.project_id,
      ...(credentials ? { credentials } : {}),
    });
  }
  return storageClient;
};

export const isCloudStorageEnabled = () => Boolean(
  process.env.GCS_MEDIA_BUCKET && process.env.GCS_BACKUP_BUCKET,
);

export const requireCloudStorage = () => {
  if (!isCloudStorageEnabled()) {
    throw Object.assign(new Error("Set GCS_MEDIA_BUCKET and GCS_BACKUP_BUCKET to enable Cloud Storage."), { status: 503 });
  }
  return getStorageClient();
};

const getBucket = (bucketName) => requireCloudStorage().bucket(bucketName);

const safeFilename = (name) => {
  const basename = path.win32.basename(String(name || "upload"));
  return basename.replace(/[^A-Za-z0-9._-]/g, "_").slice(-140) || "upload";
};

const safeSegment = (value) => String(value || "anonymous").replace(/[^A-Za-z0-9_-]/g, "_");

export const createCloudUploadUrl = async ({ purpose, fileName, contentType, userId }) => {
  const isBackup = purpose === "backup-import";
  const bucketName = isBackup ? process.env.GCS_BACKUP_BUCKET : process.env.GCS_MEDIA_BUCKET;
  if (!bucketName) throw Object.assign(new Error(isBackup ? "GCS_BACKUP_BUCKET is not configured." : "GCS_MEDIA_BUCKET is not configured."), { status: 503 });

  const objectKey = isBackup
    ? `imports/${safeSegment(userId)}/${randomUUID()}-${safeFilename(fileName)}`
    : `uploads/${safeSegment(purpose)}/${safeSegment(userId)}/${randomUUID()}-${safeFilename(fileName)}`;
  const file = getBucket(bucketName).file(objectKey);
  const [uploadUrl] = await file.getSignedUrl({
    version: "v4",
    action: "write",
    expires: Date.now() + 15 * 60 * 1000,
    contentType: contentType || "application/octet-stream",
  });
  const publicUrl = isBackup
    ? ""
    : `https://storage.googleapis.com/${encodeURIComponent(bucketName)}/${objectKey.split("/").map(encodeURIComponent).join("/")}`;

  return { uploadUrl, publicUrl, objectKey, bucketName, contentType: contentType || "application/octet-stream" };
};

export const getPublicMediaFiles = async () => {
  const bucketName = process.env.GCS_MEDIA_BUCKET;
  if (!bucketName) throw new Error("GCS_MEDIA_BUCKET is not configured.");
  const [files] = await getBucket(bucketName).getFiles({ prefix: "uploads/" });
  return Promise.all(files.map(async (file) => {
    const [contents] = await file.download();
    return {
      path: file.name.replace(/^uploads\//, ""),
      content: contents.toString("base64"),
      contentType: file.metadata.contentType || "application/octet-stream",
    };
  }));
};

export const restorePublicMediaFiles = async (files) => {
  const bucketName = process.env.GCS_MEDIA_BUCKET;
  if (!bucketName) throw new Error("GCS_MEDIA_BUCKET is not configured.");
  const bucket = getBucket(bucketName);
  const [existingFiles] = await bucket.getFiles({ prefix: "uploads/" });
  if (existingFiles.length) await Promise.all(existingFiles.map((file) => file.delete().catch(() => {})));

  for (const entry of files) {
    const normalizedPath = String(entry.path || "").replaceAll("\\", "/");
    if (!normalizedPath || normalizedPath.startsWith("/") || normalizedPath.split("/").includes("..")) {
      throw new Error("Backup contains an invalid upload path.");
    }
    const file = bucket.file(`uploads/${normalizedPath}`);
    await file.save(Buffer.from(entry.content, "base64"), {
      resumable: false,
      metadata: { contentType: entry.contentType || "application/octet-stream" },
    });
  }
};

export const savePrivateBackup = async (objectKey, buffer) => {
  const bucketName = process.env.GCS_BACKUP_BUCKET;
  if (!bucketName) throw new Error("GCS_BACKUP_BUCKET is not configured.");
  await getBucket(bucketName).file(objectKey).save(buffer, {
    resumable: false,
    metadata: { contentType: "application/zip" },
  });
};

export const readPrivateBackup = async (objectKey) => {
  const bucketName = process.env.GCS_BACKUP_BUCKET;
  if (!bucketName) throw new Error("GCS_BACKUP_BUCKET is not configured.");
  const [contents] = await getBucket(bucketName).file(objectKey).download();
  return contents;
};

export const deletePrivateBackup = async (objectKey) => {
  const bucketName = process.env.GCS_BACKUP_BUCKET;
  if (!bucketName) throw new Error("GCS_BACKUP_BUCKET is not configured.");
  await getBucket(bucketName).file(objectKey).delete({ ignoreNotFound: true });
};

export const getPrivateBackupDownloadUrl = async (objectKey) => {
  const bucketName = process.env.GCS_BACKUP_BUCKET;
  if (!bucketName) throw new Error("GCS_BACKUP_BUCKET is not configured.");
  const [url] = await getBucket(bucketName).file(objectKey).getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + 5 * 60 * 1000,
  });
  return url;
};