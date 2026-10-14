import dotenv from "dotenv";
import nodemailer from "nodemailer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, ".env") });
const brevoLogin = process.env.BREVO_SMTP_LOGIN || process.env.BREVO_SMTP_USER;
const brevoKey = process.env.BREVO_SMTP_KEY || process.env.BREVO_SMTP_PASSWORD;
const configs = [];

if (brevoLogin && brevoKey) {
  const port = Number(process.env.BREVO_SMTP_PORT || 587);
  configs.push({
    name: "Brevo SMTP",
    host: process.env.BREVO_SMTP_HOST || "smtp-relay.brevo.com",
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user: brevoLogin.trim(), pass: brevoKey.replace(/\s+/g, "") },
  });
}

const smtpPassword = process.env.SMTP_PASS || process.env.SMTP_PASSWORD;
if (process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && smtpPassword) {
  const port = Number(process.env.SMTP_PORT);
  configs.push({
    name: "Generic SMTP fallback",
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465 || String(process.env.SMTP_SECURE || "").toLowerCase() === "true",
    requireTLS: port === 587,
    auth: { user: process.env.SMTP_USER, pass: smtpPassword.replace(/\s+/g, "") },
  });
}

if (configs.length === 0) {
  console.error("SMTP verification failed: configure Brevo SMTP or generic SMTP environment variables.");
  process.exit(1);
}

let verified = false;
for (const { name, ...smtpConfig } of configs) {
  const transporter = nodemailer.createTransport({
    ...smtpConfig,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    tls: { rejectUnauthorized: false },
  });
  try {
    await transporter.verify();
    console.log(`${name} verification succeeded.`);
    verified = true;
    break;
  } catch (error) {
    console.error(`${name} verification failed:`, error.code || "UNKNOWN", error.message);
  } finally {
    transporter.close();
  }
}

if (!verified) process.exit(1);
