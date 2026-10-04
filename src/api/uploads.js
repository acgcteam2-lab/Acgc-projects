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
    const uploadedFiles = await Promise.all(Array.from(files).map(async (file, index) => {
      const signedUpload = await apiFetch("/uploads/signed-url", {
        method: "POST",
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
          purpose,
          size: file.size,
        }),
      });
      await uploadToSignedUrl(file, signedUpload, onProgress, options.signal);

      return {
        key: fieldNames[index] || "files",
        url: signedUpload.publicUrl || signedUpload.objectKey,
        filename: signedUpload.objectKey.split("/").pop(),
        originalName: file.name,
        pathname: signedUpload.objectKey,
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

const uploadToSignedUrl = (file, signedUpload, onProgress, signal) => new Promise((resolve, reject) => {
  const xhr = new XMLHttpRequest();
  xhr.open("PUT", signedUpload.uploadUrl);
  xhr.setRequestHeader("Content-Type", signedUpload.contentType || file.type || "application/octet-stream");
  xhr.upload.onprogress = (event) => {
    if (event.lengthComputable && typeof onProgress === "function") {
      onProgress(Math.round((event.loaded / event.total) * 100));
    }
  };
  xhr.onload = () => {
    if (xhr.status >= 200 && xhr.status < 300) resolve();
    else reject(new Error(`Cloud Storage upload failed with status ${xhr.status}.`));
  };
  xhr.onerror = () => reject(new Error("Network error while uploading to Cloud Storage."));
  xhr.onabort = () => reject(new Error("Cloud Storage upload was canceled."));
  if (signal) {
    if (signal.aborted) {
      xhr.abort();
      return;
    }
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
  }
  xhr.send(file);
});

export default { uploadFiles };
