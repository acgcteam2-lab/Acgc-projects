import { createHash } from "node:crypto";
import { ZipReader, ZipWriter, Uint8ArrayReader, Uint8ArrayWriter } from "@zip.js/zip.js";

const ENCRYPTED_BACKUP_PREFIX = Buffer.from("ACGCENC1");

const getEncryptionPassword = (password) => {
  if (typeof password === "string" && password.length > 0) return password;
  throw Object.assign(
    new Error("Set a backup recovery password in Settings before creating backups."),
    { status: 500 },
  );
};

export const isZipBackup = (buffer) =>
  buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;

export const encryptZipBackupBuffer = async (buffer, transactionWorkbookBuffer, password) => {
  const integrityManifest = Buffer.from(JSON.stringify({
    algorithm: "sha256",
    digest: createHash("sha256").update(buffer).digest("hex"),
  }));
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    password: getEncryptionPassword(password),
    encryptionStrength: 3,
    useWebWorkers: false,
  });
  await writer.add("system-backup.json.gz", new Uint8ArrayReader(buffer));
  await writer.add("integrity.json", new Uint8ArrayReader(integrityManifest));
  if (transactionWorkbookBuffer) {
    await writer.add(
      "Transactions/Transactions_Summary.xlsx",
      new Uint8ArrayReader(transactionWorkbookBuffer),
    );
  }
  return Buffer.from(await writer.close());
};

export const decryptZipBackupBuffer = async (buffer, password) => {
  const reader = new ZipReader(new Uint8ArrayReader(buffer), {
    password: typeof password === "string" && password.length > 0 ? password : undefined,
    checkAuthenticationCode: true,
    useWebWorkers: false,
  });

  try {
    const entries = await reader.getEntries();
    const snapshotEntry = entries.find((entry) => entry.filename === "system-backup.json.gz");
    const integrityEntry = entries.find((entry) => entry.filename === "integrity.json");
    const unexpectedEntries = entries.filter((entry) =>
      entry.directory || !["system-backup.json.gz", "integrity.json", "Transactions/Transactions_Summary.xlsx"].includes(entry.filename)
    );
    if (!snapshotEntry || unexpectedEntries.length > 0 || entries.length > 3) {
      throw Object.assign(new Error("Encrypted ZIP does not contain a valid system backup."), { status: 400 });
    }
    const snapshotBuffer = Buffer.from(await snapshotEntry.getData(new Uint8ArrayWriter()));
    if (integrityEntry) {
      let manifest;
      try {
        manifest = JSON.parse(Buffer.from(await integrityEntry.getData(new Uint8ArrayWriter())).toString("utf8"));
      } catch {
        throw Object.assign(new Error("Backup integrity manifest is invalid."), { status: 400 });
      }
      if (manifest?.algorithm !== "sha256" || !/^[\da-f]{64}$/.test(manifest.digest || "")) {
        throw Object.assign(new Error("Backup integrity manifest is invalid."), { status: 400 });
      }
      const actualDigest = createHash("sha256").update(snapshotBuffer).digest("hex");
      if (actualDigest !== manifest.digest) {
        throw Object.assign(new Error("Backup integrity check failed; the snapshot does not match its SHA-256 hash."), { status: 400 });
      }
    }
    return snapshotBuffer;
  } catch (error) {
    if (error.status) throw error;
    throw Object.assign(new Error("Encrypted ZIP is invalid, corrupted, or was encrypted with a different recovery password."), { status: 400 });
  } finally {
    await reader.close();
  }
};

export const isEncryptedBackup = (buffer) =>
  buffer.length >= ENCRYPTED_BACKUP_PREFIX.length &&
  buffer.subarray(0, ENCRYPTED_BACKUP_PREFIX.length).equals(ENCRYPTED_BACKUP_PREFIX);

export const decryptBackupBuffer = (buffer) => {
  if (!isEncryptedBackup(buffer)) return buffer;
  throw Object.assign(
    new Error("Legacy AES-encrypted backups are no longer supported. Upload a ZIP backup protected with your recovery password."),
    { status: 400 },
  );
};