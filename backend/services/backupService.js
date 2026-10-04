import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import process from "node:process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { gzip, gunzip } from "node:zlib";
import mongoose from "mongoose";
import {
  deletePrivateBackup,
  getPrivateBackupDownloadUrl,
  getPublicMediaFiles,
  isCloudStorageEnabled,
  readPrivateBackup,
  restorePublicMediaFiles,
  savePrivateBackup,
} from "./cloudStorage.js";
import SystemSetting from "../models/SystemSetting.js";
import { createTransactionWorkbookBuffer } from "./transactionWorkbook.js";
import {
  decryptBackupBuffer,
  decryptZipBackupBuffer,
  encryptZipBackupBuffer,
  isEncryptedBackup,
  isZipBackup,
} from "./backupCrypto.js";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const BACKUP_FORMAT = "acgc-system-backup-v1";
const VALID_TYPES = new Set(["Weekly", "Monthly", "Yearly", "Full System", "Pre-Restore", "Imported"]);
const SCHEDULED_BACKUP_TYPES = { weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" };
let scheduledBackupTimer;

const getBackupDirectory = () => path.join(process.cwd(), "backups");
const getUploadsDirectory = () => path.resolve(process.cwd(), "uploads");
const isVercelRuntime = () => process.env.VERCEL === "1";
const usesCloudStorage = () => isVercelRuntime() || isCloudStorageEnabled();

const backupError = (message, status = 400) => Object.assign(new Error(message), { status });

const assertBackupId = (backupId) => {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(backupId || "")) {
    throw backupError("Backup not found.", 404);
  }
};

const readUploadFiles = async (directory, root = directory) => {
  if (usesCloudStorage()) {
    if (directory !== getUploadsDirectory() || root !== directory) return [];
    return getPublicMediaFiles();
  }

  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT" && directory === root) return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await readUploadFiles(absolutePath, root));
    } else if (entry.isFile()) {
      files.push({
        path: path.relative(root, absolutePath).split(path.sep).join("/"),
        content: (await fs.readFile(absolutePath)).toString("base64"),
      });
    }
  }
  return files;
};

const createSnapshotBuffer = async () => {
  const database = mongoose.connection.db;
  if (!database) throw backupError("MongoDB is not connected.", 503);

  const collectionInfo = await database.listCollections({}, { nameOnly: true }).toArray();
  const collections = [];
  for (const { name } of collectionInfo) {
    if (name.startsWith("system.")) continue;
    const documents = await database.collection(name).find({}).toArray();
    collections.push({ name, documents });
  }

  const snapshot = {
    format: BACKUP_FORMAT,
    createdAt: new Date().toISOString(),
    collections,
    uploads: await readUploadFiles(getUploadsDirectory()),
  };

  const extendedJson = mongoose.mongo.BSON.EJSON.stringify(snapshot, { relaxed: false });
  return {
    buffer: await gzipAsync(Buffer.from(extendedJson, "utf8")),
    orders: collections.find((collection) => collection.name === "orders")?.documents || [],
    users: collections.find((collection) => collection.name === "users")?.documents || [],
  };
};

const getCompressedSnapshotBuffer = async (buffer) => {
  if (isZipBackup(buffer)) return decryptZipBackupBuffer(buffer);
  return decryptBackupBuffer(buffer);
};

const parseSnapshot = async (buffer) => {
  let snapshot;
  try {
    const compressedBuffer = await getCompressedSnapshotBuffer(buffer);
    snapshot = mongoose.mongo.BSON.EJSON.parse((await gunzipAsync(compressedBuffer)).toString("utf8"), { relaxed: false });
  } catch (error) {
    if (error.status === 500) throw error;
    throw backupError("Backup file is invalid or corrupted.", 400);
  }

  if (
    snapshot?.format !== BACKUP_FORMAT ||
    !Array.isArray(snapshot.collections) ||
    !Array.isArray(snapshot.uploads) ||
    !snapshot.collections.every((collection) =>
      typeof collection?.name === "string" &&
      /^[A-Za-z0-9_.-]+$/.test(collection.name) &&
      !collection.name.startsWith("system.") &&
      Array.isArray(collection.documents)
    ) ||
    !snapshot.uploads.every((file) => typeof file?.path === "string" && typeof file?.content === "string")
  ) {
    throw backupError("Backup file is invalid or corrupted.", 400);
  }

  return snapshot;
};

