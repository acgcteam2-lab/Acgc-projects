import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getDownpaymentExceptionSummary,
  initializePaymentLedger,
  validateDownpaymentExceptionAcceptance,
  validateDownpaymentExceptionApproval,
  validatePaymentAmount,
} from "./paymentLedger.js";

const baseOrder = {
  total_amount: 10000,
  required_downpayment_amount: 5000,
  payment_terms: "50%_down_payment",
  payment_ledger_initialized: true,
  payment_records: [],
};

describe("downpayment exception validation", () => {
  it("requires explicit acceptance below the remaining downpayment", () => {
    const result = validateDownpaymentExceptionAcceptance(baseOrder, 4999);

    assert.equal(result.valid, false);
    assert.equal(result.requiresAcceptance, true);
    assert.equal(result.summary.shortfall, 1);
  });

  it("accepts payment amounts that cover the remaining downpayment", () => {
    assert.equal(validateDownpaymentExceptionAcceptance(baseOrder, 5000).valid, true);
    assert.equal(validateDownpaymentExceptionAcceptance(baseOrder, 6000).valid, true);
  });

  it("compares against the remaining downpayment after verified payments", () => {
    const order = {
      ...baseOrder,
      payment_records: [{ status: "verified", verified_amount: 3000 }],
    };

    assert.equal(validateDownpaymentExceptionAcceptance(order, 2000).valid, true);
    assert.equal(validateDownpaymentExceptionAcceptance(order, 1999).valid, false);
  });

  it("reports the exact shortfall for a below-downpayment payment", () => {
    const order = {
      ...baseOrder,
      total_amount: 100000,
      required_downpayment_amount: 50000,
    };
    const result = validateDownpaymentExceptionAcceptance(order, 30000);

    assert.equal(result.valid, false);
    assert.equal(result.summary.shortfall, 20000);
    assert.equal(result.message, "Warning: Payment is below the required downpayment amount. Please contact the seller to confirm whether this lower payment can be accepted before proceeding.");
  });

  it("calculates the shortfall after replacing an existing verified payment", () => {
    const order = {
      ...baseOrder,
      payment_records: [{ status: "verified", verified_amount: 4000 }],
    };
    const summary = getDownpaymentExceptionSummary(order, 1000, 4000);

    assert.equal(summary.totalPaidAtApproval, 1000);
    assert.equal(summary.shortfall, 4000);
    assert.equal(summary.eligible, true);
  });

  it("requires seller confirmation, an approving party, and a reason for exceptions", () => {
    assert.equal(validateDownpaymentExceptionApproval({ explicitlyAccepted: true }).valid, false);
    assert.equal(validateDownpaymentExceptionApproval({
      explicitlyAccepted: true,
      sellerApprovalConfirmed: true,
      sellerApprovalParty: "",
      reason: "Seller agreed to the partial payment.",
    }).valid, false);
    assert.equal(validateDownpaymentExceptionApproval({
      explicitlyAccepted: true,
      sellerApprovalConfirmed: true,
      sellerApprovalParty: "Sales Manager",
      reason: "Seller agreed to the partial payment.",
    }).valid, true);
  });
});

describe("payment ledger duplicate proof reconciliation", () => {
  it("removes a pending proof when the same amount and proof were already verified", () => {
    const proofUrl = "https://res.cloudinary.com/acgc/payment-proofs/receipt.png";
    const order = {
      payment_ledger_initialized: true,
      payment_records: [
        { _id: "pending", status: "pending", submitted_amount: 5000, proof_file_url: proofUrl },
        { _id: "verified", status: "verified", verified_amount: 5000, proof_file_url: proofUrl },
      ],
    };

    initializePaymentLedger(order);

    assert.deepEqual(order.payment_records.map((record) => record._id), ["verified"]);
  });

  it("reconciles an admin-attached proof by filename", () => {
    const order = {
      payment_ledger_initialized: true,
      payment_records: [
        { _id: "pending", status: "pending", submitted_amount: 5000, proof_file_name: "receipt-october.pdf" },
        {
          _id: "verified",
          status: "verified",
          verified_amount: 5000,
          supporting_documents: [{ original_name: "receipt-october.pdf" }],
        },
      ],
    };

    initializePaymentLedger(order);

    assert.deepEqual(order.payment_records.map((record) => record._id), ["verified"]);
  });

  it("keeps equal-amount payments with different references as separate records", () => {
    const order = {
      payment_ledger_initialized: true,
      payment_records: [
        { _id: "pending", status: "pending", submitted_amount: 5000, transaction_number: "TX-1" },
        { _id: "verified", status: "verified", verified_amount: 5000, transaction_number: "TX-2" },
      ],
    };

    initializePaymentLedger(order);

    assert.equal(order.payment_records.length, 2);
  });

  it("does not migrate legacy proof fields into a pending duplicate of a verified record", () => {
    const proofUrl = "https://res.cloudinary.com/acgc/payment-proofs/receipt.png";
    const order = {
      payment_proof_submitted_at: new Date("2026-10-10T10:00:00.000Z"),
      payment_proof_amount: 5000,
      payment_proof_file_url: proofUrl,
      payment_records: [
        { _id: "verified", status: "verified", verified_amount: 5000, proof_file_url: proofUrl },
      ],
    };

    initializePaymentLedger(order);

    assert.equal(order.payment_ledger_initialized, true);
    assert.equal(order.payment_records.length, 1);
    assert.equal(order.payment_records[0]._id, "verified");
  });
});

describe("customer payment amount validation", () => {
  it("rejects an amount below the remaining required downpayment", () => {
    assert.equal(validatePaymentAmount(4999.99, 10000, 5000).valid, false);
  });

  it("accepts an amount that covers the remaining required downpayment", () => {
    assert.equal(validatePaymentAmount(5000, 10000, 5000).valid, true);
    assert.equal(validatePaymentAmount(6000, 10000, 5000).valid, true);
  });

  it("allows smaller installment payments after the downpayment is covered", () => {
    assert.equal(validatePaymentAmount(1000, 5000, 0).valid, true);
  });
});