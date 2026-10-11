import { getFinalProjectCost, getRequiredDownpayment } from "@/lib/orderPricing";

export const validateCustomerPaymentAmount = (value, remainingAmount) => {
  const input = String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(input)) {
    return { valid: false, amount: 0, message: "Enter a valid amount greater than zero, with up to two decimal places." };
  }

  const amount = Number(input);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { valid: false, amount: 0, message: "Enter a valid amount greater than zero, with up to two decimal places." };
  }
  if (Math.round(amount * 100) > Math.round((Number(remainingAmount) || 0) * 100)) {
    return { valid: false, amount, message: `Payment cannot exceed the remaining balance of ${new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(remainingAmount) || 0)}.` };
  }

  return { valid: true, amount, message: "" };
};

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

  const paymentRecords = Array.isArray(order.payment_records) ? order.payment_records : [];
  const latestRecord = [...paymentRecords].sort((first, second) => (
    new Date(second.submitted_at || second.createdAt || 0).getTime() - new Date(first.submitted_at || first.createdAt || 0).getTime()
  ))[0];
  const hasLedgerSubmission = latestRecord?.submitted_amount !== undefined && latestRecord?.submitted_amount !== null;
  const proofAmount = Number(hasLedgerSubmission
    ? latestRecord.submitted_amount
    : latestRecord?.verified_amount ?? order.payment_proof_amount ?? order.payment_amount ?? order.amount_paid ?? order.paid_amount ?? order.downpayment_amount ?? 0);
  const hasProofSubmission = Boolean(
    hasLedgerSubmission ||
    (paymentRecords.length === 0 && (
    order.payment_proof_file_name ||
    order.payment_proof_file_url ||
    order.payment_proof ||
    order.proof_of_payment ||
    order.proof_file ||
    proofAmount > 0
    ))
  );

  const normalizedMethod = order.payment_method || order.paymentMethod || (order.acceptance_method === "online" ? "Online" : "Cash");

  return {
    submitted: hasProofSubmission,
    recordId: latestRecord?._id || latestRecord?.id || "",
    amount: Number.isFinite(proofAmount) ? proofAmount : 0,
    submittedAmount: Number(latestRecord?.submitted_amount ?? proofAmount) || 0,
    verifiedAmount: Number(latestRecord?.verified_amount) || 0,
    status: hasLedgerSubmission
      ? latestRecord.status
      : latestRecord ? "none" : order.payment_proof_confirmed_at ? "verified" : hasProofSubmission ? "pending" : "none",
    adminReason: latestRecord?.admin_reason || "",
    verifiedAt: latestRecord?.verified_at || order.payment_proof_confirmed_at || null,
    amountHistory: latestRecord?.amount_history || [],
    downpaymentException: latestRecord?.downpayment_exception || null,
    fileName: latestRecord?.proof_file_name || order.payment_proof_file_name || order.payment_proof_file_url || order.payment_proof || order.proof_of_payment || order.proof_file || "",
    fileUrl: latestRecord?.proof_file_url || order.payment_proof_file_url || order.proof_file_url || order.payment_proof_url || order.proof_url || "",
    paymentMethod: latestRecord?.payment_method || normalizedMethod || "Cash",
    transactionNumber: latestRecord?.transaction_number || order.transaction_number || order.transactionNumber || "",
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
  const paymentRecords = Array.isArray(order.payment_records) ? order.payment_records : [];
  if (order.payment_ledger_initialized || paymentRecords.length > 0) {
    const recordsPaid = paymentRecords.reduce((sum, record) => (
      record.status === "verified" ? sum + Math.max(0, Number(record.verified_amount) || 0) : sum
    ), 0);
    paidAmount = Math.max(0, Number(order.legacy_verified_amount) || 0) + recordsPaid;
  } else if (explicitPaidAmount === undefined || explicitPaidAmount === null || !Number.isFinite(paidAmount)) {
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
    if (isFullPaymentPlan) {
      status = { key: "partial", label: "Partial Payment" };
    } else if (paidCents < requiredCents) {
      status = { key: "partial_downpayment", label: "Partial Downpayment" };
    } else if (paidCents <= requiredCents) {
      status = { key: "downpayment", label: "Downpayment Completed" };
    } else {
      status = { key: "partial", label: "Partial Payment" };
    }
  }

  const downpaymentRemaining = Math.max(requiredAmount - paidAmount, 0);
  return {
    totalAmount,
    requiredAmount,
    requiredPercentage: totalAmount > 0 ? Math.min(100, (requiredAmount / totalAmount) * 100) : 0,
    paidAmount,
    downpaymentRemaining,
    remainingAmount: Math.max(totalAmount - paidAmount, 0),
    status,
  };
};
