const CLIENT_ID_KEY = "acgc-realtime-client-id";

export const getRealtimeClientId = () => {
  if (typeof window === "undefined") return "";
  try {
    let clientId = window.sessionStorage.getItem(CLIENT_ID_KEY);
    if (!clientId) {
      clientId = globalThis.crypto?.randomUUID?.() || `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      window.sessionStorage.setItem(CLIENT_ID_KEY, clientId);
    }
    return clientId;
  } catch {
    return "";
  }
};