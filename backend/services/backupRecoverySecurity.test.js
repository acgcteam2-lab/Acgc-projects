import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  hashBackupRecoveryPassword,
  validateBackupRecoveryPassword,
  verifyBackupRecoveryPassword,
} from "./backupRecoverySecurity.js";

describe("backup recovery password security", () => {
  it("stores only a salted verifier and verifies the matching password", async () => {
    const password = "Long-Recovery-Password-2030!";
    const verifier = await hashBackupRecoveryPassword(password);

    assert.match(verifier.salt, /^[\da-f]{32}$/);
    assert.match(verifier.hash, /^[\da-f]{128}$/);
    assert.notEqual(verifier.hash, password);
    assert.equal(await verifyBackupRecoveryPassword(password, verifier.salt, verifier.hash), true);
    assert.equal(await verifyBackupRecoveryPassword("incorrect recovery password", verifier.salt, verifier.hash), false);
  });

  it("rejects short and default recovery passwords", () => {
    assert.throws(() => validateBackupRecoveryPassword("short"), /uppercase, lowercase, a number, and a symbol/);
    assert.throws(() => validateBackupRecoveryPassword("ACGC-2026"), /default recovery password/);
  });

  it("rejects malformed stored verifiers", async () => {
    assert.equal(await verifyBackupRecoveryPassword("long enough passphrase", "bad", "bad"), false);
  });
});