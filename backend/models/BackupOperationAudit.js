import mongoose from "mongoose";

const BackupOperationAuditSchema = new mongoose.Schema(
  {
    actor_id: { type: String, default: null },
    actor_role: { type: String, required: true },
    action: { type: String, enum: ["create", "import", "restore"], required: true },
    outcome: { type: String, enum: ["started", "success", "failed"], required: true },
    backup_id: { type: String, default: null },
    backup_name: { type: String, default: null },
    details: { type: String, default: "", maxlength: 500 },
  },
  { timestamps: true }
);

BackupOperationAuditSchema.index({ createdAt: -1 });

export default mongoose.model("BackupOperationAudit", BackupOperationAuditSchema);