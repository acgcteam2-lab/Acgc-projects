import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { ZipReader, Uint8ArrayReader } from "@zip.js/zip.js";
import {
  decryptBackupBuffer,
  decryptZipBackupBuffer,
  encryptBackupBuffer,
  encryptZipBackupBuffer,
  isEncryptedBackup,
  isZipBackup,
} from "./backupCrypto.js";

const originalKey = process.env.BACKUP_ENCRYPTION_KEY;
const testKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

before(() => {
  process.env.BACKUP_ENCRYPTION_KEY = testKey;
});

after(() => {
  if (originalKey === undefined) delete process.env.BACKUP_ENCRYPTION_KEY;
  else process.env.BACKUP_ENCRYPTION_KEY = originalKey;
});

describe("backup encryption", () => {
  it("decrypts backups using the legacy app-specific wrapper", () => {
    const original = Buffer.from("compressed backup contents");
    const encrypted = encryptBackupBuffer(original);

    assert.equal(isEncryptedBackup(encrypted), true);
    assert.notDeepEqual(encrypted, original);
    assert.deepEqual(decryptBackupBuffer(encrypted), original);
  });

  it("creates an AES-256 ZIP containing the snapshot and transaction workbook", async () => {
    const original = Buffer.from("compressed backup contents");
    const workbook = Buffer.from("xlsx workbook contents");
    const encrypted = await encryptZipBackupBuffer(original, workbook);

    assert.equal(isZipBackup(encrypted), true);
    assert.notDeepEqual(encrypted, original);
    assert.deepEqual(await decryptZipBackupBuffer(encrypted), original);

    const reader = new ZipReader(new Uint8ArrayReader(encrypted), {
      password: testKey,
      checkAuthenticationCode: true,
      useWebWorkers: false,
    });
    const entries = await reader.getEntries();
    assert.deepEqual(entries.map((entry) => entry.filename).sort(), [
      "Transactions/Transactions_Summary.xlsx",
      "system-backup.json.gz",
    ]);
    await reader.close();
  });

  it("rejects AES ZIP archives encrypted with a different key", async () => {
    const encrypted = await encryptZipBackupBuffer(Buffer.from("backup contents"));
    process.env.BACKUP_ENCRYPTION_KEY = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

    await assert.rejects(decryptZipBackupBuffer(encrypted), /different BACKUP_ENCRYPTION_KEY/);
    process.env.BACKUP_ENCRYPTION_KEY = testKey;
  });

  it("rejects encrypted backups that have been modified", () => {
    const encrypted = encryptBackupBuffer(Buffer.from("backup contents"));
    encrypted[encrypted.length - 1] ^= 1;

    assert.throws(() => decryptBackupBuffer(encrypted), /corrupted or was encrypted/);
  });

  it("requires a valid key to encrypt new backups", () => {
    delete process.env.BACKUP_ENCRYPTION_KEY;

    assert.throws(() => encryptBackupBuffer(Buffer.from("backup")), /BACKUP_ENCRYPTION_KEY/);
    process.env.BACKUP_ENCRYPTION_KEY = testKey;
  });

  it("requires the configured key to decrypt encrypted backups", () => {
    const encrypted = encryptBackupBuffer(Buffer.from("backup contents"));
    delete process.env.BACKUP_ENCRYPTION_KEY;

    assert.throws(
      () => decryptBackupBuffer(encrypted),
      (error) => error.status === 500 && /BACKUP_ENCRYPTION_KEY/.test(error.message),
    );
    process.env.BACKUP_ENCRYPTION_KEY = testKey;
  });

  it("passes legacy unencrypted backup buffers through unchanged", () => {
    const legacyBackup = Buffer.from("legacy gzip data");

    assert.equal(isEncryptedBackup(legacyBackup), false);
    assert.deepEqual(decryptBackupBuffer(legacyBackup), legacyBackup);
  });
});