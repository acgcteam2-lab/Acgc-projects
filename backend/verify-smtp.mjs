import dotenv from "dotenv";
import nodemailer from "nodemailer";
import path from "node:path";
import process from "node:process";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
const smtpConfig = {
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: Number(process.env.SMTP_PORT) === 465,
  requireTLS: Number(process.env.SMTP_PORT) === 587,
  auth: {
    user: process.env.SMTP_USER,
    pass: (process.env.SMTP_PASS || "").replace(/\s+/g, ""),
  },
  tls: { rejectUnauthorized: false },
};
const transporter = nodemailer.createTransport(smtpConfig);
transporter.verify((err, success) => {
  if (err) {
    console.error("SMTP verification failed:", err.code || "UNKNOWN", err.message);
    process.exit(1);
  }
  console.log("SMTP verify success", success);
  process.exit(0);
});
