import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ZipReader, ZipWriter, Uint8ArrayReader, Uint8ArrayWriter } from "@zip.js/zip.js";

const ENCRYPTED_BACKUP_PREFIX = Buffer.from("ACGCENC1");
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

const getEncryptionPassword = () => {
  const configuredKey = process.env.BACKUP_ENCRYPTION_KEY?.trim() || "";
  if (!/^[\da-f]{64}$/i.test(configuredKey)) {
    throw Object.assign(
      new Error("Set BACKUP_ENCRYPTION_KEY to a securely generated 64-character hexadecimal key before creating or importing backups."),
      { status: 500 },
    );
  }
  return configuredKey;
};

const getEncryptionKey = () => Buffer.from(getEncryptionPassword(), "hex");

export const isZipBackup = (buffer) =>
  buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;

export const encryptZipBackupBuffer = async (buffer, transactionWorkbookBuffer) => {
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    password: getEncryptionPassword(),
    encryptionStrength: 3,
    useWebWorkers: false,
  });
  await writer.add("system-backup.json.gz", new Uint8ArrayReader(buffer));
  if (transactionWorkbookBuffer) {
    await writer.add(
      "Transactions/Transactions_Summary.xlsx",
      new Uint8ArrayReader(transactionWorkbookBuffer),
    );
  }
  return Buffer.from(await writer.close());
};

export const decryptZipBackupBuffer = async (buffer) => {
  const reader = new ZipReader(new Uint8ArrayReader(buffer), {
    password: getEncryptionPassword(),
    checkAuthenticationCode: true,
    useWebWorkers: false,
  });

  try {
    const entries = await reader.getEntries();
    const snapshotEntry = entries.find((entry) => entry.filename === "system-backup.json.gz");
    const unexpectedEntries = entries.filter((entry) =>
      entry.directory || !["system-backup.json.gz", "Transactions/Transactions_Summary.xlsx"].includes(entry.filename)
    );
    if (!snapshotEntry || unexpectedEntries.length > 0 || entries.length > 2) {
      throw Object.assign(new Error("Encrypted ZIP does not contain a valid system backup."), { status: 400 });
    }
    return Buffer.from(await snapshotEntry.getData(new Uint8ArrayWriter()));
  } catch (error) {
    if (error.status) throw error;
    throw Object.assign(
      new Error("Encrypted ZIP is invalid, corrupted, or was encrypted with a different BACKUP_ENCRYPTION_KEY."),
      { status: 400 },
    );
  } finally {
    await reader.close();
  }
};

export const isEncryptedBackup = (buffer) =>
  buffer.length >= ENCRYPTED_BACKUP_PREFIX.length &&
  buffer.subarray(0, ENCRYPTED_BACKUP_PREFIX.length).equals(ENCRYPTED_BACKUP_PREFIX);

export const encryptBackupBuffer = (buffer) => {
  const key = getEncryptionKey();
  const initializationVector = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, initializationVector);
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([
    ENCRYPTED_BACKUP_PREFIX,
    initializationVector,
    cipher.getAuthTag(),
    ciphertext,
  ]);
};

export const decryptBackupBuffer = (buffer) => {
  if (!isEncryptedBackup(buffer)) return buffer;

  const minimumLength = ENCRYPTED_BACKUP_PREFIX.length + IV_LENGTH + AUTH_TAG_LENGTH + 1;
  if (buffer.length < minimumLength) {
    throw Object.assign(new Error("Encrypted backup is invalid or corrupted."), { status: 400 });
  }

  const key = getEncryptionKey();
  const ivStart = ENCRYPTED_BACKUP_PREFIX.length;
  const tagStart = ivStart + IV_LENGTH;
  const ciphertextStart = tagStart + AUTH_TAG_LENGTH;
  const decipher = createDecipheriv("aes-256-gcm", key, buffer.subarray(ivStart, tagStart));
  decipher.setAuthTag(buffer.subarray(tagStart, ciphertextStart));

  try {
    return Buffer.concat([
      decipher.update(buffer.subarray(ciphertextStart)),
      decipher.final(),
    ]);
  } catch {
    throw Object.assign(
      new Error("Encrypted backup is corrupted or was encrypted with a different BACKUP_ENCRYPTION_KEY."),
      { status: 400 },
    );
  }
};