const adminRouteLoaders = {
  "/dashboard": () => import("@/pages/Dashboard/Dashboard"),
  "/site-inspection": () => import("@/pages/SiteInspection/SiteInspection"),
  "/transactions": () => import("@/pages/Transactions/Transactions"),
  "/progress-monitor": () => import("@/pages/ProgressMonitor/ProgressMonitor"),
  "/product": () => import("@/pages/Product/Product"),
  "/profile": () => import("@/pages/AdminProfile/AdminProfile"),
  "/settings": () => import("@/pages/Settings/Settings"),
};

const preloadedRoutes = new Map();

export const prefetchAdminRoute = (path) => {
  const loadRoute = adminRouteLoaders[path];
  if (!loadRoute) return Promise.resolve();

  if (!preloadedRoutes.has(path)) {
    const request = loadRoute().catch(() => {
      preloadedRoutes.delete(path);
    });
    preloadedRoutes.set(path, request);
  }

  return preloadedRoutes.get(path);
};