import express from "express";
import jwt from "jsonwebtoken";
import { Buffer } from "node:buffer";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import mongoose from "mongoose";
import process from "node:process";
import { promises as fs } from "node:fs";
import multer from "multer";
import User from "../models/User.js";
import Admin from "../models/Admin.js";
import AdminRecoveryAttempt from "../models/AdminRecoveryAttempt.js";
import AdminRecoveryAudit from "../models/AdminRecoveryAudit.js";
import AdminRecoveryState from "../models/AdminRecoveryState.js";
import SystemSetting from "../models/SystemSetting.js";
import { authMiddleware, roleMiddleware, staffModulePermission } from "../middleware/auth.js";
import { sendMail } from "../config/mailer.js";
import {
  getRecoveryRetryDelaySeconds,
  hashRecoveryIp,
  isValidAdminRecord,
  recoveryConfigurationIsValid,
  verifyRecoveryCredentials,
} from "../services/adminRecoverySecurity.js";
import {
  createSystemBackup,
  deleteSystemBackup,
  getSystemBackupDownload,
  hydrateBackupHistorySizes,
  importSystemBackup,
  importSystemBackupFromCloudinary,
  runScheduledBackup,
  restoreSystemBackup,
} from "../services/backupService.js";

const backupImportUpload = multer({
  ...(process.env.VERCEL === "1" ? { storage: multer.memoryStorage() } : { dest: "backups/incoming" }),
  limits: { fileSize: 512 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const filename = file.originalname.toLowerCase();
    if (!filename.endsWith(".zip") && !filename.endsWith(".json.gz") && !filename.endsWith(".json.gz.enc")) {
      const error = new Error("Upload an encrypted .zip backup, or a legacy .json.gz backup file.");
      error.status = 400;
      callback(error);
      return;
    }
    callback(null, true);
  },
});

const STAFF_MODULE_KEYS = ["dashboard", "product_management", "site_inspection", "progress_monitoring", "transactions", "settings", "profile"];
const STAFF_MODULE_ACTIONS = {
  dashboard: ["view"],
  product_management: ["view", "add", "edit", "delete"],
  site_inspection: ["view", "view_details", "edit", "cancel", "generate_contract", "send_email", "download_contract", "manual_approve"],
  progress_monitoring: ["view", "view_details", "edit", "delete_proof"],
  transactions: ["view", "view_details", "edit", "view_contract", "download_contract", "send_email"],
  settings: ["view", "manage_access", "back_up"],
  profile: ["view", "edit"],
};
const STAFF_DEFAULT_ENABLED_ACTIONS = {
  dashboard: ["view"],
  product_management: ["view"],
  site_inspection: [],
  progress_monitoring: ["view", "view_details"],
  transactions: ["view", "view_details"],
  settings: ["view", "manage_access", "back_up"],
  profile: ["view"],
};

const createDefaultStaffAccess = () => ({
  profile_version: 2,
  subrole: "Helper",
  custom_subroles: [],
  modules: Object.fromEntries(STAFF_MODULE_KEYS.map((moduleKey) => [moduleKey, {
    enabled: moduleKey !== "site_inspection",
    actions: Object.fromEntries(STAFF_MODULE_ACTIONS[moduleKey].map((actionKey) => [
      actionKey,
      STAFF_DEFAULT_ENABLED_ACTIONS[moduleKey].includes(actionKey),
    ])),
  }])),
});

const sanitizeStaffAccess = (staffAccess) => {
  if (!staffAccess || typeof staffAccess !== "object" || Array.isArray(staffAccess)) return null;

  const modules = Object.fromEntries(STAFF_MODULE_KEYS.map((moduleKey) => {
    const moduleAccess = staffAccess.modules?.[moduleKey] || {};
    return [moduleKey, {
      enabled: moduleAccess.enabled === true,
      actions: Object.fromEntries(STAFF_MODULE_ACTIONS[moduleKey].map((actionKey) => [actionKey, moduleAccess.actions?.[actionKey] === true])),
    }];
  }));

  return {
    profile_version: Number(staffAccess.profile_version) || 1,
    subrole: typeof staffAccess.subrole === "string" ? staffAccess.subrole.trim().slice(0, 40) : "Helper",
    custom_subroles: Array.isArray(staffAccess.custom_subroles)
      ? [...new Set(staffAccess.custom_subroles.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean))].slice(0, 20)
      : [],
    modules,
  };
};

const migrateStaffAccess = (staffAccess) => {
  const migrated = sanitizeStaffAccess(staffAccess || createDefaultStaffAccess()) || createDefaultStaffAccess();
  if (migrated.profile_version < 2) {
    migrated.modules.settings.enabled = true;
    migrated.modules.settings.actions.view = true;
    migrated.modules.settings.actions.manage_access = true;
    migrated.modules.settings.actions.back_up = true;
    migrated.profile_version = 2;
  }
  return migrated;
};

const normalizeAddress = (value) => {
  if (!value) return "";
  const cleaned = value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[,;]+/g, ",")
    .replace(/\s*[.,]\s*/g, ", ")
    .replace(/\s*,\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const canonical = (text) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\b(city|province|zip|code|street|st|road|rd)\b/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const parts = cleaned
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const normalizedParts = [];
  const seen = [];

  for (const part of parts) {
    const key = canonical(part);
    if (!key) {
      normalizedParts.push(part);
      continue;
    }
    const isDuplicate = seen.some(
      (existing) => existing === key || existing.includes(key) || key.includes(existing)
    );
    if (!isDuplicate) {
      seen.push(key);
      normalizedParts.push(part);
    }
  }

  return normalizedParts.join(", ");
};

const buildAddressFromRequest = (reqBody) => {
  if (!reqBody) return "";
  const address = reqBody.address || reqBody.street_address || "";
  const parts = [address];

  if (reqBody.city) parts.push(reqBody.city);
  if (reqBody.province) parts.push(reqBody.province);
  if (reqBody.zip_code) parts.push(reqBody.zip_code);

  return normalizeAddress(parts.filter(Boolean).join(", "));
};

