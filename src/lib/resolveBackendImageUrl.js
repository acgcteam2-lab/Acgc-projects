import { API_BASE } from "../api/client";

export const resolveBackendImageUrl = (url, apiBase = API_BASE) => {
  if (typeof url !== "string" || !url.trim()) return url;

  const backendBase = apiBase.replace(/\/api\/?$/, "");
  if (!/^https?:\/\//i.test(backendBase)) return url;

  try {
    const imageUrl = new URL(url);
    const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
    if (localHosts.has(imageUrl.hostname) && imageUrl.pathname.startsWith("/uploads/")) {
      return `${backendBase}${imageUrl.pathname}${imageUrl.search}${imageUrl.hash}`;
    }
  } catch {
    return url;
  }

  return url;
};