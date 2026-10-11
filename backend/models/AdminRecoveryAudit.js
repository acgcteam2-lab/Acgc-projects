import mongoose from "mongoose";

const AdminRecoveryAuditSchema = new mongoose.Schema(
  {
    action: { type: String, enum: ["administrator_restored"], required: true },
    outcome: { type: String, enum: ["in_progress", "success", "failed"], default: "in_progress" },
    account_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    account_username: { type: String, required: true },
    account_email: { type: String, required: true },
    source_ip_hash: { type: String, required: true },
    user_agent: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model("AdminRecoveryAudit", AdminRecoveryAuditSchema);