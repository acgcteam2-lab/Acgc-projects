import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { isPasswordPolicySatisfied, PASSWORD_POLICY_MESSAGE } from "./passwordPolicy.js";

const scrypt = promisify(scryptCallback);
const SALT_LENGTH = 16;
const KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export const validateBackupRecoveryPassword = (password) => {
  if (typeof password === "string" && password.trim().toLowerCase() === "acgc-2026") {
    throw Object.assign(new Error("The default recovery password is not allowed. Choose a new password."), { status: 400 });
  }
  if (!isPasswordPolicySatisfied(password)) {
    throw Object.assign(new Error(PASSWORD_POLICY_MESSAGE), { status: 400 });
  }
};

export const hashBackupRecoveryPassword = async (password) => {
  validateBackupRecoveryPassword(password);
  const salt = randomBytes(SALT_LENGTH);
  const hash = await scrypt(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return { salt: salt.toString("hex"), hash: hash.toString("hex") };
};

export const verifyBackupRecoveryPassword = async (password, saltHex, hashHex) => {
  if (typeof password !== "string" || !/^[\da-f]{32}$/i.test(saltHex || "") || !/^[\da-f]{128}$/i.test(hashHex || "")) {
    return false;
  }

  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), KEY_LENGTH, SCRYPT_OPTIONS);
  return timingSafeEqual(actual, expected);
};