import { apiFetch } from "./client";

const PRODUCT_LIST_CACHE_TTL_MS = 10_000;
const productListCache = new Map();
const productListRequests = new Map();
let productListCacheGeneration = 0;

export const invalidateProductListCache = () => {
  productListCacheGeneration += 1;
  productListCache.clear();
  productListRequests.clear();
};

export const getProducts = (params = {}) => {
  const query = new URLSearchParams();
  if (params.search) query.append("search", params.search);
  if (params.category) query.append("category", params.category);
  if (params.adminOnly) query.append("adminOnly", "true");
  if (params.featured) query.append("featured", "true");
  const queryString = query.toString();
  const cacheKey = queryString || "all";
  const cached = productListCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < PRODUCT_LIST_CACHE_TTL_MS) {
    return Promise.resolve(cached.response);
  }
  const pendingRequest = productListRequests.get(cacheKey);
  if (pendingRequest) return pendingRequest;

  const generation = productListCacheGeneration;
  let request;
  request = apiFetch(`/products?${queryString}`, { cache: "no-store" })
    .then((response) => {
      if (generation === productListCacheGeneration) {
        productListCache.set(cacheKey, { response, createdAt: Date.now() });
      }
      return response;
    })
    .finally(() => {
      if (productListRequests.get(cacheKey) === request) productListRequests.delete(cacheKey);
    });
  productListRequests.set(cacheKey, request);
  return request;
};

export const getProduct = (id) => apiFetch(`/products/${id}`, { cache: "no-store" });

export const createProduct = (payload) => apiFetch("/products", {
  method: "POST",
  body: JSON.stringify(payload),
}).then((response) => {
  invalidateProductListCache();
  return response;
});

export const updateProduct = (id, payload) => apiFetch(`/products/${id}`, {
  method: "PUT",
  body: JSON.stringify(payload),
}).then((response) => {
  invalidateProductListCache();
  return response;
});

export const deleteProduct = (id) => apiFetch(`/products/${id}`, {
  method: "DELETE",
}).then((response) => {
  invalidateProductListCache();
  return response;
});