const router = express.Router();
const ADMIN_RECOVERY_STATE_KEY = "primary-administrator";
const RECOVERY_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const RECOVERY_SESSION_MS = 5 * 60 * 1000;
const hashVerificationToken = (token) => createHash("sha256").update(token).digest("hex");
const verificationHashesMatch = (firstHash, secondHash) => {
  const first = Buffer.from(String(firstHash || ""), "hex");
  const second = Buffer.from(String(secondHash || ""), "hex");
  return first.length === second.length && first.length > 0 && timingSafeEqual(first, second);
};

const findValidAdministrator = async () => {
  const [admins, legacyAdmins] = await Promise.all([
    Admin.find({}).select("+password").lean(),
    User.find({ role: "admin" }).select("+password").lean(),
  ]);
  return [...admins, ...legacyAdmins].find(isValidAdminRecord) || null;
};

const recordRecoveryFailure = async (key) => {
  while (true) {
    const now = new Date();
    const cutoff = new Date(now.getTime() - RECOVERY_ATTEMPT_WINDOW_MS);
    const current = await AdminRecoveryAttempt.findOne({ key }).lean();
    if (!current) {
      const nextAllowedAt = new Date(now.getTime() + getRecoveryRetryDelaySeconds(1) * 1000);
      try {
        await AdminRecoveryAttempt.create({
          key,
          window_started_at: now,
          failed_attempts: 1,
          next_allowed_at: nextAllowedAt,
          expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        });
        return { retryAfterSeconds: 0 };
      } catch (error) {
        if (error.code === 11000) continue;
        throw error;
      }
    }

    const isExpiredWindow = new Date(current.window_started_at) <= cutoff;
    const failedAttempts = isExpiredWindow ? 1 : (Number(current.failed_attempts) || 0) + 1;
    const retryAfterSeconds = getRecoveryRetryDelaySeconds(failedAttempts);
    const nextAllowedAt = new Date(now.getTime() + retryAfterSeconds * 1000);
    const filter = { key, window_started_at: current.window_started_at };
    const update = isExpiredWindow
      ? { $set: { window_started_at: now, failed_attempts: 1, next_allowed_at: nextAllowedAt, expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000) } }
      : { $set: { failed_attempts: failedAttempts, next_allowed_at: nextAllowedAt, expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000) } };
    filter.failed_attempts = Number(current.failed_attempts) || 0;

    const updated = await AdminRecoveryAttempt.findOneAndUpdate(filter, update, { new: true }).lean();
    if (!updated) continue;
    return { retryAfterSeconds: 0 };
  }
};

const recoveryUnavailable = (res) => res.status(403).json({
  success: false,
  message: "Recovery is unavailable or the provided recovery details are invalid.",
});

const validateRecoveryProfile = (body = {}) => {
  const { email, username, password, first_name, last_name } = body;
  return Boolean(
    typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && email.length <= 254 &&
    typeof username === "string" && /^[a-zA-Z0-9._-]{3,50}$/.test(username.trim()) &&
    typeof first_name === "string" && first_name.trim() && first_name.trim().length <= 80 &&
    typeof last_name === "string" && last_name.trim() && last_name.trim().length <= 80 &&
    typeof password === "string" && password.length >= 12 && password.length <= 128 &&
    /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password)
  );
};

const normalizeRecoveryProfile = (body) => ({
  email: body.email.trim().toLowerCase(),
  username: body.username.trim().toLowerCase(),
  password: body.password,
  first_name: body.first_name.trim(),
  last_name: body.last_name.trim(),
  phone: typeof body.phone === "string" ? body.phone.trim().slice(0, 40) : "",
  street_address: typeof body.street_address === "string" ? body.street_address.trim().slice(0, 200) : "",
  city: typeof body.city === "string" ? body.city.trim().slice(0, 100) : "",
  province: typeof body.province === "string" ? body.province.trim().slice(0, 100) : "",
  zip_code: typeof body.zip_code === "string" ? body.zip_code.trim().slice(0, 20) : "",
});

