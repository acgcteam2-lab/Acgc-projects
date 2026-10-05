import { apiFetch, API_BASE } from "./client";

const buildAuthHeaders = () => {
  const token = localStorage.getItem("token");
  const headers = {};
  if (token && token !== "null" && token !== "undefined") {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
};

export const uploadFiles = async (files = [], onProgress, options = {}) => {
  if (!files || files.length === 0) return { success: false, files: [] };

  if (options.purpose === "product-images") {
    const totalSize = Array.from(files).reduce((size, file) => size + file.size, 0);
    if (totalSize > 4 * 1024 * 1024) {
      throw new Error("Product photos must total 4 MB or less per upload.");
    }
  }

  if (options.purpose === "product-images" && !import.meta.env.PROD) {
    const fieldNames = options.fieldNames || [];
    const formData = new FormData();
    Array.from(files).forEach((file, index) => {
      formData.append(fieldNames[index] || "files", file, file.name);
    });

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const headers = buildAuthHeaders();
      const signal = options.signal;
      const abortUpload = () => xhr.abort();
      const removeAbortListener = () => signal?.removeEventListener("abort", abortUpload);

      if (signal?.aborted) {
        reject(new DOMException("Upload aborted.", "AbortError"));
        return;
      }

      xhr.open("POST", `${API_BASE}/uploads/product-images`);
      Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && typeof onProgress === "function") {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      };
      xhr.onload = () => {
        removeAbortListener();
        try {
          const response = JSON.parse(xhr.responseText || "{}");
          if (xhr.status >= 200 && xhr.status < 300 && response.success) {
            resolve(response);
            return;
          }
          const error = new Error(response.message || `Upload failed with status ${xhr.status}`);
          error.data = response;
          error.response = response;
          reject(error);
        } catch (error) {
          reject(error);
        }
      };
      xhr.onerror = () => {
        removeAbortListener();
        reject(new Error("Network error while uploading product photos."));
      };
      xhr.onabort = () => {
        removeAbortListener();
        reject(new DOMException("Upload aborted.", "AbortError"));
      };
      signal?.addEventListener("abort", abortUpload, { once: true });
      xhr.send(formData);
    });
  }

  if (import.meta.env.PROD) {
    const purpose = options.purpose || "uploads";
    const fieldNames = options.fieldNames || [];
    const { upload } = await import("@vercel/blob/client");
    const uploadedFiles = await Promise.all(Array.from(files).map(async (file, index) => {
      const blob = await upload(`${purpose}/${file.name}`, file, {
        access: options.access === "private" ? "private" : "public",
        handleUploadUrl: `${API_BASE}/uploads/${options.access === "private" ? "backup-token" : "token"}`,
        clientPayload: JSON.stringify({ authToken: localStorage.getItem("token"), purpose }),
        abortSignal: options.signal,
        multipart: options.multipart,
        onUploadProgress: (event) => {
          if (event.total > 0 && typeof onProgress === "function") {
            onProgress(Math.round((event.loaded / event.total) * 100));
          }
        },
      });

      return {
        key: fieldNames[index] || "files",
        url: blob.url,
        filename: blob.pathname.split("/").pop(),
        originalName: file.name,
        pathname: blob.pathname,
      };
    }));

    return { success: true, files: uploadedFiles };
  }

  const fd = new FormData();
  Array.from(files).forEach((file) => fd.append("files", file));
  const headers = buildAuthHeaders();

  if (typeof onProgress === "function") {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_BASE}/uploads`);
      Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      };
      xhr.onload = () => {
        try {
          const response = JSON.parse(xhr.responseText || "{}");
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(response);
          } else {
            const error = new Error(response.message || `Upload failed with status ${xhr.status}`);
            error.response = response;
            reject(error);
          }
        } catch (err) {
          reject(err);
        }
      };
      xhr.onerror = () => reject(new Error("Network error while uploading files."));
      xhr.send(fd);
    });
  }

  return apiFetch(`/uploads`, { method: "POST", body: fd });
};

export default { uploadFiles };
