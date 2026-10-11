import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual } from "node:crypto";
import process from "node:process";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

const decodeBase32 = (value) => {
  const normalized = String(value || "").toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");
  if (!normalized || [...normalized].some((character) => !BASE32_ALPHABET.includes(character))) return null;

  let bits = "";
  for (const character of normalized) {
    bits += BASE32_ALPHABET.indexOf(character).toString(2).padStart(5, "0");
  }

  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
};

const constantTimeStringEqual = (first, second) => {
  const firstBuffer = Buffer.from(String(first));
  const secondBuffer = Buffer.from(String(second));
  return firstBuffer.length === secondBuffer.length && firstBuffer.length > 0 && timingSafeEqual(firstBuffer, secondBuffer);
};

export const recoveryConfigurationIsValid = (environment = process.env) => {
  const totpSecret = decodeBase32(environment.ADMIN_RECOVERY_TOTP_SECRET);
  return Boolean(
    environment.ADMIN_RECOVERY_USERNAME?.trim() &&
    environment.ADMIN_RECOVERY_SECRET?.length >= 32 &&
    totpSecret?.length >= 20
  );
};

export const getTotpStep = (timestamp = Date.now()) => Math.floor(timestamp / 30_000);

export const getRecoveryRetryDelaySeconds = (failedAttempts) =>
  Math.min(30, 2 ** Math.min(Math.max(0, Math.floor(Number(failedAttempts) || 1) - 1), 5));

export const createTotpCode = (base32Secret, step) => {
  const key = decodeBase32(base32Secret);
  if (!key || !Number.isSafeInteger(step) || step < 0) return "";

  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, "0");
};

export const verifyRecoveryCredentials = ({ username, secret, code }, environment = process.env, timestamp = Date.now()) => {
  if (!recoveryConfigurationIsValid(environment)) return null;
  if (String(username || "").length > 100 || String(secret || "").length > 256 || String(code || "").length > 12) return null;

  const usernameMatches = constantTimeStringEqual(
    String(username || "").trim().toLowerCase(),
    environment.ADMIN_RECOVERY_USERNAME.trim().toLowerCase()
  );
  const secretMatches = constantTimeStringEqual(secret || "", environment.ADMIN_RECOVERY_SECRET);
  const normalizedCode = String(code || "").trim();
  if (!usernameMatches || !secretMatches || !/^\d{6}$/.test(normalizedCode)) return null;

  const currentStep = getTotpStep(timestamp);
  for (const step of [currentStep - 1, currentStep, currentStep + 1]) {
    if (step >= 0 && constantTimeStringEqual(createTotpCode(environment.ADMIN_RECOVERY_TOTP_SECRET, step), normalizedCode)) {
      return step;
    }
  }
  return null;
};

export const isValidAdminRecord = (account) => Boolean(
  account &&
  account.is_active !== false &&
  typeof account.email === "string" && account.email.trim() &&
  typeof account.username === "string" && account.username.trim() &&
  typeof account.first_name === "string" && account.first_name.trim() &&
  typeof account.last_name === "string" && account.last_name.trim() &&
  typeof account.password === "string" && BCRYPT_HASH_PATTERN.test(account.password)
);

export const hashRecoveryIp = (ip, pepper = process.env.JWT_SECRET || "") =>
  createHmac("sha256", pepper).update(String(ip || "unknown")).digest("hex");