router.post("/admin-recovery/verify", async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    if (mongoose.connection.readyState !== 1 || !recoveryConfigurationIsValid()) {
      return recoveryUnavailable(res);
    }
    if (await findValidAdministrator()) return recoveryUnavailable(res);

    const attemptKey = hashRecoveryIp(req.ip);
    const attempt = await AdminRecoveryAttempt.findOne({ key: attemptKey }).lean();
    const retryAfterSeconds = Math.ceil((new Date(attempt?.next_allowed_at || 0).getTime() - Date.now()) / 1000);
    if (retryAfterSeconds > 0) {
      res.set("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({ success: false, message: `Please wait ${retryAfterSeconds} seconds before trying again.` });
    }

    const timestamp = Date.now();
    const totpStep = verifyRecoveryCredentials(req.body || {}, process.env, timestamp);
    if (totpStep === null) {
      await recordRecoveryFailure(attemptKey);
      return res.status(401).json({
        success: false,
        message: "Recovery is unavailable or the provided recovery details are invalid.",
      });
    }

    const state = await AdminRecoveryState.findOneAndUpdate(
      { key: ADMIN_RECOVERY_STATE_KEY },
      { $setOnInsert: { last_totp_step: -1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    const recoverySession = randomBytes(32).toString("base64url");
    const claimedState = await AdminRecoveryState.findOneAndUpdate(
      {
        _id: state._id,
        completed_at: null,
        last_totp_step: { $lt: totpStep },
      },
      {
        $set: {
          last_totp_step: totpStep,
          recovery_session_hash: hashVerificationToken(recoverySession),
          recovery_session_expires_at: new Date(timestamp + RECOVERY_SESSION_MS),
        },
      },
      { new: true }
    ).lean();
    if (!claimedState) return recoveryUnavailable(res);

    await AdminRecoveryAttempt.deleteOne({ key: attemptKey });
    return res.json({ success: true, recoverySession, expiresIn: RECOVERY_SESSION_MS / 1000 });
  } catch (error) {
    console.error("[admin-recovery] Verification failed:", error.name || "Error");
    return res.status(mongoose.connection.readyState === 1 ? 500 : 503).json({
      success: false,
      message: "Unable to complete recovery right now. Please try again later.",
    });
  }
});

router.post("/admin-recovery/restore", async (req, res) => {
  let lockId = null;
  let stateId = null;
  let recoveryAuditId = null;
  let restoredAccount = false;
  res.set("Cache-Control", "no-store");
  try {
    if (mongoose.connection.readyState !== 1 || !recoveryConfigurationIsValid()) {
      return recoveryUnavailable(res);
    }
    const { recoverySession } = req.body || {};
    if (typeof recoverySession !== "string" || recoverySession.length < 40 || recoverySession.length > 64 || !validateRecoveryProfile(req.body)) {
      return res.status(400).json({ success: false, message: "Enter valid administrator details and a strong password." });
    }
    const recoverySessionHash = hashVerificationToken(recoverySession);
    const state = await AdminRecoveryState.findOne({
      key: ADMIN_RECOVERY_STATE_KEY,
      recovery_session_hash: recoverySessionHash,
      recovery_session_expires_at: { $gt: new Date() },
      completed_at: null,
    }).lean();
    if (!state) return recoveryUnavailable(res);

    lockId = randomBytes(16).toString("hex");
    const lockedState = await AdminRecoveryState.findOneAndUpdate(
      {
        _id: state._id,
        recovery_session_hash: recoverySessionHash,
        recovery_session_expires_at: { $gt: new Date() },
        completed_at: null,
        $or: [
          { lock_expires_at: null },
          { lock_expires_at: { $lte: new Date() } },
        ],
      },
      { $set: { lock_id: lockId, lock_expires_at: new Date(Date.now() + 60_000) } },
      { new: true }
    ).lean();
    if (!lockedState) return recoveryUnavailable(res);
    stateId = lockedState._id;

    if (await findValidAdministrator()) return recoveryUnavailable(res);

    const profile = normalizeRecoveryProfile(req.body);
    const identityQuery = { $or: [{ email: profile.email }, { username: profile.username }] };
    const [adminMatches, userMatches] = await Promise.all([
      Admin.find(identityQuery).select("+password"),
      User.find(identityQuery).select("+password"),
    ]);
    const corruptAdmin = adminMatches.find((account) => !isValidAdminRecord(account));
    const corruptLegacyAdmin = userMatches.find((account) => account.role === "admin" && !isValidAdminRecord(account));
    const restoreTarget = corruptAdmin || corruptLegacyAdmin || null;
    const conflictingAccount = [...adminMatches, ...userMatches].find((account) =>
      account._id.toString() !== restoreTarget?._id.toString()
    );
    if (conflictingAccount) {
      return res.status(409).json({ success: false, message: "Those account details cannot be used. Contact system support." });
    }

    const audit = await AdminRecoveryAudit.create({
      action: "administrator_restored",
      account_id: restoreTarget?._id || new mongoose.Types.ObjectId(),
      account_username: profile.username,
      account_email: profile.email,
      source_ip_hash: hashRecoveryIp(req.ip),
      user_agent: String(req.get("user-agent") || "").slice(0, 300),
    });
    recoveryAuditId = audit._id;

    const account = restoreTarget || new Admin();
    if (restoreTarget) account.session_version = (Number(account.session_version) || 0) + 1;
    Object.assign(account, profile);
    account.is_active = true;
    if (account instanceof User) account.role = "admin";
    if (account instanceof User) {
      account.email_verified = true;
      account.email_verification_token = null;
      account.email_verification_expires = null;
    }
    await account.save();
    restoredAccount = true;

    audit.account_id = account._id;
    audit.outcome = "success";
    await audit.save();
    await AdminRecoveryState.updateOne(
      { _id: stateId, lock_id: lockId, recovery_session_hash: recoverySessionHash },
      {
        $set: { completed_at: new Date() },
        $unset: {
          recovery_session_hash: 1,
          recovery_session_expires_at: 1,
          lock_id: 1,
          lock_expires_at: 1,
        },
      }
    );

    return res.status(201).json({
      success: true,
      message: "Administrator access has been restored. Sign in with the new administrator account.",
    });
  } catch (error) {
    console.error("[admin-recovery] Restore failed:", error.name || "Error");
    if (recoveryAuditId) {
      await AdminRecoveryAudit.updateOne(
        { _id: recoveryAuditId },
        { $set: { outcome: restoredAccount ? "success" : "failed" } }
      ).catch(() => {});
    }
    return res.status(mongoose.connection.readyState === 1 ? 500 : 503).json({
      success: false,
      message: "Unable to complete recovery right now. Please try again later.",
    });
  } finally {
    if (stateId && lockId) {
      await AdminRecoveryState.updateOne(
        { _id: stateId, lock_id: lockId, completed_at: null },
        { $unset: { lock_id: 1, lock_expires_at: 1 } }
      ).catch(() => {});
    }
  }
});

const sendVerificationEmail = async (user, token) => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const verificationUrl = `${frontendUrl}/verify-email?token=${encodeURIComponent(token)}`;

  await sendMail({
    from: process.env.EMAIL_FROM || "ACGC <no-reply@acgc.local>",
    to: user.email,
    subject: "Verify your ACGC email address",
    text: `Hello ${user.first_name}, verify your ACGC account here: ${verificationUrl}`,
    html: `
      <p>Hello ${user.first_name},</p>
      <p>Verify your ACGC account by clicking the link below:</p>
      <p><a href="${verificationUrl}">Verify my email address</a></p>
      <p>This link expires in 24 hours.</p>
    `,
  });
};

const sendPendingEmailVerificationCode = async (user, pendingEmail, code) => {
  await sendMail({
    from: process.env.EMAIL_FROM || "ACGC <no-reply@acgc.local>",
    to: pendingEmail,
    subject: "Your ACGC email verification code",
    text: `Hello ${user.first_name}, your ACGC email verification code is ${code}. It expires in 10 minutes.`,
    html: `<p>Hello ${user.first_name},</p><p>Your ACGC email verification code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:8px">${code}</p><p>This code expires in 10 minutes. Your current email remains active until verification.</p>`,
  });
};

const createEmailChangeCode = async (user, pendingEmail) => {
  const code = String(randomInt(100000, 1000000));
  user.pending_email_verification_code = hashVerificationToken(`${user._id}:${pendingEmail}:${code}`);
  user.pending_email_verification_expires = new Date(Date.now() + 10 * 60 * 1000);
  user.pending_email_verification_attempts = 0;
  user.pending_email_verification_sent_at = new Date();
  await user.save();
  await sendPendingEmailVerificationCode(user, pendingEmail, code);
};

const sendPasswordResetCode = async (account, code) => {
  await sendMail({
    from: process.env.EMAIL_FROM || "ACGC <no-reply@acgc.local>",
    to: account.email,
    subject: "Your ACGC password reset code",
    text: `Your ACGC password reset code is ${code}. It expires in 15 minutes.`,
    html: `
      <p>Hello ${account.first_name},</p>
      <p>Your ACGC password reset code is:</p>
      <p style="font-size: 28px; font-weight: 700; letter-spacing: 8px;">${code}</p>
      <p>This code expires in 15 minutes. If you did not request this, you can ignore this email.</p>
    `,
  });
};

router.get("/system-settings", authMiddleware, async (req, res) => {
  try {
    const settings = await SystemSetting.findOne({ key: "global" }).lean();
    const backupHistory = await hydrateBackupHistorySizes(settings?.backup_history);
    res.json({
      success: true,
      maintenance_mode: settings?.maintenance_mode === true,
      global_permissions: settings?.global_permissions || null,
      backup_schedule: settings?.backup_schedule || "weekly",
      backup_status: settings?.backup_status || "Success",
      last_backup_at: settings?.last_backup_at || null,
      backup_history: backupHistory,
    });
  } catch (error) {
    console.error("Get system settings error:", error);
    res.status(500).json({ success: false, message: "Unable to load system settings." });
  }
});

router.patch("/system-settings", authMiddleware, roleMiddleware(["admin", "super_admin"]), async (req, res) => {
  try {
    const update = {};
    if (typeof req.body?.maintenance_mode === "boolean") {
      update.maintenance_mode = req.body.maintenance_mode;
    }
    if (req.body?.global_permissions && typeof req.body.global_permissions === "object") {
      const permissions = { ...req.body.global_permissions };
      if (permissions.view_only_access === true) {
        permissions.can_request_orders = false;
        permissions.can_estimate_pricing = false;
        permissions.can_track_products = false;
        permissions.can_upload_feedback = false;
        permissions.show_ratings_homepage = false;
      }
      update.global_permissions = permissions;
    }
    if (typeof req.body?.backup_schedule === "string") {
      update.backup_schedule = req.body.backup_schedule;
    }
    if (typeof req.body?.backup_status === "string") {
      update.backup_status = req.body.backup_status;
    }
    if (req.body?.last_backup_at) {
      update.last_backup_at = new Date(req.body.last_backup_at);
    }
    if (Array.isArray(req.body?.backup_history)) {
      update.backup_history = req.body.backup_history;
    }

    const settings = await SystemSetting.findOneAndUpdate(
      { key: "global" },
      { $set: update },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
    const backupHistory = await hydrateBackupHistorySizes(settings.backup_history);
    res.json({
      success: true,
      maintenance_mode: settings.maintenance_mode === true,
      global_permissions: settings.global_permissions || null,
      backup_schedule: settings.backup_schedule || "weekly",
      backup_status: settings.backup_status || "Success",
      last_backup_at: settings.last_backup_at || null,
      backup_history: backupHistory,
    });
  } catch (error) {
    console.error("Update system settings error:", error);
    res.status(500).json({ success: false, message: "Unable to update system settings." });
  }
});

router.post("/system-settings/backups", authMiddleware, roleMiddleware(["admin", "super_admin"]), async (req, res) => {
  try {
    const result = await createSystemBackup(req.body?.type);
    res.status(201).json({ success: true, ...result });
  } catch (error) {
    console.error("Create system backup error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to create backup." });
  }
});

router.get("/system-settings/cron-backup", async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const expectedAuthorization = secret ? Buffer.from(`Bearer ${secret}`) : Buffer.alloc(0);
  const providedAuthorization = Buffer.from(req.get("authorization") || "");
  if (!secret || expectedAuthorization.length !== providedAuthorization.length || !timingSafeEqual(expectedAuthorization, providedAuthorization)) {
    return res.status(secret ? 401 : 503).json({ success: false, message: "Scheduled backup authorization is not configured." });
  }

  try {
    await runScheduledBackup();
    return res.json({ success: true, message: "Scheduled backup check completed." });
  } catch (error) {
    console.error("Vercel scheduled backup failed:", error);
    return res.status(500).json({ success: false, message: "Scheduled backup failed." });
  }
});

