import { apiFetch } from "./client";

export const getCart = () => apiFetch("/cart", { cache: "no-store" });

export const saveCart = (items) =>
  apiFetch("/cart", {
    method: "PUT",
    body: JSON.stringify({ items }),
  });