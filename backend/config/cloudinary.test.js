import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getCloudinaryConfig } from "./cloudinary.js";

describe("getCloudinaryConfig", () => {
  it("parses the Cloudinary dashboard URL and prefers it over split variables", () => {
    assert.deepEqual(
      getCloudinaryConfig({
        CLOUDINARY_URL: "cloudinary://url-key:url-secret@sample-cloud",
        CLOUDINARY_CLOUD_NAME: "stale-cloud",
        CLOUDINARY_API_KEY: "stale-key",
        CLOUDINARY_API_SECRET: "stale-secret",
      }),
      {
        cloud_name: "sample-cloud",
        api_key: "url-key",
        api_secret: "url-secret",
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

  it("rejects malformed dashboard URLs without falling back to stale variables", () => {
    assert.throws(
      () => getCloudinaryConfig({
        CLOUDINARY_URL: "https://invalid.example",
        CLOUDINARY_CLOUD_NAME: "sample-cloud",
        CLOUDINARY_API_KEY: "sample-key",
        CLOUDINARY_API_SECRET: "sample-secret",
      }),
      { message: /CLOUDINARY_URL must match/ },
    );
  });
});