router.post(
  "/system-settings/backups/import",
  authMiddleware,
  roleMiddleware(["admin", "super_admin"]),
  (req, res, next) => {
    backupImportUpload.single("backupFile")(req, res, (error) => {
      if (!error) return next();
      const status = error.code === "LIMIT_FILE_SIZE" ? 413 : error.status || 400;
      return res.status(status).json({ success: false, message: error.message || "Unable to upload backup." });
    });
  },
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "Select a backup file to upload." });
    }

    try {
      const result = await importSystemBackup(req.file.buffer || req.file.path);
      res.status(201).json({ success: true, ...result });
    } catch (error) {
      console.error("Import system backup error:", error);
      res.status(error.status || 400).json({ success: false, message: error.message || "Unable to import backup." });
    } finally {
      if (req.file.path) await fs.rm(req.file.path, { force: true });
    }
  }
);

router.post("/system-settings/backups/import-cloudinary", authMiddleware, roleMiddleware(["admin", "super_admin"]), async (req, res) => {
  try {
    const result = await importSystemBackupFromCloudinary(req.body?.public_id, req.body?.format);
    res.status(201).json({ success: true, ...result });
  } catch (error) {
    console.error("Import Cloudinary backup error:", error);
    res.status(error.status || 400).json({ success: false, message: error.message || "Unable to import backup." });
  }
});

router.get("/system-settings/backups/:backupId/download", authMiddleware, roleMiddleware(["admin", "super_admin"]), async (req, res) => {
  try {
    const { buffer, filename, redirectUrl } = await getSystemBackupDownload(req.params.backupId);
    if (redirectUrl) return res.redirect(302, redirectUrl);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(buffer);
  } catch (error) {
    console.error("Download system backup error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to download backup." });
  }
});

