import { describe, it, expect } from "vitest";
import { getCustomerPaymentProof, getPaymentSummary, isPaymentProofConfirmed, validateCustomerPaymentAmount } from "@/pages/Transactions/paymentProofUtils";

describe("getCustomerPaymentProof", () => {
  it("detects submitted proof and prefers customer proof fields", () => {
    const order = {
      payment_status: "paid",
      payment_proof_amount: 1250,
      payment_proof_file_name: "proof.png",
      payment_method: "Online",
      transaction_number: "TXN-123",
      payment_amount: 1000,
    };

    expect(getCustomerPaymentProof(order)).toMatchObject({
      submitted: true,
      amount: 1250,
      fileName: "proof.png",
      fileUrl: "",
      paymentMethod: "Online",
      transactionNumber: "TXN-123",
    });
  });

  it("returns no-submission state when no proof exists", () => {
    const order = {
      payment_status: "not_paid",
      payment_amount: 0,
      downpayment_amount: 0,
    };

    expect(getCustomerPaymentProof(order)).toMatchObject({
      submitted: false,
      amount: 0,
      fileName: "",
      fileUrl: "",
      paymentMethod: "Cash",
      transactionNumber: "",
    });
  });

  it("does not treat an admin-recorded payment as customer proof", () => {
    expect(getCustomerPaymentProof({
      payment_status: "paid",
      amount_paid: 1250,
      payment_proof_amount: 0,
    }).submitted).toBe(false);
  });
});

describe("isPaymentProofConfirmed", () => {
  it("returns true after an admin confirmation timestamp is saved", () => {
    expect(isPaymentProofConfirmed({ payment_proof_confirmed_at: "2026-09-29T12:00:00.000Z" })).toBe(true);
  });

  it("returns false while proof is unconfirmed", () => {
    expect(isPaymentProofConfirmed({ payment_proof_submitted_at: "2026-09-29T12:00:00.000Z" })).toBe(false);
  });
});

describe("validateCustomerPaymentAmount", () => {
  it.each(["20000", "50000", "60000", "100000"])("accepts a valid amount within the outstanding balance: %s", (amount) => {
    expect(validateCustomerPaymentAmount(amount, 100000).valid).toBe(true);
  });

  it("accepts a correctly grouped thousands amount and returns its numeric value", () => {
    expect(validateCustomerPaymentAmount("16,000", 16000)).toMatchObject({ valid: true, amount: 16000 });
  });

  it.each(["0", "-1", "abc", "1,00", "₱1000", "1.234", "100000.01"])("rejects invalid or over-balance input: %s", (amount) => {
    expect(validateCustomerPaymentAmount(amount, 100000).valid).toBe(false);
  });
});

describe("getPaymentSummary", () => {
  const order = {
    total_amount: 20000,
    required_downpayment_amount: 10000,
  };

  it("shows pending until any payment is confirmed", () => {
    expect(getPaymentSummary(order).status.label).toBe("Pending");
  });

  it("uses legacy verified totals when the payment-record list is empty", () => {
    const summary = getPaymentSummary({
      ...order,
      payment_records: [],
      amount_paid: 5000,
    });

    expect(summary.paidAmount).toBe(5000);
    expect(summary.status.label).toBe("Partial Downpayment");
  });

  it("does not count an unconfirmed payment proof as paid", () => {
    const summary = getPaymentSummary({
      ...order,
      payment_status: "paid",
      payment_proof_amount: 5000,
      payment_proof_submitted_at: "2026-10-03T12:00:00.000Z",
    });

    expect(summary.paidAmount).toBe(0);
    expect(summary.status.label).toBe("Pending");
  });

  it("shows partial downpayment below the required amount", () => {
    expect(getPaymentSummary({ ...order, amount_paid: 5000 }).status.label).toBe("Partial Downpayment");
  });

  it("shows downpayment once the required amount is met", () => {
    expect(getPaymentSummary({ ...order, amount_paid: 10000 }).status.label).toBe("Downpayment Completed");
  });

  it("shows partial after additional payment beyond the downpayment", () => {
    expect(getPaymentSummary({ ...order, amount_paid: 15000 }).status.label).toBe("Partial Payment");
  });

  it("deducts the actual confirmed amount above the required downpayment", () => {
    const summary = getPaymentSummary({
      total_amount: 50000,
      required_downpayment_amount: 10000,
      amount_paid: 12000,
    });

    expect(summary.paidAmount).toBe(12000);
    expect(summary.remainingAmount).toBe(38000);
  });

  it("shows fully paid when the project total is reached", () => {
    expect(getPaymentSummary({ ...order, amount_paid: 20000 }).status.label).toBe("Fully Paid");
  });

  it("uses total_amount when an online order has a zero contract_amount", () => {
    const summary = getPaymentSummary({
      ...order,
      contract_amount: 0,
      amount_paid: 10000,
    });

    expect(summary.totalAmount).toBe(20000);
    expect(summary.status.label).toBe("Downpayment Completed");
  });

  it("uses the default downpayment when legacy fields contain zero", () => {
    const summary = getPaymentSummary({
      total_amount: 40240,
      contract_amount: 40240,
      required_downpayment_amount: 0,
      downpayment_amount: 0,
    });

    expect(summary.requiredAmount).toBe(20120);
  });

  it("recalculates a percentage downpayment from the current final project cost", () => {
    const summary = getPaymentSummary({
      total_amount: 120000,
      contract_amount: 120000,
      payment_terms: "50%_down_payment",
      required_downpayment_amount: 50000,
      downpayment_amount: 50000,
    });

    expect(summary.totalAmount).toBe(120000);
    expect(summary.requiredAmount).toBe(60000);
    expect(summary.remainingAmount).toBe(120000);
  });
});
