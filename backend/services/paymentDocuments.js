import { Buffer } from "node:buffer";

const PAYMENT_DOCUMENT_TYPES = {
  "image/jpeg": { extension: ".jpg", format: "jpg", resourceType: "image", signature: (buffer) => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  "image/png": { extension: ".png", format: "png", resourceType: "image", signature: (buffer) => buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  "image/webp": { extension: ".webp", format: "webp", resourceType: "image", signature: (buffer) => buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP" },
  "image/gif": { extension: ".gif", format: "gif", resourceType: "image", signature: (buffer) => ["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6)) },
  "application/pdf": { extension: ".pdf", format: "pdf", resourceType: "raw", signature: (buffer) => buffer.subarray(0, 5).toString("ascii") === "%PDF-" },
};

export const getPaymentDocumentType = (mimetype, value) => {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  const documentType = PAYMENT_DOCUMENT_TYPES[mimetype];
  return documentType && documentType.signature(buffer) ? documentType : null;
};
