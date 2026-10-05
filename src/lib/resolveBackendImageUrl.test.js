import { describe, expect, it } from "vitest";
import { resolveBackendImageUrl } from "./resolveBackendImageUrl";

describe("resolveBackendImageUrl", () => {
  it("rewrites legacy loopback upload links to the configured HTTPS backend", () => {
    expect(resolveBackendImageUrl(
      "http://127.0.0.1:5000/uploads/photo.jpg?version=2",
      "https://acgc-backend.vercel.app/api"
    )).toBe("https://acgc-backend.vercel.app/uploads/photo.jpg?version=2");
  });

  it("preserves Cloudinary URLs", () => {
    const cloudinaryUrl = "https://res.cloudinary.com/example/image/upload/photo.jpg";
    expect(resolveBackendImageUrl(cloudinaryUrl, "https://acgc-backend.vercel.app/api")).toBe(cloudinaryUrl);
  });

  it("preserves loopback URLs for local development", () => {
    const localUrl = "http://127.0.0.1:5000/uploads/photo.jpg";
    expect(resolveBackendImageUrl(localUrl, "/api")).toBe(localUrl);
  });
});