router.post("/system-settings/backups/:backupId/restore", authMiddleware, roleMiddleware(["admin", "super_admin"]), async (req, res) => {
  try {
    const result = await restoreSystemBackup(req.params.backupId);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("Restore system backup error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to restore backup." });
  }
});

router.delete("/system-settings/backups/:backupId", authMiddleware, roleMiddleware(["admin", "super_admin"]), async (req, res) => {
  try {
    const result = await deleteSystemBackup(req.params.backupId);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("Delete system backup error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to delete backup." });
  }
});

/**
 * POST /api/auth/register
 * Register a new user
 */
router.post("/register", async (req, res) => {
  try {
    const {
      email,
      username,
      password,
      first_name,
      last_name,
      phone,
      street_address,
      city,
      province,
      zip_code,
      role,
    } = req.body;

    if (!email || !username || !password || !first_name || !last_name) {
      return res.status(400).json({
        success: false,
        message: "Email, username, password, first_name, and last_name are required",
      });
    }

    const existingUser = await User.findOne({
      $or: [{ email: email.toLowerCase().trim() }, { username: username.toLowerCase().trim() }],
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "A user already exists with that email or username",
      });
    }

    const adminExists = await findValidAdministrator();
    if (!adminExists) {
      return res.status(403).json({
        success: false,
        message:
          "An admin account must be created first. Please create the admin account before registering customers.",
      });
    }

    const user = new User({
      email,
      username,
      password,
      first_name,
      last_name,
      phone: phone || "",
      street_address: street_address || "",
      city: city || "",
      province: province || "",
      zip_code: zip_code || "",
      role: "customer",
      email_verified: false,
      email_verification_token: hashVerificationToken(randomBytes(32).toString("hex")),
      email_verification_expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    await user.save();

    const verificationToken = randomBytes(32).toString("hex");
    user.email_verification_token = hashVerificationToken(verificationToken);
    await user.save();

    try {
      await sendVerificationEmail(user, verificationToken);
    } catch (mailError) {
      await User.deleteOne({ _id: user._id });
      throw new Error(`Unable to send verification email: ${mailError.message}`);
    }

    res.status(201).json({
      success: true,
      message: "Registration successful. Check your email to verify your account.",
      email: user.email,
    });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({
      success: false,
      message: "Error registering user",
      error: error.message,
    });
  }
});

/**
 * GET /api/auth/verify-email
 * Verify a customer email address with a one-time token.
 */
router.get("/verify-email", async (req, res) => {
  try {
    const token = String(req.query.token || "").trim();
    if (!token) {
      return res.status(400).json({ success: false, message: "Verification token is required." });
    }

    const user = await User.findOne({
      email_verification_token: hashVerificationToken(token),
      email_verification_expires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ success: false, message: "This verification link is invalid or expired." });
    }

    user.email_verified = true;
    user.email_verification_token = null;
    user.email_verification_expires = null;
    await user.save();

    return res.json({ success: true, message: "Email verified successfully. You can now log in." });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: "This email address is already registered to another account." });
    }
    console.error("Email verification error:", error);
    return res.status(500).json({ success: false, message: "Unable to verify email." });
  }
});

router.post("/profile/email-change", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "customer") {
      return res.status(403).json({ success: false, message: "Only customers can change their account email." });
    }

    const newEmail = String(req.body?.new_email || "").trim().toLowerCase();
    const currentPassword = String(req.body?.current_password || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      return res.status(400).json({ success: false, message: "Enter a valid email address." });
    }
    if (!currentPassword) {
      return res.status(400).json({ success: false, message: "Current password is required." });
    }

    const user = await User.findById(req.user.id);
    if (!user || user.role !== "customer") {
      return res.status(404).json({ success: false, message: "Customer account not found." });
    }
    if (!(await user.comparePassword(currentPassword))) {
      return res.status(401).json({ success: false, message: "Current password is incorrect." });
    }
    if (newEmail === user.email.toLowerCase()) {
      return res.status(400).json({ success: false, message: "The new email address matches your current email." });
    }

    const [existingUser, existingPendingEmail, existingAdmin] = await Promise.all([
      User.findOne({ email: newEmail, _id: { $ne: user._id } }).select("_id"),
      User.findOne({ pending_email: newEmail, _id: { $ne: user._id } }).select("_id"),
      Admin.findOne({ email: newEmail }).select("_id"),
    ]);
    if (existingUser || existingPendingEmail || existingAdmin) {
      return res.status(409).json({ success: false, message: "This email address is already registered or pending verification for another account." });
    }

    user.pending_email = newEmail;
    user.pending_email_verification_code = null;
    user.pending_email_verification_expires = null;
    user.pending_email_verification_attempts = 0;
    user.pending_email_verification_sent_at = null;

    try {
      await createEmailChangeCode(user, newEmail);
    } catch (mailError) {
      await User.updateOne(
        { _id: user._id, pending_email: newEmail },
        { $set: {
          pending_email: null,
          pending_email_verification_code: null,
          pending_email_verification_expires: null,
          pending_email_verification_attempts: 0,
          pending_email_verification_sent_at: null,
        } },
      );
      return res.status(502).json({ success: false, message: "Unable to send the verification code. Your current email is unchanged." });
    }

    return res.json({
      success: true,
      pending_email: newEmail,
      message: `A verification code was sent to ${newEmail}. Your current email remains active until verified.`,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: "This email address is already registered or pending verification for another account." });
    }
    console.error("Request email change error:", error);
    return res.status(500).json({ success: false, message: "Unable to request an email change." });
  }
});

router.post("/profile/email-change/resend", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "customer") {
      return res.status(403).json({ success: false, message: "Only customers can change their account email." });
    }

    const user = await User.findById(req.user.id);
    if (!user || user.role !== "customer") {
      return res.status(404).json({ success: false, message: "Customer account not found." });
    }
    if (!user.pending_email) {
      return res.status(400).json({ success: false, message: "There is no pending email change to verify." });
    }

    const cooldownEndsAt = user.pending_email_verification_sent_at
      ? user.pending_email_verification_sent_at.getTime() + 60 * 1000
      : 0;
    if (Date.now() < cooldownEndsAt) {
      return res.status(429).json({
        success: false,
        retry_after_seconds: Math.ceil((cooldownEndsAt - Date.now()) / 1000),
        message: "Please wait before requesting another verification code.",
      });
    }

    try {
      await createEmailChangeCode(user, user.pending_email);
    } catch (mailError) {
      console.error("Email change code resend failed:", mailError);
      await User.updateOne(
        { _id: user._id, pending_email: user.pending_email },
        { $set: {
          pending_email_verification_code: null,
          pending_email_verification_expires: null,
          pending_email_verification_sent_at: null,
        } },
      );
      return res.status(502).json({ success: false, message: "Unable to send a new verification code. Please try again later." });
    }

    return res.json({ success: true, message: "A new verification code was sent." });
  } catch (error) {
    console.error("Resend email change code error:", error);
    return res.status(500).json({ success: false, message: "Unable to resend the verification code." });
  }
});

