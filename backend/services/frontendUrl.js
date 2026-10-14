import process from "node:process";

export const getFrontendBaseUrl = (environment = process.env) => {
  const configuredUrl = String(environment.FRONTEND_URL || "").trim();
  const isProduction = environment.NODE_ENV === "production" || environment.VERCEL === "1";
  if (!configuredUrl && isProduction) {
    throw new Error("FRONTEND_URL must be set to the deployed frontend URL in production.");
  }

  const baseUrl = configuredUrl
    || String(environment.CLIENT_URL || environment.DEV_FRONTEND_URL || "http://localhost:5173").trim();
  let parsedUrl;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw new Error("FRONTEND_URL must be a valid absolute HTTP or HTTPS URL.");
  }

  if (!(["http:", "https:"].includes(parsedUrl.protocol)) || parsedUrl.username || parsedUrl.password) {
    throw new Error("FRONTEND_URL must be a valid absolute HTTP or HTTPS URL.");
  }
  return parsedUrl;
};

export const buildFrontendUrl = (path, query = {}, environment = process.env) => {
  const baseUrl = getFrontendBaseUrl(environment);
  const normalizedBaseUrl = `${baseUrl.origin}/`;
  const normalizedPath = String(path || "").replace(/^\/+/, "");
  const url = new URL(normalizedPath, normalizedBaseUrl);

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  });
  return url.toString();
};