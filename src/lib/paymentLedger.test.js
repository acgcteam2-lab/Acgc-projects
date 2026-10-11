import { describe, expect, it } from "vitest";
import {
  getOrderPaymentAmounts,
  getOrderPaymentStatus,
  getDownpaymentExceptionSummary,
  initializePaymentLedger,
  isPaymentDiscrepancy,
  validatePaymentAmount,
} from "../../backend/services/paymentLedger.js";

const order = {
  total_amount: 100_000,
  final_project_cost: 100_000,
  payment_terms: "50%_down_payment",
  required_downpayment_amount: 50_000,
};

describe("payment ledger calculations", () => {
  it("sums only verified installments and leaves pending/rejected submissions unpaid", () => {
    const summary = getOrderPaymentAmounts({
      ...order,
      payment_ledger_initialized: true,
      legacy_verified_amount: 5_000,
      payment_records: [
        { status: "verified", verified_amount: 15_000 },
        { status: "pending", submitted_amount: 20_000 },
        { status: "rejected", submitted_amount: 10_000, verified_amount: 0 },
      ],
    });

    expect(summary).toEqual({
      totalAmount: 100_000,
      requiredAmount: 50_000,
      paidAmount: 20_000,
      remainingAmount: 80_000,
      downpaymentRemaining: 30_000,
    });
    expect(getOrderPaymentStatus({ ...order, amount_paid: summary.paidAmount })).toBe("partial_downpayment");
  });

  it("migrates an existing aggregate paid amount into the ledger opening balance", () => {
    const legacyOrder = { ...order, amount_paid: 20_000, payment_proof_amount: 20_000 };

    initializePaymentLedger(legacyOrder);

    expect(legacyOrder.legacy_verified_amount).toBe(20_000);
    expect(legacyOrder.payment_ledger_initialized).toBe(true);
    expect(getOrderPaymentAmounts(legacyOrder).paidAmount).toBe(20_000);
  });

  it.each([20_000, 50_000, 60_000, 100_000])("accepts valid payment %s within the outstanding balance", (amount) => {
    expect(validatePaymentAmount(amount, 100_000).valid).toBe(true);
  });

  it.each([0, -1, "abc", "1.234", 100_000.01])("rejects invalid or over-balance payment %s", (amount) => {
    expect(validatePaymentAmount(amount, 100_000).valid).toBe(false);
  });

  it("requires a discrepancy only when submitted and verified values differ", () => {
    expect(isPaymentDiscrepancy(20_000, 20_000)).toBe(false);
    expect(isPaymentDiscrepancy(20_000, 18_000)).toBe(true);
    expect(isPaymentDiscrepancy(20_000, 22_000)).toBe(true);
  });

  it("calculates exception shortfall without treating the payment as a completed downpayment", () => {
    const orderWithPartialPayment = {
      ...order,
      payment_ledger_initialized: true,
      legacy_verified_amount: 0,
      payment_records: [{ status: "verified", verified_amount: 10000 }],
    };
    const exception = getDownpaymentExceptionSummary(orderWithPartialPayment, 10000);

    expect(exception).toEqual({
      requiredAmount: 50000,
      acceptedAmount: 10000,
      totalPaidAtApproval: 20000,
      shortfall: 30000,
      eligible: true,
    });
    expect(getOrderPaymentStatus({ ...orderWithPartialPayment, amount_paid: exception.totalPaidAtApproval })).toBe("partial_downpayment");
  });

  it("does not allow an exception after the required downpayment is met", () => {
    expect(getDownpaymentExceptionSummary({ ...order, amount_paid: 40000 }, 10000).eligible).toBe(false);
  });
});
