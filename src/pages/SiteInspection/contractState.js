import { getFinalProjectCost, getRequiredDownpayment } from "@/lib/orderPricing";

export const getCustomerNameFromOrder = (order = {}) => {
  if (order.customer_name) return order.customer_name;
  const firstName = order.customer?.first_name || "";
  const lastName = order.customer?.last_name || "";
  const fullName = `${firstName} ${lastName}`.trim();
  return fullName || "Customer";
};

export const hasExistingContract = (order = {}) => {
  const contractStatus = String(order.contract_status || order.contractStatus || "").trim().toLowerCase();
  const orderStatus = String(order.status || "").trim().toLowerCase();
  const snapshot = order.contractSnapshot;

  return Boolean(
    order.contractGenerated ||
    order.contractId ||
    order.contract_id ||
    order.contractVersion ||
    order.currentContractVersion ||
    order.contractGeneratedAt ||
    order.contractSentAt ||
    order.contract_sent_at ||
    order.acceptedByCustomer ||
    order.signed_contract_url ||
    ["sent", "accepted"].includes(contractStatus) ||
    ["contract_sent", "contract_accepted"].includes(orderStatus) ||
    (snapshot && Object.keys(snapshot).length > 0)
  );
};

export const buildContractSnapshot = (order = {}) => {
  const items = Array.isArray(order.items) ? order.items : [];
  const firstItem = items[0] || {};
  const width = Number(firstItem.width ?? firstItem.dimensions?.width ?? 0) || 0;
  const height = Number(firstItem.height ?? firstItem.dimensions?.height ?? 0) || 0;
  const quantity = Number(firstItem.quantity ?? firstItem.qty ?? 1) || 1;
  const projectCost = getFinalProjectCost(order);
  const downpayment = getRequiredDownpayment(order);
  const inspectionDate = order.inspection_date
    ? new Date(order.inspection_date).toISOString().slice(0, 10)
    : "";

  return {
    customerName: getCustomerNameFromOrder(order),
    email: order.customer_email || order.customer?.email || "",
    phone: order.customer_phone || order.customer?.phone || "",
    siteAddress: order.shipping_address || "",
    product: firstItem.name || firstItem.product_id?.name || firstItem.product_name || "Project Item",
    dimensions: `${width} x ${height} ${firstItem.unit || "in"}`.trim(),
    quantity,
    projectCost,
    downpayment,
    paymentTerms: order.payment_terms || "",
    inspectionDate,
  };
};

export const hasContractSnapshotChanged = (order = {}) => {
  const savedSnapshot = order.contractSnapshot || {};
  if (!savedSnapshot || Object.keys(savedSnapshot).length === 0) return false;

  return JSON.stringify(buildContractSnapshot(order)) !== JSON.stringify(savedSnapshot);
};