router.post("/profile/email-change/verify", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "customer") {
      return res.status(403).json({ success: false, message: "Only customers can change their account email." });
    }

    const code = String(req.body?.code || "").trim();
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ success: false, message: "Enter the six-digit verification code." });
    }

    const user = await User.findById(req.user.id);
    if (!user || user.role !== "customer") {
      return res.status(404).json({ success: false, message: "Customer account not found." });
    }
    if (!user.pending_email) {
      return res.status(400).json({ success: false, message: "There is no pending email change to verify." });
    }
    if (!user.pending_email_verification_code || !user.pending_email_verification_expires) {
      return res.status(400).json({ success: false, message: "Your verification code has expired. Request a new code to continue." });
    }
    if (user.pending_email_verification_expires <= new Date()) {
      user.pending_email_verification_code = null;
      await user.save();
      return res.status(400).json({ success: false, message: "Your verification code has expired. Request a new code to continue." });
    }
    if (user.pending_email_verification_attempts >= 5) {
      user.pending_email_verification_code = null;
      user.pending_email_verification_expires = null;
      await user.save();
      return res.status(429).json({ success: false, message: "Too many incorrect codes. Request a new code to continue." });
    }

    const expectedCodeHash = hashVerificationToken(`${user._id}:${user.pending_email}:${code}`);
    if (!verificationHashesMatch(expectedCodeHash, user.pending_email_verification_code)) {
      user.pending_email_verification_attempts += 1;
      if (user.pending_email_verification_attempts >= 5) {
        user.pending_email_verification_code = null;
        user.pending_email_verification_expires = null;
      }
      await user.save();
      const attemptsRemaining = Math.max(0, 5 - user.pending_email_verification_attempts);
      return res.status(attemptsRemaining ? 400 : 429).json({
        success: false,
        attempts_remaining: attemptsRemaining,
        message: attemptsRemaining
          ? `Incorrect verification code. ${attemptsRemaining} attempt${attemptsRemaining === 1 ? "" : "s"} remaining.`
          : "Too many incorrect codes. Request a new code to continue.",
      });
    }

    const pendingEmail = user.pending_email.toLowerCase().trim();
    const [existingUser, existingAdmin] = await Promise.all([
      User.findOne({ email: pendingEmail, _id: { $ne: user._id } }).select("_id"),
      Admin.findOne({ email: pendingEmail }).select("_id"),
    ]);
    if (existingUser || existingAdmin) {
      return res.status(409).json({ success: false, message: "This email address is already registered to another account." });
    }

    user.email = pendingEmail;
    user.email_verified = true;
    user.pending_email = null;
    user.pending_email_verification_code = null;
    user.pending_email_verification_expires = null;
    user.pending_email_verification_attempts = 0;
    user.pending_email_verification_sent_at = null;
    await user.save();

    return res.json({ success: true, email: user.email, message: "Your email address has been updated and verified successfully." });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: "This email address is already registered to another account." });
    }
    console.error("Verify email change code error:", error);
    return res.status(500).json({ success: false, message: "Unable to verify the code." });
  }
});

router.post("/forgot-password", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required." });
    }

    const admin = await Admin.findOne({ email });
    const user = admin ? null : await User.findOne({ email });
    const account = admin || user;

    if (account) {
      const code = String(randomInt(100000, 1000000));
      account.password_reset_code = hashVerificationToken(code);
      account.password_reset_expires = new Date(Date.now() + 15 * 60 * 1000);
      await account.save();
      await sendPasswordResetCode(account, code);
    }

    return res.json({
      success: true,
      message: "If an account exists for that email, a verification code has been sent.",
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    return res.status(500).json({ success: false, message: "Unable to send the reset code." });
  }
});

router.post("/verify-reset-code", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const code = String(req.body?.code || "").trim();
    const admin = await Admin.findOne({
      email,
      password_reset_code: hashVerificationToken(code),
      password_reset_expires: { $gt: new Date() },
    });
    const user = admin ? null : await User.findOne({
      email,
      password_reset_code: hashVerificationToken(code),
      password_reset_expires: { $gt: new Date() },
    });
    const account = admin || user;

    if (!account) {
      return res.status(400).json({ success: false, message: "The code is invalid or expired." });
    }

    const resetToken = jwt.sign(
      { id: account._id, model: admin ? "admin" : "user", purpose: "password-reset" },
      process.env.JWT_SECRET || "your-secret-key",
      { expiresIn: "10m" },
    );
    return res.json({ success: true, resetToken });
  } catch (error) {
    console.error("Verify reset code error:", error);
    return res.status(500).json({ success: false, message: "Unable to verify the reset code." });
  }
});

router.post("/reset-password", async (req, res) => {
  try {
    const { resetToken, password } = req.body || {};
    if (!resetToken || !password || password.length < 8) {
      return res.status(400).json({ success: false, message: "A valid reset token and password of at least 8 characters are required." });
    }

    const payload = jwt.verify(resetToken, process.env.JWT_SECRET || "your-secret-key");
    if (payload.purpose !== "password-reset") {
      return res.status(400).json({ success: false, message: "Invalid password reset token." });
    }

    const Model = payload.model === "admin" ? Admin : User;
    const account = await Model.findById(payload.id);
    if (!account) {
      return res.status(400).json({ success: false, message: "Account not found." });
    }

    if (await account.comparePassword(password)) {
      return res.status(400).json({
        success: false,
        message: "You cannot reuse your previous password. Please choose a new password.",
      });
    }

    account.password = password;
    account.password_reset_code = null;
    account.password_reset_expires = null;
    await account.save();
    return res.json({ success: true, message: "Password reset successfully. You can now log in." });
  } catch (error) {
    console.error("Reset password error:", error);
    return res.status(400).json({ success: false, message: "The reset session is invalid or expired." });
  }
});

