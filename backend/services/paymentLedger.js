import { getFinalProjectCost, getRequiredDownpayment } from "../../src/lib/orderPricing.js";

const toCents = (value) => Math.round((Number(value) || 0) * 100);
const fromCents = (value) => value / 100;

export const getOrderPaymentAmounts = (order = {}) => {
  const totalAmount = getFinalProjectCost(order);
  const requiredAmount = getRequiredDownpayment(order);
  const records = Array.isArray(order.payment_records) ? order.payment_records : [];
  let paidAmount;

  if (order.payment_ledger_initialized || records.length > 0) {
    const legacyPaid = Math.max(0, Number(order.legacy_verified_amount) || 0);
    const verifiedRecords = records.reduce((sum, record) => (
      record.status === "verified" ? sum + Math.max(0, Number(record.verified_amount) || 0) : sum
    ), 0);
    paidAmount = legacyPaid + verifiedRecords;
  } else if (order.amount_paid !== undefined && order.amount_paid !== null && Number.isFinite(Number(order.amount_paid))) {
    paidAmount = Number(order.amount_paid);
  } else if (order.payment_proof_confirmed_at) {
    paidAmount = Number(order.payment_proof_amount) || 0;
  } else if (order.payment_status === "paid" && !order.payment_proof_submitted_at) {
    paidAmount = totalAmount;
  } else if (order.downpayment_received) {
    paidAmount = requiredAmount;
  } else {
    paidAmount = 0;
  }

  paidAmount = Math.min(Math.max(paidAmount, 0), totalAmount);
  const remainingAmount = Math.max(totalAmount - paidAmount, 0);
  const downpaymentRemaining = Math.max(requiredAmount - paidAmount, 0);
  return { totalAmount, requiredAmount, paidAmount, remainingAmount, downpaymentRemaining };
};

export const getOrderPaymentStatus = (order = {}) => {
  const { totalAmount, requiredAmount, paidAmount } = getOrderPaymentAmounts(order);
  if (toCents(totalAmount) > 0 && toCents(paidAmount) >= toCents(totalAmount)) return "paid";
  if (toCents(paidAmount) <= 0) return "pending";
  if (order.payment_terms === "full_payment") return "partial";
  if (toCents(paidAmount) < toCents(requiredAmount)) return "partial_downpayment";
  if (toCents(paidAmount) === toCents(requiredAmount)) return "downpayment";
  return "partial";
};

export const initializePaymentLedger = (order) => {
  if (order.payment_ledger_initialized) return;
  const previousPaid = getOrderPaymentAmounts(order).paidAmount;
  order.legacy_verified_amount = previousPaid;
  order.payment_ledger_initialized = true;
  order.payment_records = Array.isArray(order.payment_records) ? order.payment_records : [];
  if (
    order.payment_proof_submitted_at &&
    !order.payment_proof_confirmed_at &&
    Number(order.payment_proof_amount) > 0 &&
    !order.payment_records.some((record) => record.status === "pending")
  ) {
    order.payment_records.push({
      submitted_amount: Number(order.payment_proof_amount),
      status: "pending",
      payment_method: order.payment_method || "Cash",
      transaction_number: order.transaction_number || "",
      proof_file_name: order.payment_proof_file_name || "",
      proof_file_url: order.payment_proof_file_url || "",
      submitted_at: order.payment_proof_submitted_at,
    });
  }
  order.amount_paid = previousPaid;
};

export const validatePaymentAmount = (value, remainingAmount) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || !/^\d+(?:\.\d{1,2})?$/.test(String(value).trim())) {
    return { valid: false, amount: 0, message: "Please enter a valid payment amount greater than zero, with up to two decimal places." };
  }
  const cents = toCents(amount);
  if (cents > toCents(remainingAmount)) {
    return { valid: false, amount, message: "Payment cannot exceed the remaining project balance." };
  }
  return { valid: true, amount: fromCents(cents), message: "" };
};

export const isPaymentDiscrepancy = (submittedAmount, verifiedAmount) => (
  toCents(submittedAmount) !== toCents(verifiedAmount)
);

export const getDownpaymentExceptionSummary = (order, acceptedAmount, replacedVerifiedAmount = 0) => {
  const { totalAmount, requiredAmount, paidAmount } = getOrderPaymentAmounts(order);
  const projectedPaidAmount = Math.min(
    Math.max(paidAmount - Math.max(Number(replacedVerifiedAmount) || 0, 0) + Math.max(Number(acceptedAmount) || 0, 0), 0),
    totalAmount,
  );
  const shortfall = Math.max(requiredAmount - projectedPaidAmount, 0);

  return {
    requiredAmount,
    acceptedAmount: Math.max(Number(acceptedAmount) || 0, 0),
    totalPaidAtApproval: projectedPaidAmount,
    shortfall,
    eligible: acceptedAmount > 0 && requiredAmount > 0 && toCents(projectedPaidAmount) < toCents(requiredAmount),
  };
};
