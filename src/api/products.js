import { apiFetch } from "./client";

export const getProducts = (params = {}) => {
  const query = new URLSearchParams();
  if (params.search) query.append("search", params.search);
  if (params.category) query.append("category", params.category);
  if (params.adminOnly) query.append("adminOnly", "true");
  if (params.featured) query.append("featured", "true");
  return apiFetch(`/products?${query.toString()}`, { cache: "no-store" });
};

export const getProduct = (id) => apiFetch(`/products/${id}`, { cache: "no-store" });

export const createProduct = (payload) => apiFetch("/products", {
  method: "POST",
  body: JSON.stringify(payload),
});

export const updateProduct = (id, payload) => apiFetch(`/products/${id}`, {
  method: "PUT",
  body: JSON.stringify(payload),
});

export const deleteProduct = (id) => apiFetch(`/products/${id}`, {
  method: "DELETE",
});