/**
 * GET /api/auth/admin-exists
 * Check whether an admin user exists in the system
 */
router.get("/admin-exists", async (req, res) => {
  try {
    res.json({ exists: Boolean(await findValidAdministrator()) });
  } catch (error) {
    console.error("Admin exists check error:", error.name || "Error");
    res.status(500).json({
      success: false,
      message: "Error checking admin status",
    });
  }
});

router.get("/admin-status", async (req, res) => {
  try {
    res.json({ exists: Boolean(await findValidAdministrator()) });
  } catch (error) {
    console.error("Admin status check error:", error.name || "Error");
    res.status(500).json({
      success: false,
      message: "Error checking admin status",
    });
  }
});

router.get("/customers", authMiddleware, roleMiddleware("admin"), async (req, res) => {
  try {
    const { search } = req.query;
    if (!search || !search.trim()) {
      return res.json({ success: true, customers: [] });
    }

    const queryText = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(queryText, "i");

    const customers = await User.find({
      role: "customer",
      $or: [
        { first_name: regex },
        { last_name: regex },
        { email: regex },
        { username: regex },
        { phone: regex },
      ],
    })
      .select("first_name last_name email phone street_address city province zip_code")
      .limit(10)
      .lean();

    res.json({ success: true, customers });
  } catch (error) {
    console.error("Customer search error:", error);
    res.status(500).json({ success: false, message: "Unable to search customers", error: error.message });
  }
});

router.get("/users", authMiddleware, staffModulePermission("settings", "view"), async (req, res) => {
  try {
    const { role, search } = req.query;
    const query = {};
    const requestedRole = role === "staff" ? "skilled_worker" : role;

    if (requestedRole && requestedRole !== "all") query.role = requestedRole;
    let searchRegex;
    if (search?.trim()) {
      const queryText = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      searchRegex = new RegExp(queryText, "i");
      query.$or = [{ first_name: searchRegex }, { last_name: searchRegex }, { email: searchRegex }, { username: searchRegex }];
    }

    const users = await User.find(query).select("-password").sort({ createdAt: -1 });
    const adminQuery = requestedRole && requestedRole !== "all" && requestedRole !== "admin"
      ? null
      : searchRegex
        ? { $or: [{ first_name: searchRegex }, { last_name: searchRegex }, { email: searchRegex }, { username: searchRegex }] }
        : {};
    const adminAccounts = adminQuery
      ? await Admin.find(adminQuery).select("-password -password_reset_code -password_reset_expires").lean()
      : [];
    const userIds = new Set(users.map((account) => String(account._id)));
    const allAccounts = [
      ...users,
      ...adminAccounts
        .filter((account) => !userIds.has(String(account._id)))
        .map((account) => ({ ...account, role: "admin", is_admin_account: true })),
    ].sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0));

    if (req.user.role === "admin") {
      await Promise.all(allAccounts
        .filter((account) => account.role === "skilled_worker" && Number(account.staff_access?.profile_version || 0) < 2)
        .map(async (account) => {
          account.staff_access = migrateStaffAccess(account.staff_access);
          account.markModified("staff_access");
          await account.save();
        }));
    }
    res.json({ success: true, users: allAccounts });
  } catch (error) {
    console.error("Get users error:", error);
    res.status(500).json({ success: false, message: "Unable to load users." });
  }
});

router.patch("/users/:id", authMiddleware, staffModulePermission("settings", "manage_access"), async (req, res) => {
  try {
    const staffPromotingCustomer = req.user.role === "skilled_worker" && req.body?.role === "skilled_worker";
    const staffConvertingToCustomer = req.user.role === "skilled_worker" && req.body?.role === "customer";
    if (req.user.role === "skilled_worker" && ((req.body?.role !== undefined && !staffPromotingCustomer && !staffConvertingToCustomer) || req.body?.staff_access !== undefined)) {
      return res.status(403).json({ success: false, message: "Staff can only promote customers or convert staff accounts to customers." });
    }
    if ((staffPromotingCustomer || staffConvertingToCustomer) && String(req.user.id) === String(req.params.id)) {
      return res.status(403).json({ success: false, message: "You cannot change your own account role." });
    }
    if (req.body?.role !== undefined && !["customer", "skilled_worker"].includes(req.body.role)) {
      return res.status(400).json({ success: false, message: "Only customer and staff role changes are allowed here." });
    }

    const allowedFields = [
      "can_request_orders",
      "can_estimate_pricing",
      "view_only_access",
      "can_track_products",
      "can_upload_feedback",
      "show_ratings_homepage",
    ];
    const permissionValues = Object.fromEntries(
      allowedFields
        .filter((field) => typeof req.body?.[field] === "boolean")
        .map((field) => [`access_permissions.${field}`, req.body[field]])
    );
    const permissions = { ...permissionValues };
    if (req.body?.view_only_access === true) {
      allowedFields
        .filter((field) => field !== "view_only_access")
        .forEach((field) => {
          permissions[`access_permissions.${field}`] = false;
        });
    }
    const update = {};
    if (Object.keys(permissions).length > 0) Object.assign(update, permissions);
    if (req.body?.role === "skilled_worker") {
      update.role = "skilled_worker";
      update.staff_access = migrateStaffAccess(
        staffPromotingCustomer
          ? { ...req.staffAccess, subrole: "Helper" }
          : req.body.staff_access || createDefaultStaffAccess()
      );
    }
    if (req.body?.role === "customer") update.role = "customer";
    if (update.role) update.$inc = { session_version: 1 };
    if (req.body?.staff_access && typeof req.body.staff_access === "object") {
      update.staff_access = sanitizeStaffAccess({ ...req.body.staff_access, profile_version: 2 });
    }

    const userFilter = req.user.role === "skilled_worker"
      ? { _id: req.params.id, role: staffConvertingToCustomer ? "skilled_worker" : "customer" }
      : update.role === "skilled_worker"
      ? { _id: req.params.id, role: "customer" }
      : update.role === "customer"
        ? { _id: req.params.id, role: "skilled_worker" }
        : update.staff_access
          ? { _id: req.params.id, role: "skilled_worker" }
          : { _id: req.params.id };
    const user = await User.findOneAndUpdate(userFilter, update, { new: true, runValidators: true }).select("-password");
    if (!user) return res.status(404).json({ success: false, message: "User not found." });
    res.json({ success: true, user });
  } catch (error) {
    console.error("Update user access error:", error);
    res.status(500).json({ success: false, message: "Unable to update user access." });
  }
});

