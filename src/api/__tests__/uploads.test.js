import { uploadFiles } from "../uploads";
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@vercel/blob/client", () => ({ upload: vi.fn() }));
import { upload } from "@vercel/blob/client";

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

  it("sends product photos to the backend with their image slot names", async () => {
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
  });

  it("stores production product photos in Blob and preserves their image slots", async () => {
    vi.stubEnv("PROD", true);
    vi.mocked(upload).mockResolvedValue({
      url: "https://blob.example/products/main.jpg",
      pathname: "product-images/main.jpg",
    });
    const openRequest = vi.fn();
    globalThis.XMLHttpRequest = function FakeXHR() {
      this.open = openRequest;
    };

    const mainImage = new File(["main image"], "main.jpg", { type: "image/jpeg" });
    const result = await uploadFiles([mainImage], undefined, {
      purpose: "product-images",
      fieldNames: ["main"],
    });

    expect(openRequest).not.toHaveBeenCalled();
    expect(upload).toHaveBeenCalledWith(
      "product-images/main.jpg",
      mainImage,
      expect.objectContaining({
        access: "public",
        handleUploadUrl: "/api/uploads/token",
        clientPayload: expect.stringContaining('"purpose":"product-images"'),
      }),
    );
    expect(result.files).toEqual([
      expect.objectContaining({ key: "main", url: "https://blob.example/products/main.jpg" }),
    ]);
  });
});
