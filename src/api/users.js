import { apiFetch, API_BASE } from "./client";

export const searchCustomers = (query) =>
  apiFetch(`/auth/customers?search=${encodeURIComponent(query)}`);

export const getAdminUsers = (params = {}) => {
  const query = new URLSearchParams();
  if (params.role && params.role !== "all") query.set("role", params.role);
  if (params.search) query.set("search", params.search);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiFetch(`/auth/users${suffix}`);
};

export const updateAdminUserAccess = (userId, payload) =>
  apiFetch(`/auth/users/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });

export const getSystemSettings = () => apiFetch("/auth/system-settings");

export const updateSystemSettings = (payload) =>
  apiFetch("/auth/system-settings", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });

export const createSystemBackup = (type) =>
  apiFetch("/auth/system-settings/backups", {
    method: "POST",
    body: JSON.stringify({ type }),
  });

export const uploadSystemBackup = (file) => {
  const body = new FormData();
  body.append("backupFile", file);
  return apiFetch("/auth/system-settings/backups/import", {
    method: "POST",
    body,
  });
};

export const restoreSystemBackup = (backupId) =>
  apiFetch(`/auth/system-settings/backups/${encodeURIComponent(backupId)}/restore`, {
    method: "POST",
  });

export const deleteSystemBackup = (backupId) =>
  apiFetch(`/auth/system-settings/backups/${encodeURIComponent(backupId)}`, {
    method: "DELETE",
  });

export const downloadSystemBackup = async (backupId) => {
  const token = localStorage.getItem("token");
  const response = await fetch(
    `${API_BASE}/auth/system-settings/backups/${encodeURIComponent(backupId)}/download`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || "Unable to download backup.");
  }

  const disposition = response.headers.get("content-disposition") || "";
  const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || `backup-${backupId}.zip`;
  return { blob: await response.blob(), filename };
};

export const getSystemSettingsEventsUrl = () => {
  const token = localStorage.getItem("token");
  const base = (API_BASE || "").replace(/\/$/, "");
  return `${base}/auth/system-settings/events?token=${encodeURIComponent(token || "")}`;
};
