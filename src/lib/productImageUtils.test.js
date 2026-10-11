import { describe, expect, it } from "vitest";
import {
  PRODUCT_IMAGE_PLACEHOLDER,
  getProductImageSource,
  getOptimizedProductImageUrl,
  getProductImageSrcSet,
} from "@/lib/productImageUtils";

describe("product image utilities", () => {
  it("requests automatic format, compression, and bounded image dimensions from Cloudinary", () => {
    const optimized = new URL(getOptimizedProductImageUrl(
      "https://res.cloudinary.com/acgc/image/upload/products/window.jpg",
      480,
    ));

    expect(optimized.pathname).toContain("/image/upload/f_auto,q_auto,w_480,c_limit/products/window.jpg");
  });

  it("leaves non-Cloudinary image URLs unchanged", () => {
    const localImage = "https://api.example.com/uploads/window.jpg";

    expect(getOptimizedProductImageUrl(localImage, 320)).toBe(localImage);
    expect(getProductImageSrcSet(localImage)).toBeUndefined();
  });

  it("finds product images stored as nested URL objects", () => {
    expect(getProductImageSource({ images: { main: [{ url: " https://cdn.example.com/window.jpg " }] } }))
      .toBe("https://cdn.example.com/window.jpg");
  });

  it("provides responsive variants for Cloudinary and a fallback image", () => {
    const srcSet = getProductImageSrcSet("https://res.cloudinary.com/acgc/image/upload/window.jpg");

    expect(srcSet).toContain("w_320,c_limit/window.jpg 320w");
    expect(srcSet).toContain("w_960,c_limit/window.jpg 960w");
    expect(PRODUCT_IMAGE_PLACEHOLDER).toContain("data:image/svg+xml");
  });
});
