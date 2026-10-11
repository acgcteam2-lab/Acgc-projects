import { randomBytes } from "node:crypto";
import process from "node:process";

const username = process.argv[2]?.trim();
if (!username) {
  console.error("Usage: node scripts/generate-admin-recovery-secrets.js <owner-username>");
  process.exit(1);
}

const base32Encode = (buffer) => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const byte of buffer) bits += byte.toString(2).padStart(8, "0");
  let encoded = "";
  for (let offset = 0; offset < bits.length; offset += 5) {
    encoded += alphabet[Number.parseInt(bits.slice(offset, offset + 5).padEnd(5, "0"), 2)];
  }
  return encoded;
};

console.log(`ADMIN_RECOVERY_USERNAME=${username}`);
console.log(`ADMIN_RECOVERY_SECRET=${randomBytes(32).toString("base64url")}`);
console.log(`ADMIN_RECOVERY_TOTP_SECRET=${base32Encode(randomBytes(32))}`);