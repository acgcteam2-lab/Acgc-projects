const progressEligibleStatuses = new Set(["approved", "admin_review", "processing", "completed"]);
const alreadyProgressingStatuses = new Set(["approved", "processing", "completed"]);

export const isProgressMonitorEligibleOrder = (order = {}) => {
  const status = String(order.status || "").toLowerCase();
  const hasAcceptedContract = String(order.contract_status || "").toLowerCase() === "accepted"
    || order.acceptedByCustomer === true;
  if (hasAcceptedContract && order.transaction_approved !== true && !alreadyProgressingStatuses.has(status)) {
    return false;
  }
  return progressEligibleStatuses.has(status);
};