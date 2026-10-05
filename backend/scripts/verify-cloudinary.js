import cloudinaryPackage from "cloudinary";
import dotenv from "dotenv";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { getCloudinaryConfig } from "../config/cloudinary.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env"), quiet: true });

const cloudinary = cloudinaryPackage.v2;

const redact = (message, config) =>
  String(message || "")
    .replaceAll(config.api_key || "\0", "[redacted]")
    .replaceAll(config.api_secret || "\0", "[redacted]");

try {
  const config = getCloudinaryConfig();
  cloudinary.config(config);

  const result = await cloudinary.api.ping();
  console.log("Cloudinary credentials are active.");
  console.log(`Cloud name: ${config.cloud_name}`);
  console.log(`Status: ${result?.status || "ok"}`);
} catch (error) {
  const config = {
    api_key: process.env.CLOUDINARY_API_KEY?.trim(),
    api_secret: process.env.CLOUDINARY_API_SECRET?.trim(),
  };
  const upstream = error.error || error;
  const status = upstream.http_code || error.http_code || error.status;
  const message = redact(upstream.message || error.message || error, config);

  console.error("Cloudinary credential check failed.");
  if (status) console.error(`Status: ${status}`);
  console.error(`Reason: ${message}`);
  console.error(
    "Use one active Cloudinary account's API Environment variable, or update all three split variables from the same account, then redeploy the backend."
  );
  process.exit(1);
}
