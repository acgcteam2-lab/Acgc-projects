import { apiFetch, API_BASE } from "./client";

const handle = async (p, opts) => {
  try {
    return await apiFetch(p, opts);
  } catch (err) {
    console.warn("catalog API failed", p, err.message || err);
    throw err;
  }
};

export const getTypes = async () => await handle(`/catalog/types`, { method: "GET" });
export const createType = async (body) => await handle(`/catalog/types`, { method: "POST", body: JSON.stringify(body) });
export const updateType = async (id, body) => await handle(`/catalog/types/${id}`, { method: "PUT", body: JSON.stringify(body) });
export const deleteType = async (id) => await handle(`/catalog/types/${id}`, { method: "DELETE" });

export const getNames = async () => await handle(`/catalog/names`, { method: "GET" });
export const createName = async (body) => await handle(`/catalog/names`, { method: "POST", body: JSON.stringify(body) });
export const updateName = async (id, body) => await handle(`/catalog/names/${id}`, { method: "PUT", body: JSON.stringify(body) });
export const deleteName = async (id) => await handle(`/catalog/names/${id}`, { method: "DELETE" });

export const getVariants = async () => await handle(`/catalog/variants`, { method: "GET" });
export const createVariant = async (body) => await handle(`/catalog/variants`, { method: "POST", body: JSON.stringify(body) });
export const updateVariant = async (id, body) => await handle(`/catalog/variants/${id}`, { method: "PUT", body: JSON.stringify(body) });
export const deleteVariant = async (id, productType = "") => await handle(`/catalog/variants/${id}${productType ? `?product_type=${encodeURIComponent(productType)}` : ""}`, { method: "DELETE" });

export const getCategories = async () => await handle(`/catalog/categories`, { method: "GET" }).catch(()=>[]);
export const createCategory = async (body) => await handle(`/catalog/categories`, { method: "POST", body: JSON.stringify(body) });
export const updateCategory = async (id, body) => await handle(`/catalog/categories/${id}`, { method: "PUT", body: JSON.stringify(body) });
export const deleteCategory = async (id) => await handle(`/catalog/categories/${id}`, { method: "DELETE" });

export const checkUsage = async (kind, id) => await handle(`/catalog/usage/${kind}/${id}`, { method: "GET" });

export default {
  getTypes,
  createType,
  updateType,
  deleteType,
  getNames,
  createName,
  updateName,
  deleteName,
  getVariants,
  createVariant,
  updateVariant,
  deleteVariant,
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  checkUsage,
};
