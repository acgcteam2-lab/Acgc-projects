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
