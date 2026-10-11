export const subscribeToRealtime = (areas, callback) => {
  if (typeof window === "undefined" || typeof callback !== "function") return () => {};

  const watchedAreas = new Set(Array.isArray(areas) ? areas : [areas]);
  const handleUpdate = (event) => {
    const detail = event.detail || {};
    if (detail.area === "all" || watchedAreas.has(detail.area)) callback(detail);
  };

  window.addEventListener("acgc:realtime", handleUpdate);
  return () => window.removeEventListener("acgc:realtime", handleUpdate);
};