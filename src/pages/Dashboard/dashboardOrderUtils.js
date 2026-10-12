const ACTIVE_SITE_INSPECTION_CONTRACT_STATUSES = new Set(["", "pending", "sent", "declined"]);

export const isUntransferredSiteInspection = (order = {}) => {
  const status = String(order.status || "").trim().toLowerCase();
  const contractStatus = String(order.contract_status || order.contractStatus || "").trim().toLowerCase();

  return status === "site_inspection"
    && order.transactionCreated !== true
    && ACTIVE_SITE_INSPECTION_CONTRACT_STATUSES.has(contractStatus);
};