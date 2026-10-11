import mongoose from "mongoose";

const AdminRecoveryStateSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    last_totp_step: { type: Number, default: -1 },
    recovery_session_hash: { type: String, default: null },
    recovery_session_expires_at: { type: Date, default: null },
    lock_id: { type: String, default: null },
    lock_expires_at: { type: Date, default: null },
    completed_at: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("AdminRecoveryState", AdminRecoveryStateSchema);