import { uploadFiles } from "../uploads";
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../client", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    apiFetch: vi.fn(async () => ({
      apiKey: "cloudinary-key",
      cloudName: "demo",
      folder: "acgc/uploads",
      publicId: "upload-id",
      resourceType: "auto",
      timestamp: 1234567890,
      type: "upload",
      signature: "signed-request",
    })),
  };
});

describe("uploadFiles", () => {
  const originalXHR = globalThis.XMLHttpRequest;

  afterEach(() => {
    globalThis.XMLHttpRequest = originalXHR;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("uploads files and reports progress with onProgress callback", async () => {
    const progressEvents = [];
    function FakeXHR() {
      this.upload = {};
      this.open = vi.fn();
      this.send = () => {
        setTimeout(() => {
          if (typeof this.upload.onprogress === "function") {
            this.upload.onprogress({ lengthComputable: true, loaded: 100, total: 100 });
          }
          this.status = 200;
          this.responseText = JSON.stringify({
            secure_url: "https://res.cloudinary.com/demo/image/upload/proof.png",
            public_id: "acgc/uploads/upload-id",
            resource_type: "image",
            format: "png",
          });
          if (typeof this.onload === "function") {
            this.onload();
          }
        }, 0);
      };
      this.onerror = null;
    }

    globalThis.XMLHttpRequest = FakeXHR;

    const file = new File(["filecontent"], "proof.png", { type: "image/png" });
    const result = await uploadFiles([file], (progress) => {
      progressEvents.push(progress);
    });

    expect(progressEvents).toContain(100);
    expect(result.files[0]).toEqual(expect.objectContaining({
      url: "https://res.cloudinary.com/demo/image/upload/proof.png",
      public_id: "acgc/uploads/upload-id",
      originalName: "proof.png",
    }));
  });

  it.each([false, true])("sends product photos to the Cloudinary endpoint (PROD=%s)", async (isProduction) => {
    vi.stubEnv("PROD", isProduction);
    let sentFormData;
    let requestUrl;

    function FakeXHR() {
      this.upload = {};
      this.open = vi.fn((_method, url) => { requestUrl = url; });
      this.setRequestHeader = vi.fn();
      this.send = (formData) => {
        sentFormData = formData;
        this.status = 201;
        this.responseText = JSON.stringify({
          success: true,
          files: [
            { key: "main", url: "https://res.cloudinary.com/demo/image/upload/main.jpg" },
            { key: "left", url: "https://res.cloudinary.com/demo/image/upload/left.jpg" },
          ],
        });
        this.onload();
      };
    }

    globalThis.XMLHttpRequest = FakeXHR;

    const mainImage = new File(["main image"], "main.jpg", { type: "image/jpeg" });
    const leftImage = new File(["left image"], "left.jpg", { type: "image/jpeg" });
    const result = await uploadFiles([mainImage, leftImage], undefined, {
      purpose: "product-images",
      fieldNames: ["main", "left"],
    });

    expect(requestUrl).toMatch(/\/api\/uploads\/product-images$/);
    expect(sentFormData.get("main").name).toBe(mainImage.name);
    expect(sentFormData.get("left").name).toBe(leftImage.name);
    expect(result.files.map(({ key }) => key)).toEqual(["main", "left"]);
    expect(result.files.every(({ url }) => url.includes("res.cloudinary.com"))).toBe(true);
  });

  it("uploads payment proofs through the authenticated backend Cloudinary endpoint", async () => {
    let sentFormData;
    let requestUrl;

    function FakeXHR() {
      this.upload = {};
      this.open = vi.fn((_method, url) => { requestUrl = url; });
      this.setRequestHeader = vi.fn();
      this.send = (formData) => {
        sentFormData = formData;
        this.status = 201;
        this.responseText = JSON.stringify({
          success: true,
          files: [{ key: "file", url: "https://res.cloudinary.com/demo/image/upload/proof.jpg", originalName: "proof.jpg" }],
        });
        this.onload();
      };
    }

    globalThis.XMLHttpRequest = FakeXHR;

    const proof = new File(["payment proof"], "proof.jpg", { type: "image/jpeg" });
    const result = await uploadFiles([proof], undefined, { purpose: "payment-proofs" });

    expect(requestUrl).toMatch(/\/api\/uploads\/payment-proofs$/);
    expect(sentFormData.get("file").name).toBe(proof.name);
    expect(result.files[0].url).toContain("res.cloudinary.com");
  });

  it("rejects product photo uploads larger than 4 MB before sending", async () => {
    vi.stubEnv("PROD", false);
    const oversizedImage = new File([new Uint8Array(4 * 1024 * 1024 + 1)], "large.jpg", { type: "image/jpeg" });

    await expect(uploadFiles([oversizedImage], undefined, { purpose: "product-images" }))
      .rejects.toThrow("Product photos must total 4 MB or less per upload.");
  });

});
