import { uploadFiles } from "../uploads";
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@vercel/blob/client", () => ({
  upload: vi.fn(async (pathname) => ({
    url: `https://blob.vercel-storage.com/${pathname}`,
    pathname,
  })),
}));

describe("uploadFiles", () => {
  const originalXHR = globalThis.XMLHttpRequest;

  afterEach(() => {
    globalThis.XMLHttpRequest = originalXHR;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("uploads files and reports progress with onProgress callback", async () => {
    const progressEvents = [];
    const fakeResponse = { files: [{ url: "http://example.com/proof.png" }] };

    function FakeXHR() {
      this.upload = {};
      this.open = vi.fn();
      this.setRequestHeader = vi.fn();
      this.send = () => {
        setTimeout(() => {
          if (typeof this.upload.onprogress === "function") {
            this.upload.onprogress({ lengthComputable: true, loaded: 100, total: 100 });
          }
          this.status = 200;
          this.responseText = JSON.stringify(fakeResponse);
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
    expect(result).toEqual(fakeResponse);
  });

  it("sends product photos to the backend image endpoint in development", async () => {
    vi.stubEnv("PROD", false);
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
      useBlobUploads: false,
    });

    expect(requestUrl).toMatch(/\/api\/uploads\/product-images$/);
    expect(sentFormData.get("main").name).toBe(mainImage.name);
    expect(sentFormData.get("left").name).toBe(leftImage.name);
    expect(result.files.map(({ key }) => key)).toEqual(["main", "left"]);
  });

  it("uploads product photos to Blob in production", async () => {
    vi.stubEnv("PROD", true);
    const { upload } = await import("@vercel/blob/client");

    const mainImage = new File(["main image"], "main.jpg", { type: "image/jpeg" });
    const leftImage = new File(["left image"], "left.jpg", { type: "image/jpeg" });
    const result = await uploadFiles([mainImage, leftImage], undefined, {
      purpose: "product-images",
      fieldNames: ["main", "left"],
      useBlobUploads: true,
    });

    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload).toHaveBeenNthCalledWith(
      1,
      "product-images/main.jpg",
      mainImage,
      expect.objectContaining({
        access: "public",
        handleUploadUrl: expect.stringMatching(/\/api\/uploads\/token$/),
      }),
    );
    expect(result.files).toEqual([
      expect.objectContaining({ key: "main", url: "https://blob.vercel-storage.com/product-images/main.jpg" }),
      expect.objectContaining({ key: "left", url: "https://blob.vercel-storage.com/product-images/left.jpg" }),
    ]);
  });

});
