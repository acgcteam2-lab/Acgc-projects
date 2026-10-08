import { getFinalProjectCost, getRequiredDownpayment } from "@/lib/orderPricing";

export const getCustomerPaymentProof = (order) => {
  if (!order) {
    return {
      submitted: false,
      amount: 0,
      fileName: "",
      paymentMethod: "Cash",
      transactionNumber: "",
    };
  }

  const proofAmount = Number(order.payment_proof_amount ?? order.payment_amount ?? order.amount_paid ?? order.paid_amount ?? order.downpayment_amount ?? 0);
  const hasProofSubmission = Boolean(
    order.payment_proof_file_name ||
    order.payment_proof_file_url ||
    order.payment_proof ||
    order.proof_of_payment ||
    order.proof_file ||
    proofAmount > 0
  );

  const normalizedMethod = order.payment_method || order.paymentMethod || (order.acceptance_method === "online" ? "Online" : "Cash");

  return {
    submitted: hasProofSubmission,
    amount: Number.isFinite(proofAmount) ? proofAmount : 0,
    fileName: order.payment_proof_file_name || order.payment_proof_file_url || order.payment_proof || order.proof_of_payment || order.proof_file || "",
    fileUrl: order.payment_proof_file_url || order.proof_file_url || order.payment_proof_url || order.proof_url || "",
    paymentMethod: normalizedMethod || "Cash",
    transactionNumber: order.transaction_number || order.transactionNumber || "",
  };
};

export const isPaymentProofConfirmed = (order) => Boolean(order?.payment_proof_confirmed_at);

export const getPaymentSummary = (order = {}) => {
  const totalAmount = getFinalProjectCost(order);
  const requiredAmount = getRequiredDownpayment(order);
  const paymentTerms = String(order.payment_terms || "").toLowerCase();

  const explicitPaidAmount =
    order.amount_paid ?? order.payment_amount ?? order.paid_amount;
  let paidAmount = Number(explicitPaidAmount);
  if (explicitPaidAmount === undefined || explicitPaidAmount === null || !Number.isFinite(paidAmount)) {
    if (order.payment_proof_confirmed_at) {
      paidAmount = Number(order.payment_proof_amount) || 0;
    } else if (order.payment_status === "paid" && !order.payment_proof_submitted_at) {
      paidAmount = totalAmount;
    } else if (order.downpayment_received) {
      paidAmount = requiredAmount;
    } else {
      paidAmount = 0;
    }
  }
  paidAmount = Math.min(Math.max(paidAmount, 0), totalAmount);

  let status = { key: "pending", label: "Pending" };
  const paidCents = Math.round(paidAmount * 100);
  const requiredCents = Math.round(requiredAmount * 100);
  const totalCents = Math.round(totalAmount * 100);
  if (totalCents > 0 && paidCents >= totalCents) {
    status = { key: "paid", label: "Fully Paid" };
  } else if (paidAmount > 0) {
    const isFullPaymentPlan = paymentTerms === "full_payment";
    if (paidCents < requiredCents && !isFullPaymentPlan) {
      status = { key: "partial_downpayment", label: "Partial Downpayment" };
    } else if (paidCents <= requiredCents) {
      status = { key: "downpayment", label: "Downpayment Paid" };
    } else {
      status = { key: "partial", label: "Partial" };
    }
  }

  return {
    totalAmount,
    requiredAmount,
    paidAmount,
    remainingAmount: Math.max(totalAmount - paidAmount, 0),
    status,
  };
};
