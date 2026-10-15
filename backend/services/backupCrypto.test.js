import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ZipReader, ZipWriter, Uint8ArrayReader, Uint8ArrayWriter } from "@zip.js/zip.js";
import {
  decryptBackupBuffer,
  decryptZipBackupBuffer,
  encryptZipBackupBuffer,
  isEncryptedBackup,
  isZipBackup,
} from "./backupCrypto.js";

const testKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const createBackupZip = async (snapshot, manifest) => {
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    password: testKey,
    encryptionStrength: 3,
    useWebWorkers: false,
  });
  await writer.add("system-backup.json.gz", new Uint8ArrayReader(snapshot));
  if (manifest) await writer.add("integrity.json", new Uint8ArrayReader(Buffer.from(JSON.stringify(manifest))));
  return Buffer.from(await writer.close());
};

describe("backup encryption", () => {
  it("rejects legacy AES-encrypted backups", () => {
    const legacyEncrypted = Buffer.concat([Buffer.from("ACGCENC1"), Buffer.from("legacy payload")]);

    assert.equal(isEncryptedBackup(legacyEncrypted), true);
    assert.throws(() => decryptBackupBuffer(legacyEncrypted), /no longer supported/);
  });

  it("creates an AES-256 ZIP containing the snapshot and transaction workbook", async () => {
    const original = Buffer.from("compressed backup contents");
    const workbook = Buffer.from("xlsx workbook contents");
    const encrypted = await encryptZipBackupBuffer(original, workbook, testKey);

    assert.equal(isZipBackup(encrypted), true);
    assert.notDeepEqual(encrypted, original);
    assert.deepEqual(await decryptZipBackupBuffer(encrypted, testKey), original);

    const reader = new ZipReader(new Uint8ArrayReader(encrypted), {
      password: testKey,
      checkAuthenticationCode: true,
      useWebWorkers: false,
    });
    const entries = await reader.getEntries();
    assert.deepEqual(entries.map((entry) => entry.filename).sort(), [
      "Transactions/Transactions_Summary.xlsx",
      "integrity.json",
      "system-backup.json.gz",
    ]);
    const integrityEntry = entries.find((entry) => entry.filename === "integrity.json");
    const manifest = JSON.parse(Buffer.from(await integrityEntry.getData(new Uint8ArrayWriter())).toString("utf8"));
    assert.deepEqual(manifest, {
      algorithm: "sha256",
      digest: createHash("sha256").update(original).digest("hex"),
    });
    await reader.close();
  });

  it("creates new backup ZIPs without a transaction report workbook", async () => {
    const encrypted = await encryptZipBackupBuffer(Buffer.from("compressed backup contents"), undefined, testKey);
    const reader = new ZipReader(new Uint8ArrayReader(encrypted), {
      password: testKey,
      checkAuthenticationCode: true,
      useWebWorkers: false,
    });

    try {
      const entries = await reader.getEntries();
      assert.deepEqual(entries.map((entry) => entry.filename), ["system-backup.json.gz", "integrity.json"]);
      assert.deepEqual(await decryptZipBackupBuffer(encrypted, testKey), Buffer.from("compressed backup contents"));
    } finally {
      await reader.close();
    }
  });

  it("rejects a snapshot whose SHA-256 does not match its manifest", async () => {
    const snapshot = Buffer.from("snapshot with a mismatched hash");
    const encrypted = await createBackupZip(snapshot, {
      algorithm: "sha256",
      digest: "0".repeat(64),
    });

    await assert.rejects(decryptZipBackupBuffer(encrypted, testKey), /SHA-256 hash/);
  });

  it("continues to read legacy ZIP backups without an integrity manifest", async () => {
    const snapshot = Buffer.from("legacy compressed snapshot");
    const encrypted = await createBackupZip(snapshot);

    assert.deepEqual(await decryptZipBackupBuffer(encrypted, testKey), snapshot);
  });

  it("encrypts and decrypts ZIP backups with an owner recovery password", async () => {
    const original = Buffer.from("owner-protected backup contents");
    const recoveryPassword = "owner recovery passphrase";

    const encrypted = await encryptZipBackupBuffer(original, undefined, recoveryPassword);
    assert.deepEqual(await decryptZipBackupBuffer(encrypted, recoveryPassword), original);
    await assert.rejects(decryptZipBackupBuffer(encrypted, "incorrect recovery password"), /different recovery password/);
  });

  it("rejects ZIP archives encrypted with a different recovery password", async () => {
    const encrypted = await encryptZipBackupBuffer(Buffer.from("backup contents"), undefined, testKey);

    await assert.rejects(decryptZipBackupBuffer(encrypted, "wrong recovery password"), /different recovery password/);
  });

  it("requires a recovery password to encrypt new backups", async () => {
    await assert.rejects(encryptZipBackupBuffer(Buffer.from("backup")), /recovery password/);
  });

  it("passes legacy unencrypted backup buffers through unchanged", () => {
    const legacyBackup = Buffer.from("legacy gzip data");

    assert.equal(isEncryptedBackup(legacyBackup), false);
    assert.deepEqual(decryptBackupBuffer(legacyBackup), legacyBackup);
  });
});