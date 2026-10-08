const toDateOnly = (value) => {
  if (!value) return "";
  const dateText = value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return "";
  const parsed = new Date(`${dateText}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === dateText
    ? dateText
    : "";
};

export const getMinimumInstallationDate = (inspectionDate, today = new Date()) => {
  const startDate = toDateOnly(inspectionDate) || toDateOnly(today);
  if (!startDate) return "";
  const minimumDate = new Date(`${startDate}T00:00:00.000Z`);
  minimumDate.setUTCDate(minimumDate.getUTCDate() + 1);
  return minimumDate.toISOString().slice(0, 10);
};

export const getInstallationDateError = (inspectionDate, estimatedInstallationDate) => {
  if (!estimatedInstallationDate) return "";

  const inspectionDay = toDateOnly(inspectionDate);
  const installationDay = toDateOnly(estimatedInstallationDate);
  if (!inspectionDay) return "A valid Site Inspection Date is required before setting the Est. Installation Date.";
  if (!installationDay) return "Enter a valid Est. Installation Date.";
  if (installationDay <= inspectionDay) return "Est. Installation Date must be after the Site Inspection Date.";
  return "";
};
