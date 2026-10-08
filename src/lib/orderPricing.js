const toNonNegativeAmount = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(amount, 0) : 0;
};

export const getFinalProjectCost = (order = {}) => {
  const manualOverride = toNonNegativeAmount(order.manual_override);
  if (manualOverride > 0) return manualOverride;

  const savedFinalCost = toNonNegativeAmount(order.final_project_cost);
  if (savedFinalCost > 0) return savedFinalCost;

  const contractAmount = toNonNegativeAmount(order.contract_amount);
  if (contractAmount > 0) return contractAmount;

  return toNonNegativeAmount(order.total_amount ?? order.totalAmount ?? order.total);
};

export const calculateRequiredDownpayment = (projectCost, paymentTerms, configuredAmount) => {
  const total = toNonNegativeAmount(projectCost);
  const terms = String(paymentTerms || "").trim().toLowerCase();

  if (terms === "full_payment") return total;
  if (terms === "50%_down_payment") return Math.round(total * 50) / 100;

  const configured = Number(configuredAmount);
  const required = Number.isFinite(configured) && configured > 0
    ? configured
    : total * 0.5;

  return Math.min(total, Math.max(Math.round(required * 100) / 100, 0));
};

export const getRequiredDownpayment = (order = {}) => calculateRequiredDownpayment(
  getFinalProjectCost(order),
  order.payment_terms,
  order.required_downpayment_amount ?? order.downpayment_amount,
);
