import mongoose from "mongoose";

const SystemSettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    maintenance_mode: { type: Boolean, default: false },
    global_permissions: { type: mongoose.Schema.Types.Mixed, default: {} },
    backup_schedule: { type: String, default: "weekly" },
    backup_status: { type: String, default: "Success" },
    last_backup_at: { type: Date, default: null },
    last_scheduled_backup_key: { type: String, default: null },
    backup_history: { type: [mongoose.Schema.Types.Mixed], default: [] },
    backup_recovery_password_salt: { type: String, default: null, select: false },
    backup_recovery_password_hash: { type: String, default: null, select: false },
    backup_recovery_password_display: { type: String, default: null, select: false },
    backup_recovery_password_set_at: { type: Date, default: null },
    backup_restore_lock: { type: mongoose.Schema.Types.Mixed, default: null, select: false },
    backup_create_lock: { type: mongoose.Schema.Types.Mixed, default: null, select: false },
  },
  { timestamps: true }
);

export default mongoose.model("SystemSetting", SystemSettingSchema);