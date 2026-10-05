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

  if (options.purpose === "payment-proofs" && Array.from(files).some((file) => file.size > 4 * 1024 * 1024)) {
    throw new Error("Payment proof must be 4 MB or smaller.");
  }

  if (["product-images", "payment-proofs"].includes(options.purpose)) {
    const fieldNames = options.fieldNames || [];
    const formData = new FormData();
    Array.from(files).forEach((file, index) => {
      const fieldName = options.purpose === "payment-proofs" ? "file" : fieldNames[index] || "files";
      formData.append(fieldName, file, file.name);
    });
    const uploadPath = options.purpose === "payment-proofs" ? "/uploads/payment-proofs" : "/uploads/product-images";
    const uploadLabel = options.purpose === "payment-proofs" ? "payment proof" : "product photos";

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

      xhr.open("POST", `${API_BASE}${uploadPath}`);
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
        reject(new Error(`Network error while uploading ${uploadLabel}.`));
      };
      xhr.onabort = () => {
        removeAbortListener();
        reject(new DOMException("Upload aborted.", "AbortError"));
      };
      signal?.addEventListener("abort", abortUpload, { once: true });
      xhr.send(formData);
    });
  }

  const purpose = options.purpose || "uploads";
  const totalBytes = Array.from(files).reduce((total, file) => total + file.size, 0);
  const uploadedBytes = Array.from(files, () => 0);
  const reportProgress = () => {
    if (typeof onProgress !== "function" || totalBytes === 0) return;
    onProgress(Math.round((uploadedBytes.reduce((total, loaded) => total + loaded, 0) / totalBytes) * 100));
  };

  const uploadedFiles = await Promise.all(Array.from(files).map(async (file, index) => {
    const signature = await apiFetch("/uploads/cloudinary-signature", {
      method: "POST",
      body: JSON.stringify({ purpose, filename: file.name }),
    });
    const body = new FormData();
    body.append("file", file);
    body.append("api_key", signature.apiKey);
    body.append("timestamp", String(signature.timestamp));
    body.append("signature", signature.signature);
    body.append("folder", signature.folder);
    body.append("public_id", signature.publicId);
    if (signature.type !== "upload") body.append("type", signature.type);

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const signal = options.signal;
      const abortUpload = () => xhr.abort();
      const removeAbortListener = () => signal?.removeEventListener("abort", abortUpload);

      if (signal?.aborted) {
        reject(new DOMException("Upload aborted.", "AbortError"));
        return;
      }

      xhr.open("POST", `https://api.cloudinary.com/v1_1/${signature.cloudName}/${signature.resourceType}/upload`);
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        uploadedBytes[index] = Math.min(event.loaded, file.size);
        reportProgress();
      };
      xhr.onload = () => {
        removeAbortListener();
        try {
          const result = JSON.parse(xhr.responseText || "{}");
          if (xhr.status >= 200 && xhr.status < 300 && result.secure_url) {
            uploadedBytes[index] = file.size;
            reportProgress();
            resolve({
              key: options.fieldNames?.[index] || "files",
              url: result.secure_url,
              filename: result.public_id,
              originalName: file.name,
              public_id: result.public_id,
              resource_type: result.resource_type,
              format: result.format,
              pathname: result.public_id,
            });
            return;
          }
          const error = new Error(result.error?.message || `Upload failed with status ${xhr.status}`);
          error.response = result;
          reject(error);
        } catch (error) {
          reject(error);
        }
      };
      xhr.onerror = () => {
        removeAbortListener();
        reject(new Error("Network error while uploading files to Cloudinary."));
      };
      xhr.onabort = () => {
        removeAbortListener();
        reject(new DOMException("Upload aborted.", "AbortError"));
      };
      signal?.addEventListener("abort", abortUpload, { once: true });
      xhr.send(body);
    });
  }));

  return { success: true, files: uploadedFiles };
};

export default { uploadFiles };
