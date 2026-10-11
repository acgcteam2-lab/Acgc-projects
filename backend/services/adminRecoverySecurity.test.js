import assert from "node:assert/strict";
import test from "node:test";
import {
  createTotpCode,
  getRecoveryRetryDelaySeconds,
  isValidAdminRecord,
  recoveryConfigurationIsValid,
  verifyRecoveryCredentials,
} from "./adminRecoverySecurity.js";

const testEnvironment = {
  ADMIN_RECOVERY_USERNAME: "system-owner",
  ADMIN_RECOVERY_SECRET: "a".repeat(40),
  ADMIN_RECOVERY_TOTP_SECRET: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
};

test("TOTP matches the RFC 6238 SHA-1 six-digit test vector", () => {
  assert.equal(createTotpCode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 1), "287082");
});

test("recovery configuration requires strong server-side secrets", () => {
  assert.equal(recoveryConfigurationIsValid(testEnvironment), true);
  assert.equal(recoveryConfigurationIsValid({ ...testEnvironment, ADMIN_RECOVERY_SECRET: "short" }), false);
  assert.equal(recoveryConfigurationIsValid({ ...testEnvironment, ADMIN_RECOVERY_TOTP_SECRET: "bad!" }), false);
});

test("owner credentials and current TOTP are verified without revealing which value failed", () => {
  const timestamp = 1_800_000_000_000;
  const step = Math.floor(timestamp / 30_000);
  const code = createTotpCode(testEnvironment.ADMIN_RECOVERY_TOTP_SECRET, step);

  assert.equal(verifyRecoveryCredentials({ username: "SYSTEM-OWNER", secret: testEnvironment.ADMIN_RECOVERY_SECRET, code }, testEnvironment, timestamp), step);
  assert.equal(verifyRecoveryCredentials({ username: "another-owner", secret: testEnvironment.ADMIN_RECOVERY_SECRET, code }, testEnvironment, timestamp), null);
  assert.equal(verifyRecoveryCredentials({ username: "system-owner", secret: "wrong", code }, testEnvironment, timestamp), null);
  assert.equal(verifyRecoveryCredentials({ username: "system-owner", secret: testEnvironment.ADMIN_RECOVERY_SECRET, code: "000000" }, testEnvironment, timestamp), null);
});

test("only complete active bcrypt-backed administrator records are valid", () => {
  const validAccount = {
    is_active: true,
    email: "owner@example.com",
    username: "owner",
    first_name: "System",
    last_name: "Owner",
    password: "$2b$10$" + "A".repeat(53),
  };

  assert.equal(isValidAdminRecord(validAccount), true);
  assert.equal(isValidAdminRecord({ ...validAccount, password: "corrupt" }), false);
  assert.equal(isValidAdminRecord({ ...validAccount, is_active: false }), false);
});

test("failed recovery attempts use bounded delays instead of a long lockout", () => {
  assert.equal(getRecoveryRetryDelaySeconds(1), 1);
  assert.equal(getRecoveryRetryDelaySeconds(2), 2);
  assert.equal(getRecoveryRetryDelaySeconds(4), 8);
  assert.equal(getRecoveryRetryDelaySeconds(10), 30);
});