const getSafeUploadPath = (root, relativePath) => {
  const normalized = relativePath.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw backupError("Backup contains an invalid upload path.", 400);
  }
  const absolutePath = path.resolve(root, ...normalized.split("/"));
  if (!absolutePath.startsWith(`${root}${path.sep}`)) {
    throw backupError("Backup contains an invalid upload path.", 400);
  }
  return absolutePath;
};

const copyDirectoryContents = async (source, destination) => {
  await fs.mkdir(destination, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyDirectoryContents(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      await fs.copyFile(sourcePath, destinationPath);
    }
  }
};

const restoreUploadFiles = async (files) => {
  if (usesCloudStorage()) {
    await restorePublicMediaFiles(files);
    return;
  }

  const uploadsDirectory = getUploadsDirectory();
  const stagingDirectory = `${uploadsDirectory}.restore-${randomUUID()}`;
  const previousDirectory = `${uploadsDirectory}.previous-${randomUUID()}`;
  await fs.mkdir(stagingDirectory, { recursive: true });

  try {
    for (const file of files) {
      const destination = getSafeUploadPath(stagingDirectory, file.path);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, Buffer.from(file.content, "base64"), { flag: "wx" });
    }

    let movedPrevious = false;
    try {
      await fs.rename(uploadsDirectory, previousDirectory);
      movedPrevious = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    try {
      try {
        await fs.rename(stagingDirectory, uploadsDirectory);
      } catch (error) {
        if (!["EPERM", "EACCES", "EBUSY", "EEXIST", "ENOTEMPTY"].includes(error.code)) throw error;
        await copyDirectoryContents(stagingDirectory, uploadsDirectory);
        await fs.rm(stagingDirectory, { recursive: true, force: true });
      }
    } catch (error) {
      if (movedPrevious) {
        await fs.rm(uploadsDirectory, { recursive: true, force: true });
        await fs.rename(previousDirectory, uploadsDirectory);
      }
      throw error;
    }

    if (movedPrevious) {
      try {
        await fs.rm(previousDirectory, { recursive: true, force: true });
      } catch (error) {
        console.warn(`[backup] Restored uploads, but could not remove the previous upload directory ${previousDirectory}:`, error);
      }
    }
  } catch (error) {
    await fs.rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
};

const applySnapshot = async (snapshot) => {
  const database = mongoose.connection.db;
  const existingCollections = await database.listCollections({}, { nameOnly: true }).toArray();
  for (const { name } of existingCollections) {
    if (!name.startsWith("system.")) {
      await database.collection(name).deleteMany({});
    }
  }

  for (const { name, documents } of snapshot.collections) {
    const collection = database.collection(name);
    for (let offset = 0; offset < documents.length; offset += 500) {
      await collection.insertMany(documents.slice(offset, offset + 500), { ordered: true });
    }
  }

  await restoreUploadFiles(snapshot.uploads);
};

const findBackupRecord = async (backupId) => {
  assertBackupId(backupId);
  const settings = await SystemSetting.findOne({ key: "global" }).lean();
  const backup = settings?.backup_history?.find((item) => item.id === backupId);
  if (!backup) throw backupError("Backup not found.", 404);
  return { settings, backup };
};

const getBackupFilePath = (backupId) => path.join(getBackupDirectory(), `${backupId}.zip`);
const getLegacyEncryptedBackupFilePath = (backupId) => path.join(getBackupDirectory(), `${backupId}.json.gz.enc`);
const getLegacyBackupFilePath = (backupId) => path.join(getBackupDirectory(), `${backupId}.json.gz`);
const getBackupObjectKey = (backupId) => `backups/${backupId}.zip`;

const getStoredBackupBuffer = async (backupId) => {
  if (usesCloudStorage()) {
    return readPrivateBackup(getBackupObjectKey(backupId));
  }

  for (const filePath of [
    getBackupFilePath(backupId),
    getLegacyEncryptedBackupFilePath(backupId),
    getLegacyBackupFilePath(backupId),
  ]) {
    try {
      return await fs.readFile(filePath);
    } catch {
      continue;
    }
  }
  throw backupError("Backup file is not available.", 404);
};

const storeBackupBuffer = async (backupId, buffer) => {
  if (usesCloudStorage()) {
    await savePrivateBackup(getBackupObjectKey(backupId), buffer);
    return;
  }

  const backupDirectory = getBackupDirectory();
  const filePath = getBackupFilePath(backupId);
  const temporaryPath = `${filePath}.tmp`;
  await fs.mkdir(backupDirectory, { recursive: true });
  await fs.writeFile(temporaryPath, buffer, { flag: "wx" });
  await fs.rename(temporaryPath, filePath);
};

const deleteStoredBackup = async (backupId) => {
  if (usesCloudStorage()) {
    await deletePrivateBackup(getBackupObjectKey(backupId));
    return;
  }
  await Promise.all([
    fs.rm(getBackupFilePath(backupId), { force: true }),
    fs.rm(getLegacyEncryptedBackupFilePath(backupId), { force: true }),
    fs.rm(getLegacyBackupFilePath(backupId), { force: true }),
  ]);
};

export const createSystemBackup = async (type) => {
  if (!VALID_TYPES.has(type)) throw backupError("Invalid backup type.", 400);

  const id = randomUUID();
  const now = new Date();
  const snapshot = await createSnapshotBuffer();
  const transactionWorkbook = await createTransactionWorkbookBuffer(snapshot.orders, snapshot.users);
  const backupBuffer = await encryptZipBackupBuffer(snapshot.buffer, transactionWorkbook);
  const backup = {
    id,
    name: `${type.toUpperCase().replace(/\s+/g, "_")}_BACKUP_${now.toISOString().slice(0, 10)}`,
    type,
    date: now.toISOString(),
    size: Number((backupBuffer.length / (1024 * 1024)).toFixed(1)),
    status: "Success",
  };

  try {
    await storeBackupBuffer(id, backupBuffer);
    const settings = await SystemSetting.findOneAndUpdate(
      { key: "global" },
      {
        $set: { backup_status: "Success", last_backup_at: now },
        $push: { backup_history: { $each: [backup], $position: 0 } },
      },
      { returnDocument: "after", upsert: true, setDefaultsOnInsert: true }
    ).lean();
    return {
      backup,
      backup_schedule: settings.backup_schedule || "weekly",
      backup_status: settings.backup_status || "Success",
      last_backup_at: settings.last_backup_at || now,
      backup_history: settings.backup_history || [backup],
    };
  } catch (error) {
    await deleteStoredBackup(id).catch(() => {});
    throw error;
  }
};

export const importSystemBackup = async (source) => {
  const uploadedBuffer = Buffer.isBuffer(source) ? source : await fs.readFile(source);
  await parseSnapshot(uploadedBuffer);
  const backupBuffer = isZipBackup(uploadedBuffer)
    ? uploadedBuffer
    : await encryptZipBackupBuffer(await getCompressedSnapshotBuffer(uploadedBuffer));

  const id = randomUUID();
  const now = new Date();
  const type = "Imported";
  const backup = {
    id,
    name: `IMPORTED_BACKUP_${now.toISOString().slice(0, 10)}`,
    type,
    date: now.toISOString(),
    size: Number((backupBuffer.length / (1024 * 1024)).toFixed(1)),
    status: "Success",
  };

  try {
    await storeBackupBuffer(id, backupBuffer);
    const settings = await SystemSetting.findOneAndUpdate(
      { key: "global" },
      {
        $set: { backup_status: "Success", last_backup_at: now },
        $push: { backup_history: { $each: [backup], $position: 0 } },
      },
      { returnDocument: "after", upsert: true, setDefaultsOnInsert: true }
    ).lean();
    return {
      backup,
      backup_schedule: settings.backup_schedule || "weekly",
      backup_status: settings.backup_status || "Success",
      last_backup_at: settings.last_backup_at || now,
      backup_history: settings.backup_history || [backup],
    };
  } catch (error) {
    await deleteStoredBackup(id).catch(() => {});
    throw error;
  }
};

export const importSystemBackupFromCloudStorage = async (objectKey) => {
  const normalizedPath = String(objectKey || "").replaceAll("\\", "/");
  if (!normalizedPath.startsWith("imports/") || normalizedPath.split("/").includes("..")) {
    throw backupError("Backup import file is invalid.", 400);
  }

  try {
    const buffer = await readPrivateBackup(normalizedPath);
    return await importSystemBackup(buffer);
  } finally {
    await deletePrivateBackup(normalizedPath).catch((error) => {
      console.error("Unable to remove temporary backup import from Cloud Storage:", error.message);
    });
  }
};

export const getSystemBackupDownload = async (backupId) => {
  const { backup } = await findBackupRecord(backupId);
  if (usesCloudStorage()) {
    return {
      redirectUrl: await getPrivateBackupDownloadUrl(getBackupObjectKey(backupId)),
      filename: `${backup.name}.zip`,
    };
  }

  let buffer;
  try {
    buffer = await getStoredBackupBuffer(backupId);
  } catch {
    throw backupError("Backup file is not available for download.", 404);
  }
  return { buffer, filename: `${backup.name}.zip` };
};

export const restoreSystemBackup = async (backupId) => {
  const { settings, backup } = await findBackupRecord(backupId);
  let backupBuffer;
  try {
    backupBuffer = await getStoredBackupBuffer(backupId);
  } catch {
    throw backupError("Backup file is not available for restore.", 404);
  }

  const snapshot = await parseSnapshot(backupBuffer);
  const recoveryBackupResult = await createSystemBackup("Pre-Restore");
  const recoveryBackupPath = usesCloudStorage() ? getBackupObjectKey(recoveryBackupResult.backup.id) : getBackupFilePath(recoveryBackupResult.backup.id);
  const recoveryBuffer = await getStoredBackupBuffer(recoveryBackupResult.backup.id);
  const rollbackSnapshot = await parseSnapshot(recoveryBuffer);
  try {
    await applySnapshot(snapshot);
    const database = mongoose.connection.db;
    await database.collection("users").updateMany({}, { $inc: { session_version: 1 } });
    await database.collection("admins").updateMany({}, { $inc: { session_version: 1 } });
  } catch (restoreError) {
    try {
      await applySnapshot(rollbackSnapshot);
    } catch (rollbackError) {
      console.error("Backup restore rollback failed:", rollbackError);
      try {
        const latestSettings = await SystemSetting.findOne({ key: "global" }).lean();
        const backupHistory = Array.isArray(latestSettings?.backup_history)
          ? latestSettings.backup_history.filter((item) => item.id !== recoveryBackupResult.backup.id)
          : [];
        await SystemSetting.findOneAndUpdate(
          { key: "global" },
          {
            $set: {
              backup_schedule: recoveryBackupResult.backup_schedule || settings?.backup_schedule || "weekly",
              backup_status: "Recovery Required",
              last_backup_at: recoveryBackupResult.last_backup_at || settings?.last_backup_at || null,
              backup_history: [recoveryBackupResult.backup, ...backupHistory],
            },
          },
          { returnDocument: "after", upsert: true, setDefaultsOnInsert: true }
        );
      } catch (metadataError) {
        console.error("Unable to expose the pre-restore recovery snapshot in backup history:", metadataError);
      }
      throw backupError(
        `Restore failed: ${restoreError.message}. Automatic rollback also failed: ${rollbackError.message}. Pre-restore recovery snapshot ${recoveryBackupResult.backup.name} (${recoveryBackupResult.backup.id}) is retained at ${recoveryBackupPath}.`,
        500
      );
    }
    try {
      await SystemSetting.findOneAndUpdate(
        { key: "global" },
        {
          $set: {
            backup_schedule: recoveryBackupResult.backup_schedule || settings?.backup_schedule || "weekly",
            backup_status: "Restore Failed - Recovered",
            last_backup_at: recoveryBackupResult.last_backup_at || settings?.last_backup_at || null,
            backup_history: recoveryBackupResult.backup_history || settings?.backup_history || [],
          },
        },
        { returnDocument: "after", upsert: true, setDefaultsOnInsert: true }
      );
    } catch (metadataError) {
      console.error("Unable to update backup history after successful rollback:", metadataError);
    }
    throw backupError(
      `Restore failed: ${restoreError.message}. The pre-restore database and uploads were recovered. Recovery snapshot ${recoveryBackupResult.backup.name} (${recoveryBackupResult.backup.id}) is retained at ${recoveryBackupPath}.`,
      restoreError.status || 500
    );
  }

  const history = Array.isArray(recoveryBackupResult.backup_history)
    ? recoveryBackupResult.backup_history
    : Array.isArray(settings?.backup_history)
      ? settings.backup_history
      : [];
  const restoredAt = snapshot.createdAt ? new Date(snapshot.createdAt) : new Date(backup.date);
  const updatedSettings = await SystemSetting.findOneAndUpdate(
    { key: "global" },
    {
      $set: {
        backup_schedule: recoveryBackupResult.backup_schedule || settings?.backup_schedule || "weekly",
        backup_status: "Restored",
        last_backup_at: recoveryBackupResult.last_backup_at || restoredAt,
        backup_history: history,
      },
    },
    { returnDocument: "after", upsert: true, setDefaultsOnInsert: true }
  ).lean();

  return {
    backup_schedule: updatedSettings.backup_schedule || "weekly",
    backup_status: updatedSettings.backup_status || "Restored",
    last_backup_at: updatedSettings.last_backup_at || restoredAt,
    backup_history: updatedSettings.backup_history || history,
    restored_backup: backup,
    logout_required: true,
  };
};

export const deleteSystemBackup = async (backupId) => {
  const { settings, backup } = await findBackupRecord(backupId);
  const backupHistory = (settings.backup_history || []).filter((item) => item.id !== backupId);
  const remainingLatestDate = backupHistory[0]?.date || null;
  await deleteStoredBackup(backupId);

  const updatedSettings = await SystemSetting.findOneAndUpdate(
    { key: "global" },
    {
      $set: {
        backup_history: backupHistory,
        last_backup_at: remainingLatestDate,
        backup_status: backupHistory.length ? settings.backup_status || "Success" : "Success",
      },
    },
    { returnDocument: "after", upsert: true, setDefaultsOnInsert: true }
  ).lean();

  return {
    deleted_backup: backup,
    backup_schedule: updatedSettings.backup_schedule || "weekly",
    backup_status: updatedSettings.backup_status || "Success",
    last_backup_at: updatedSettings.last_backup_at || null,
    backup_history: updatedSettings.backup_history || backupHistory,
  };
};

const getScheduledBackupKey = (schedule, date) => {
  const dateKey = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
  return `${schedule}:${dateKey}`;
};

const isScheduledBackupDue = (schedule, date) => {
  if (schedule === "weekly") return date.getDay() === 0;
  if (schedule === "monthly") return date.getDate() === 1;
  if (schedule === "yearly") return date.getMonth() === 11 && date.getDate() === 31;
  return false;
};

export const runScheduledBackup = async () => {
  if (mongoose.connection.readyState !== 1) return;

  const now = new Date();
  const settings = await SystemSetting.findOne({ key: "global" })
    .select("backup_schedule last_scheduled_backup_key")
    .lean();
  const schedule = settings?.backup_schedule;
  if (!settings || !SCHEDULED_BACKUP_TYPES[schedule] || !isScheduledBackupDue(schedule, now)) return;

  const scheduleKey = getScheduledBackupKey(schedule, now);
  if (settings.last_scheduled_backup_key === scheduleKey) return;

  const claim = await SystemSetting.findOneAndUpdate(
    {
      _id: settings._id,
      backup_schedule: schedule,
      $or: [
        { last_scheduled_backup_key: { $exists: false } },
        { last_scheduled_backup_key: null },
        { last_scheduled_backup_key: { $ne: scheduleKey } },
      ],
    },
    { $set: { last_scheduled_backup_key: scheduleKey } },
    { returnDocument: "after" }
  ).lean();
  if (!claim) return;

  try {
    const result = await createSystemBackup(SCHEDULED_BACKUP_TYPES[schedule]);
    console.info(`[backup] Scheduled ${schedule} snapshot created: ${result.backup.name}`);
  } catch (error) {
    await SystemSetting.updateOne(
      { _id: settings._id, last_scheduled_backup_key: scheduleKey },
      { $unset: { last_scheduled_backup_key: 1 } }
    );
    throw error;
  }
};

export const startSystemBackupScheduler = () => {
  if (scheduledBackupTimer) return;

  const checkSchedule = () => {
    runScheduledBackup().catch((error) => console.error("Scheduled backup failed:", error));
  };

  checkSchedule();
  scheduledBackupTimer = setInterval(checkSchedule, 60_000);
  scheduledBackupTimer.unref?.();
};