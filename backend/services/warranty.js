const getWarrantyDurationDays = (period, customDays) => {
  if (String(period || "").trim().toLowerCase() === "no warranty") return 0;
  if (String(period || "").trim().toLowerCase() === "custom") {
    return Number(customDays) > 0 ? Number(customDays) : 90;
  }

  const value = String(period ?? "90").trim().toLowerCase();
  const match = value.match(/^(\d+(?:\.\d+)?)\s*(days?|months?|years?)?$/);
  if (!match) return 90;

  const amount = Number(match[1]);
  const unit = match[2] || "days";
  if (unit.startsWith("year")) return Math.round(amount * 365);
  if (unit.startsWith("month")) return Math.round(amount * 30);
  return Math.round(amount);
};

export const buildWarrantyCoverage = (startDate, period, customDays, now = new Date()) => {
  if (String(period || "").trim().toLowerCase() === "no warranty") {
    return {
      warranty_start_date: null,
      warranty_expiry_date: null,
      warranty_status: "no_warranty",
    };
  }

  const start = startDate ? new Date(startDate) : null;
  if (!start || Number.isNaN(start.getTime())) return null;

  const durationDays = getWarrantyDurationDays(period, customDays);
  if (durationDays <= 0) return null;

  const expiry = new Date(start);
  expiry.setUTCDate(expiry.getUTCDate() + durationDays);

  return {
    warranty_start_date: start,
    warranty_expiry_date: expiry,
    warranty_status: expiry > now ? "active" : "expired",
  };
};

export const isCompletedInstallationStage = (stage) => {
  const key = String(stage?.key || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const name = String(stage?.name || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const isInstallation = key === "installation" || name === "installation";
  const subStages = Array.isArray(stage?.subStages) ? stage.subStages : [];
  const stageCompleted = stage.completed === true || ["done", "completed"].includes(String(stage.status || "").toLowerCase());
  const subStagesCompleted = subStages.every((subStage) =>
    subStage.completed === true || ["done", "completed"].includes(String(subStage.status || "").toLowerCase())
  );
  return isInstallation && stageCompleted && subStagesCompleted;
};

export const applyInstallationWarranty = (order, stages, itemIndex, now = new Date()) => {
  const installationStage = (Array.isArray(stages) ? stages : []).find(isCompletedInstallationStage);
  if (!installationStage || !Array.isArray(order.items)) return false;

  const completedAt = installationStage.date ? new Date(installationStage.date) : now;
  if (Number.isNaN(completedAt.getTime())) return false;

  const assignItemWarranty = (item) => {
    if (item.warranty_status && item.warranty_status !== "pending") return;
    const period = order.warranty_assignment_mode === "per_product"
      ? item.warranty_period || order.warranty_period || 90
      : order.warranty_period || item.warranty_period || 90;
    const customDays = order.warranty_assignment_mode === "per_product"
      ? item.custom_warranty_days || order.custom_warranty_days
      : order.custom_warranty_days || item.custom_warranty_days;
    const coverage = buildWarrantyCoverage(completedAt, period, customDays, now);
    if (!coverage) return;

    item.warranty_period = period;
    item.custom_warranty_days = customDays || null;
    item.warranty_start_date = coverage.warranty_start_date;
    item.warranty_expiry_date = coverage.warranty_expiry_date;
    item.warranty_status = coverage.warranty_status;
  };

  if (Number.isInteger(itemIndex) && order.items[itemIndex]) {
    assignItemWarranty(order.items[itemIndex]);
  } else {
    order.items.forEach(assignItemWarranty);
  }

  if (order.items.length === 1) {
    const item = order.items[0];
    order.warranty_period = item.warranty_period;
    order.custom_warranty_days = item.custom_warranty_days;
    order.warranty_start_date = item.warranty_start_date;
    order.warranty_expiry_date = item.warranty_expiry_date;
    order.warranty_status = item.warranty_status;
    return true;
  }

  const terminalStatuses = new Set(["active", "expired", "no_warranty"]);
  if (!order.items.every((item) => terminalStatuses.has(String(item.warranty_status || "").toLowerCase()))) {
    order.warranty_status = "pending";
    return true;
  }

  const coveredItems = order.items.filter((item) => item.warranty_start_date);
  const expiries = coveredItems.map((item) => new Date(item.warranty_expiry_date)).filter((date) => !Number.isNaN(date.getTime()));
  order.warranty_start_date = coveredItems.length
    ? new Date(Math.min(...coveredItems.map((item) => new Date(item.warranty_start_date).getTime())))
    : null;
  order.warranty_expiry_date = expiries.length
    ? new Date(Math.max(...expiries.map((date) => date.getTime())))
    : null;
  order.warranty_status = coveredItems.length
    ? coveredItems.some((item) => item.warranty_status === "active") ? "active" : "expired"
    : "no_warranty";
  return true;
};