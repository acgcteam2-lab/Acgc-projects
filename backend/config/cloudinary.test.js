import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import process from "node:process";
import cloudinaryPackage from "cloudinary";
import {
  getCloudinaryConfig,
  getPrivatePaymentDocumentDownloadUrl,
  uploadPrivatePaymentDocumentBuffer,
  uploadPrivateRawBuffer,
} from "./cloudinary.js";

describe("getCloudinaryConfig", () => {
  it("prefers a complete split configuration over a stale Cloudinary dashboard URL", () => {
    assert.deepEqual(
      getCloudinaryConfig({
        CLOUDINARY_URL: "cloudinary://url-key:url-secret@sample-cloud",
        CLOUDINARY_CLOUD_NAME: "stale-cloud",
        CLOUDINARY_API_KEY: "stale-key",
        CLOUDINARY_API_SECRET: "stale-secret",
      }),
      {
        cloud_name: "stale-cloud",
        api_key: "stale-key",
        api_secret: "stale-secret",
      },
    );
  });

  it("supports the separate Cloudinary variables", () => {
    assert.deepEqual(
      getCloudinaryConfig({
        CLOUDINARY_CLOUD_NAME: "sample-cloud",
        CLOUDINARY_API_KEY: "sample-key",
        CLOUDINARY_API_SECRET: "sample-secret",
      }),
      {
        cloud_name: "sample-cloud",
        api_key: "sample-key",
        api_secret: "sample-secret",
      },
    );
  });

  it("uses the split configuration when a dashboard URL is malformed", () => {
    assert.deepEqual(
      getCloudinaryConfig({
        CLOUDINARY_URL: "https://invalid.example",
        CLOUDINARY_CLOUD_NAME: "sample-cloud",
        CLOUDINARY_API_KEY: "sample-key",
        CLOUDINARY_API_SECRET: "sample-secret",
      }),
      {
        cloud_name: "sample-cloud",
        api_key: "sample-key",
        api_secret: "sample-secret",
      },
    );
  });

  it("rejects malformed dashboard URLs when split variables are incomplete", () => {
    assert.throws(
      () => getCloudinaryConfig({
        CLOUDINARY_URL: "https://invalid.example",
        CLOUDINARY_CLOUD_NAME: "sample-cloud",
      }),
      { message: /CLOUDINARY_URL must match/ },
    );
  });

  it("uploads private backup archives with the available chunked stream API", async () => {
    const cloudinary = cloudinaryPackage.v2;
    const originalChunkedStream = cloudinary.uploader.upload_chunked_stream;
    const originalConfig = cloudinary.config;
    const previousEnv = {
      CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
      CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
      CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
      CLOUDINARY_URL: process.env.CLOUDINARY_URL,
    };

    process.env.CLOUDINARY_CLOUD_NAME = "sample-cloud";
    process.env.CLOUDINARY_API_KEY = "sample-key";
    process.env.CLOUDINARY_API_SECRET = "sample-secret";
    delete process.env.CLOUDINARY_URL;

    let receivedOptions;
    cloudinary.config = () => undefined;
    cloudinary.uploader.upload_chunked_stream = (options, callback) => {
      receivedOptions = options;
      return {
        end(buffer) {
          callback(undefined, {
            public_id: options.public_id,
            bytes: buffer.length,
          });
        },
      };
    };

    try {
      const result = await uploadPrivateRawBuffer(Buffer.from("backup"), "acgc/backups/test.zip");

      assert.equal(result.public_id, "acgc/backups/test.zip");
      assert.equal(receivedOptions.resource_type, "raw");
      assert.equal(receivedOptions.type, "authenticated");
      assert.equal(receivedOptions.overwrite, true);
      assert.equal(receivedOptions.unique_filename, false);
    } finally {
      cloudinary.uploader.upload_chunked_stream = originalChunkedStream;
      cloudinary.config = originalConfig;
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("uploads payment documents as private non-overwriting assets and signs temporary view URLs", async () => {
    const cloudinary = cloudinaryPackage.v2;
    const originalUploadStream = cloudinary.uploader.upload_stream;
    const originalPrivateDownloadUrl = cloudinary.utils.private_download_url;
    const originalConfig = cloudinary.config;
    const previousEnv = {
      CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
      CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
      CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
      CLOUDINARY_URL: process.env.CLOUDINARY_URL,
    };

    process.env.CLOUDINARY_CLOUD_NAME = "sample-cloud";
    process.env.CLOUDINARY_API_KEY = "sample-key";
    process.env.CLOUDINARY_API_SECRET = "sample-secret";
    delete process.env.CLOUDINARY_URL;

    let uploadOptions;
    let downloadOptions;
    cloudinary.config = () => undefined;
    cloudinary.uploader.upload_stream = (options, callback) => {
      uploadOptions = options;
      return {
        end(buffer) {
          callback(undefined, { public_id: options.public_id, bytes: buffer.length });
        },
      };
    };
    cloudinary.utils.private_download_url = (publicId, format, options) => {
      downloadOptions = { publicId, format, ...options };
      return "https://private.example/document";
    };

    try {
      const result = await uploadPrivatePaymentDocumentBuffer(Buffer.from("%PDF-1.7"), {
        publicId: "acgc/payment-proofs/admin/order/record/document.pdf",
        resourceType: "raw",
      });
      const downloadUrl = getPrivatePaymentDocumentDownloadUrl(result.public_id, "pdf", "raw");

      assert.equal(result.public_id, "acgc/payment-proofs/admin/order/record/document.pdf");
      assert.equal(uploadOptions.type, "authenticated");
      assert.equal(uploadOptions.resource_type, "raw");
      assert.equal(uploadOptions.overwrite, false);
      assert.equal(uploadOptions.unique_filename, false);
      assert.equal(downloadUrl, "https://private.example/document");
      assert.equal(downloadOptions.type, "authenticated");
      assert.equal(downloadOptions.resource_type, "raw");
      assert.equal(downloadOptions.attachment, false);
      assert.ok(downloadOptions.expires_at > Math.floor(Date.now() / 1000));
    } finally {
      cloudinary.uploader.upload_stream = originalUploadStream;
      cloudinary.utils.private_download_url = originalPrivateDownloadUrl;
      cloudinary.config = originalConfig;
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