router.post("/create-admin", (_req, res) => res.status(410).json({
  success: false,
  message: "Public administrator creation is disabled. Use the configured recovery procedure or trusted server-side provisioning.",
}));

/**
 * POST /api/auth/login
 * Login user
 */
router.post("/login", async (req, res) => {
  console.info("[auth] POST /api/auth/login");
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({
        success: false,
        message: "Email/username and password are required",
      });
    }

    const query = identifier.includes("@")
      ? { email: identifier.toLowerCase().trim() }
      : { username: identifier.toLowerCase().trim() };

    let user = await User.findOne({ ...query, role: "skilled_worker" });
    let source = "user";

    if (!user) {
      user = await Admin.findOne(query);
      source = "admin";
    }

    if (!user) {
      user = await User.findOne(query);
      source = "user";
    }

    if (!user) {
      console.warn(`[auth] User not found for identifier: ${identifier} (query: ${JSON.stringify(query)})`);
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    console.info(`[auth] Found user: ${user.email} (${user.username}), source: ${source}`);

    const isPasswordValid = await user.comparePassword(password);
    console.info(`[auth] Password comparison result: ${isPasswordValid}`);
    
    if (!isPasswordValid || user.is_active === false) {
      console.warn(`[auth] Invalid password for user: ${user.email}`);
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    if (source === "user" && user.role === "skilled_worker" && Number(user.staff_access?.profile_version || 0) < 2) {
      user.staff_access = migrateStaffAccess(user.staff_access);
      user.markModified("staff_access");
      await user.save();
    }

    if (source === "user" && user.email_verification_token && user.email_verified !== true) {
      return res.status(403).json({
        success: false,
        message: "Please verify your email address before logging in.",
      });
    }

    const role = source === "admin" ? "admin" : user.role;
    const token = jwt.sign(
      { id: user._id, email: user.email, role, auth_source: source, session_version: user.session_version || 0 },
      process.env.JWT_SECRET || "your-secret-key",
      { expiresIn: "7d" }
    );

    res.json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user._id,
        email: user.email,
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name,
        role,
        phone: user.phone,
        street_address: user.street_address,
        city: user.city,
        province: user.province,
        zip_code: user.zip_code,
        access_permissions: user.access_permissions,
        staff_access: user.staff_access,
        created_at: user.createdAt,
        updated_at: user.updatedAt,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      message: "Error logging in",
      error: error.message,
    });
  }
});

/**
 * GET /api/auth/me
 * Get current user session
 */
router.get("/me", authMiddleware, async (req, res) => {
  try {
    let user = null;
    let role = req.user.role;

    if (role === "admin") {
      user = await Admin.findById(req.user.id);
      if (!user) {
        user = await User.findOne({ _id: req.user.id, role: "admin" });
      }
    } else {
      user = await User.findById(req.user.id);
      if (!user) {
        user = await Admin.findById(req.user.id);
        role = user ? "admin" : role;
      }
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired session",
      });
    }

    res.json({
      isAuthenticated: true,
      user: {
        id: user._id,
        email: user.email,
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name,
        role,
        phone: user.phone,
        street_address: user.street_address,
        city: user.city,
        province: user.province,
        zip_code: user.zip_code,
        access_permissions: user.access_permissions,
        staff_access: user.staff_access,
        created_at: user.createdAt,
        updated_at: user.updatedAt,
      },
      role,
    });
  } catch (error) {
    console.error("Get user error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching user",
    });
  }
});

/**
 * POST /api/auth/logout
 * Logout user (client-side, just clear token)
 */
router.post("/logout", authMiddleware, (req, res) => {
  res.json({
    success: true,
    message: "Logged out successfully",
  });
});

/**
 * PUT /api/auth/profile
 * Update user profile
 */
router.put("/profile", authMiddleware, async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      phone,
      address,
      street_address,
      city,
      province,
      zip_code,
      current_password,
      new_password,
    } = req.body;

    let user = null;
    let role = req.user.role;

    if (role === "admin") {
      user = await Admin.findById(req.user.id);
      if (!user) {
        user = await User.findOne({ _id: req.user.id, role: "admin" });
      }
    } else {
      user = await User.findById(req.user.id);
      if (!user) {
        user = await Admin.findById(req.user.id);
        role = user ? "admin" : role;
      }
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired session",
      });
    }

    // Always validate current password since frontend requires it for any profile change
    if (current_password) {
      const isCurrentPasswordValid = await user.comparePassword(current_password);
      if (!isCurrentPasswordValid) {
        return res.status(401).json({
          success: false,
          message: "Current password is incorrect",
        });
      }
    }

    if (new_password) {
      if (new_password.length < 8) {
        return res.status(400).json({
          success: false,
          message: "New password must be at least 8 characters long",
        });
      }

      user.password = new_password;
    }

    if (first_name) user.first_name = first_name;
    if (last_name) user.last_name = last_name;
    if (phone) user.phone = phone;
    const normalizedAddress = buildAddressFromRequest({ address, street_address, city, province, zip_code });
    if (normalizedAddress) user.street_address = normalizedAddress;
    if (city) user.city = city;
    if (province) user.province = province;
    if (zip_code) user.zip_code = zip_code;

    await user.save();

    res.json({
      success: true,
      message: "Profile updated successfully",
      user: {
        id: user._id,
        email: user.email,
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name,
        role: role,
        phone: user.phone,
        street_address: user.street_address,
        city: user.city,
        province: user.province,
        zip_code: user.zip_code,
        access_permissions: user.access_permissions,
        created_at: user.createdAt,
        updated_at: user.updatedAt,
      },
    });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Error updating profile",
    });
  }
});

export default router;
