export const PRODUCT_IMAGE_PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='400' viewBox='0 0 600 400'%3E%3Crect width='600' height='400' fill='%23e2e8f0'/%3E%3Cpath d='M248 148h104a28 28 0 0 1 28 28v48a28 28 0 0 1-28 28H248a28 28 0 0 1-28-28v-48a28 28 0 0 1 28-28Zm0 20a8 8 0 0 0-8 8v48a8 8 0 0 0 8 8h104a8 8 0 0 0 8-8v-48a8 8 0 0 0-8-8H248Zm18 22a16 16 0 1 1 0 32 16 16 0 0 1 0-32Zm50 35 17-21 31 40H244l34-42 25 30 13-7Z' fill='%2394a3b8'/%3E%3Ctext x='300' y='292' text-anchor='middle' font-family='Arial, sans-serif' font-size='24' font-weight='700' fill='%23475569'%3EProduct image%3C/text%3E%3C/svg%3E";

export const getProductImageSource = (product) => {
  const candidates = [product?.image_url, product?.image, product?.images];
  const findSource = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) {
        const source = findSource(item);
        if (source) return source;
      }
      return "";
    }
    if (value && typeof value === "object") {
      if (typeof value.url === "string" && value.url.trim()) return value.url.trim();
      for (const item of Object.values(value)) {
        const source = findSource(item);
        if (source) return source;
      }
      return "";
    }
    return typeof value === "string" && value.trim() && !/^(blob|file):/i.test(value.trim())
      ? value.trim()
      : "";
  };

  for (const candidate of candidates) {
    const source = findSource(candidate);
    if (source) return source;
  }
  return "";
};

const getCloudinaryParts = (source) => {
  try {
    const url = new URL(source);
    if (url.hostname !== "res.cloudinary.com") return null;
    const marker = "/image/upload/";
    const uploadIndex = url.pathname.indexOf(marker);
    if (uploadIndex < 0) return null;
    const insertionIndex = uploadIndex + marker.length;
    const pathAfterUpload = url.pathname.slice(insertionIndex).split("/");
    while (/^(?:f_|q_|w_|h_|c_|g_|ar_|dpr_|e_|t_)/.test(pathAfterUpload[0] || "")) {
      pathAfterUpload.shift();
    }
    return { url, marker, uploadIndex, publicPath: pathAfterUpload.join("/") };
  } catch {
    return null;
  }
};

export const getOptimizedProductImageUrl = (source, width = 640) => {
  if (typeof source !== "string" || !source.trim()) return "";
  const cloudinary = getCloudinaryParts(source);
  if (!cloudinary) return source;

  const safeWidth = Math.max(160, Math.min(1600, Math.round(Number(width) || 640)));
  const { url, marker, uploadIndex, publicPath } = cloudinary;
  const insertionIndex = uploadIndex + marker.length;
  url.pathname = `${url.pathname.slice(0, insertionIndex)}f_auto,q_auto,w_${safeWidth},c_limit/${publicPath}`;
  return url.toString();
};

export const getProductImageSrcSet = (source, widths = [320, 640, 960]) => {
  if (!getCloudinaryParts(source)) return undefined;
  return widths
    .map((width) => `${getOptimizedProductImageUrl(source, width)} ${width}w`)
    .join(", ");
};

export const handleProductImageError = (event) => {
  event.currentTarget.onerror = null;
  event.currentTarget.removeAttribute("srcset");
  event.currentTarget.src = PRODUCT_IMAGE_PLACEHOLDER;
};
export const handleProductImageLoad = (event) => {
  event.currentTarget.parentElement?.querySelector("[data-product-image-skeleton]")?.remove();
};
