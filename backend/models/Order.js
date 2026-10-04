import mongoose from "mongoose";

const OrderItemSchema = new mongoose.Schema(
  {
    product_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    unit_price: {
      type: Number,
      required: true,
      default: 0,
    },
    pricing_method: {
      type: String,
      trim: true,
      default: "",
    },
    price_per_sqft: {
      type: Number,
      default: 0,
      min: 0,
    },
    price_per_blade: {
      type: Number,
      default: 0,
      min: 0,
    },
    base_price: {
      type: Number,
      default: 0,
      min: 0,
    },
    blade_count: {
      type: Number,
      default: 0,
      min: 0,
    },
    estimated_price_override: {
      type: Number,
      default: 0,
      min: 0,
    },
    line_total: {
      type: Number,
      default: 0,
      min: 0,
    },
    quantity: {
      type: Number,
      required: true,
      default: 1,
    },
    unit: {
      type: String,
      default: "piece",
    },
    category: {
      type: String,
      trim: true,
      default: "",
    },
    product_type: {
      type: String,
      trim: true,
      default: "",
    },
    width: {
      type: Number,
      default: 0,
      min: 0,
    },
    height: {
      type: Number,
      default: 0,
      min: 0,
    },
    measurement_unit: {
      type: String,
      default: "in",
    },
    area: {
      type: Number,
      default: 0,
      min: 0,
    },
    estimation_mode: {
      type: String,
      enum: ["auto", "manual"],
      default: "auto",
    },
    manual_estimated_total: {
      type: Number,
      default: 0,
      min: 0,
    },
    estimated_price: {
      type: Number,
      default: 0,
      min: 0,
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
    warranty_period: {
      type: String,
      trim: true,
      default: "",
    },
    custom_warranty_days: {
      type: Number,
      default: null,
    },
    warranty_start_date: {
      type: Date,
      default: null,
    },
    warranty_expiry_date: {
      type: Date,
      default: null,
    },
    warranty_status: {
      type: String,
      trim: true,
      default: "",
    },
    customized: {
      type: Boolean,
      default: false,
    },
    dimensions: {
      width: {
        type: Number,
        default: 0,
        min: 0,
      },
      height: {
        type: Number,
        default: 0,
        min: 0,
      },
      unit: {
        type: String,
        trim: true,
        default: "in",
      },
      quantity: {
        type: Number,
        default: 1,
        min: 0,
      },
      customized: {
        type: Boolean,
        default: false,
      },
    },
    is_estimate: {
      type: Boolean,
      default: false,
    },
    review: {
      rating: { type: Number, min: 1, max: 5, default: null },
      title: { type: String, trim: true, default: "" },
      comment: { type: String, trim: true, default: "" },
      photos: { type: [String], default: [] },
      submittedAt: { type: Date, default: null },
      updatedAt: { type: Date, default: null },
    },
    progress: {
      type: Number,
      min: 0,
      max: 100,
      default: null,
    },
    progress_stages: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
  },
  { _id: false }
);

const OrderSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    customer_name: {
      type: String,
      trim: true,
      default: "",
    },
    customer_phone: {
      type: String,
      trim: true,
      default: "",
    },
    items: {
      type: [OrderItemSchema],
      default: [],
    },
    payment_terms: {
      type: String,
      trim: true,
      default: "",
    },
    agreed_payment_date: {
      type: Date,
      default: null,
    },
    has_account_on_website: {
      type: Boolean,
      default: false,
    },
    downpayment_received: {
      type: Boolean,
      default: false,
    },
    manual_override: {
      type: Number,
      default: 0,
    },
    attachments: {
      type: [String],
      default: [],
    },
    total_amount: {
      type: Number,
      required: true,
      default: 0,
    },
    payment_proof_amount: {
      type: Number,
      default: 0,
    },
    amount_paid: {
      type: Number,
      min: 0,
    },
    payment_proof_submitted_at: {
      type: Date,
      default: null,
    },
    payment_proof_confirmed_at: {
      type: Date,
      default: null,
    },
    payment_proof_file_name: {
      type: String,
      trim: true,
      default: "",
    },
    payment_proof_file_url: {
      type: String,
      trim: true,
      default: "",
    },
    payment_method: {
      type: String,
      trim: true,
      default: "",
    },
    transaction_number: {
      type: String,
      trim: true,
      default: "",
    },
    status: {
      type: String,
      enum: [
        "order_submitted",
        "admin_review",
        "site_inspection",
        "contract_sent",
        "contract_accepted",
        "approved",
        "contract_declined",
        "processing",
        "completed",
        "cancelled",
      ],
      default: "order_submitted",
    },
    order_type: {
      type: String,
      enum: ["online_order", "walk_in_customer"],
      default: "online_order",
    },
    contract_status: {
      type: String,
      enum: ["pending", "sent", "accepted", "declined"],
      default: "pending",
    },
    payment_status: {
      type: String,
      enum: ["not_paid", "pending", "partial_downpayment", "downpayment", "partial", "paid"],
      default: "pending",
    },
    tracking: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    customer_email: {
      type: String,
      trim: true,
      default: "",
    },
    shipping_address: {
      type: String,
      default: "",
    },
    inspection_status: {
      type: String,
      enum: ["pending", "scheduled", "completed", "failed"],
      default: "pending",
    },
    inspection_completed_at: {
      type: Date,
      default: null,
    },
    inspection_date: {
      type: Date,
      default: null,
    },
    estimated_installation_date: {
      type: Date,
      default: null,
    },
    inspection_notes: {
      type: String,
      trim: true,
      default: "",
    },
    issues_found: {
      type: Boolean,
      default: false,
    },
    // Progress tracking
    progress: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },
    progress_stages: {
      type: [
        new mongoose.Schema(
          {
            key: { type: String, trim: true, default: "" },
            name: { type: String, trim: true, default: "" },
            status: {
              type: String,
              enum: ["pending", "in_progress", "done", "delayed", "on_hold"],
              default: "pending",
            },
            completed: { type: Boolean, default: false },
            date: { type: Date, default: null },
            delayReason: { type: String, trim: true, default: "" },
            delayExpectedResolution: { type: Date, default: null },
            delayNotes: { type: String, trim: true, default: "" },
            delayReportedAt: { type: Date, default: null },
            delayReportedBy: { type: String, trim: true, default: "" },
            proposedInstallationDate: { type: Date, default: null },
            proposedInstallationTime: { type: String, trim: true, default: "" },
            customerResponse: {
              type: String,
              enum: ["pending", "accepted", "declined", "reschedule_requested"],
              default: "pending",
            },
            customerResponseAt: { type: Date, default: null },
            customerDeclineReason: { type: String, trim: true, default: "" },
            customerPreferredInstallationDate: { type: Date, default: null },
            customerPreferredInstallationTime: { type: String, trim: true, default: "" },
            customerRescheduleNotes: { type: String, trim: true, default: "" },
            delayHistory: {
              type: [
                new mongoose.Schema(
                  {
                    reason: { type: String, trim: true, default: "" },
                    expectedResolution: { type: Date, default: null },
                    notes: { type: String, trim: true, default: "" },
                    reportedAt: { type: Date, default: null },
                    reportedBy: { type: String, trim: true, default: "" },
                    status: { type: String, trim: true, default: "delayed" },
                    resolvedAt: { type: Date, default: null },
                  },
                  { _id: false }
                ),
              ],
              default: [],
            },
            images: { type: [String], default: [] },
            subStages: {
              type: [
                new mongoose.Schema(
                  {
                    name: { type: String, trim: true, default: "" },
                    description: { type: String, trim: true, default: "" },
                    status: {
                      type: String,
                      enum: ["pending", "in_progress", "done", "delayed", "on_hold"],
                      default: "pending",
                    },
                    completed: { type: Boolean, default: false },
                    date: { type: Date, default: null },
                    images: { type: [String], default: [] },
                  },
                  { _id: false }
                ),
              ],
              default: [],
            },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    contract_terms: {
      type: String,
      trim: true,
      default: "",
    },
    contract_amount: {
      type: Number,
      default: 0,
    },
    downpayment_amount: {
      type: Number,
      default: 0,
    },
    required_downpayment_amount: {
      type: Number,
      min: 0,
    },
    contractGenerated: {
      type: Boolean,
      default: false,
    },
    contractId: {
      type: String,
      trim: true,
      default: "",
    },
    contractVersion: {
      type: Number,
      default: 0,
    },
    currentContractVersion: {
      type: Number,
      default: 0,
    },
    contractGeneratedAt: {
      type: Date,
      default: null,
    },
    contractNeedsRegeneration: {
      type: Boolean,
      default: false,
    },
    contractStatus: {
      type: String,
      trim: true,
      default: "Not Generated",
    },
    contractSentAt: {
      type: Date,
      default: null,
    },
    contract_email_status: {
      type: String,
      enum: ["not_sent", "queued", "sent", "failed"],
      default: "not_sent",
    },
    contract_email_queued_at: {
      type: Date,
      default: null,
    },
    contract_email_sent_at: {
      type: Date,
      default: null,
    },
    contract_email_error: {
      type: String,
      trim: true,
      default: "",
    },
    contractDeclineReason: {
      type: String,
      trim: true,
      default: "",
    },
    contractDeclinedAt: {
      type: Date,
      default: null,
    },
    acceptedByCustomer: {
      type: Boolean,
      default: false,
    },
    acceptanceMethod: {
      type: String,
      trim: true,
      default: "",
    },
    acceptedAt: {
      type: Date,
      default: null,
    },
    transactionCreated: {
      type: Boolean,
      default: false,
    },
    transactionCreatedAt: {
      type: Date,
      default: null,
    },
    contractSnapshot: {
      type: Object,
      default: {},
    },
    contractHistory: {
      type: [
        new mongoose.Schema(
          {
            version: { type: Number, default: 1 },
            contractId: { type: String, trim: true, default: "" },
            generatedAt: { type: Date, default: null },
            status: { type: String, trim: true, default: "Current" },
            acceptedAt: { type: Date, default: null },
            acceptanceMethod: { type: String, trim: true, default: "" },
            snapshot: { type: Object, default: {} },
          },
          { _id: false }
        )
      ],
      default: [],
    },
    warranty_assignment_mode: {
      type: String,
      enum: ["same", "per_product"],
      default: "same",
    },
    warranty_period: {
      type: String,
      trim: true,
      default: "",
    },
    custom_warranty_days: {
      type: Number,
      default: null,
    },
    warranty_start_date: {
      type: Date,
      default: null,
    },
    warranty_expiry_date: {
      type: Date,
      default: null,
    },
    warranty_status: {
      type: String,
      trim: true,
      default: "",
    },
    warranty_terms: {
      type: String,
      trim: true,
      default: "",
    },
    review: {
      rating: {
        type: Number,
        min: 1,
        max: 5,
        default: null,
      },
      title: {
        type: String,
        trim: true,
        default: "",
      },
      comment: {
        type: String,
        trim: true,
        default: "",
      },
      photos: {
        type: [String],
        default: [],
      },
      submittedAt: {
        type: Date,
        default: null,
      },
      updatedAt: {
        type: Date,
        default: null,
      },
    },
    // Walk-in customer specific fields
    acceptance_method: {
      type: String,
      enum: ["online", "walk_in_signed_contract", "walk_in_pending_contract"],
      default: "online",
    },
    signed_contract_url: {
      type: String,
      trim: true,
      default: "",
    },
    contract_number: {
      type: String,
      trim: true,
      default: "",
    },
    contract_signed_date: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("Order", OrderSchema);
