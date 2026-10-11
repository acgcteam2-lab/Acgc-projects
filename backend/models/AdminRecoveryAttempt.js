import mongoose from "mongoose";

const AdminRecoveryAttemptSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    window_started_at: { type: Date, required: true },
    failed_attempts: { type: Number, default: 0 },
    next_allowed_at: { type: Date, default: null },
    expires_at: { type: Date, required: true },
  },
  { timestamps: true }
);

AdminRecoveryAttemptSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("AdminRecoveryAttempt", AdminRecoveryAttemptSchema);