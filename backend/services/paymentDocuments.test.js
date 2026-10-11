import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { getPaymentDocumentType } from "./paymentDocuments.js";

describe("getPaymentDocumentType", () => {
  it("accepts supported file signatures matching the declared MIME type", () => {
    assert.equal(getPaymentDocumentType("image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0x00])).format, "jpg");
    assert.equal(getPaymentDocumentType("image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])).format, "png");
    assert.equal(getPaymentDocumentType("image/webp", Buffer.from("RIFF0000WEBP"))?.format, "webp");
    assert.equal(getPaymentDocumentType("image/gif", Buffer.from("GIF89a"))?.format, "gif");
    assert.equal(getPaymentDocumentType("application/pdf", Buffer.from("%PDF-1.7"))?.resourceType, "raw");
  });

  it("rejects unsupported MIME types and spoofed file contents", () => {
    assert.equal(getPaymentDocumentType("image/svg+xml", Buffer.from("<svg />")), null);
    assert.equal(getPaymentDocumentType("application/pdf", Buffer.from("not a pdf")), null);
    assert.equal(getPaymentDocumentType("image/png", Buffer.from("GIF89a")), null);
  });
});
