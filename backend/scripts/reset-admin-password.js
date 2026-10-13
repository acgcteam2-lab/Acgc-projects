/**
 * Reset admin password script
 * Usage: node scripts/reset-admin-password.js --email admin@example.com --password StrongPass8!
 */
import dotenv from "dotenv";
import { connectMongo } from "../config/db.js";
import Admin from "../models/Admin.js";
import User from "../models/User.js";
import bcrypt from "bcryptjs";
import { isPasswordPolicySatisfied } from "../services/passwordPolicy.js";

const envPath = new URL("../.env", import.meta.url).pathname;
dotenv.config({ path: envPath });

const getArg = (name) => {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) return null;
  return process.argv[index + 1];
};

const email = getArg("--email") || getArg("-e");
const newPassword = getArg("--password") || getArg("-p");
const mongoArg = getArg("--mongo") || getArg("-m");

if (!email || !newPassword) {
  console.error(
    "Usage: node scripts/reset-admin-password.js --email admin@example.com --password StrongPass8! [--mongo <MONGO_URI>]"
  );
  process.exit(1);
}

if (!isPasswordPolicySatisfied(newPassword)) {
  console.error("Use 8-128 characters with uppercase, lowercase, a number, and a symbol.");
  process.exit(1);
}

// Allow passing Mongo URI directly via CLI
if (mongoArg) {
  process.env.MONGO_URI = mongoArg;
}

const run = async () => {
  try {
    await connectMongo();
    console.log("Connected to MongoDB");

    const normalizedEmail = email.toLowerCase().trim();

    // Try to find in Admin collection first
    let admin = await Admin.findOne({ email: normalizedEmail });
    let isLegacy = false;

    if (!admin) {
      // Try legacy admin in User collection
      admin = await User.findOne({ email: normalizedEmail, role: "admin" });
      isLegacy = true;
    }

    if (!admin) {
      console.error(`No admin found with email: ${normalizedEmail}`);
      process.exit(1);
    }

    // Set raw password - the model's pre("save") hook will hash it
    admin.password = newPassword;
    await admin.save();

    console.log(
      `✓ Successfully reset password for ${normalizedEmail}${isLegacy ? " (legacy admin in users collection)" : ""}`
    );
    console.log("You can now login with the new password");
    process.exit(0);
  } catch (error) {
    console.error("Failed to reset password:", error.message || error);
    process.exit(1);
  }
};

run();
