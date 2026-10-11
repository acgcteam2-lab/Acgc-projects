import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../client";
import { getProducts, invalidateProductListCache, updateProduct } from "../products";

vi.mock("../client", () => ({ apiFetch: vi.fn() }));

beforeEach(() => {
  invalidateProductListCache();
  apiFetch.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("product list requests", () => {
  it("deduplicates concurrent list requests and reuses the fresh result", async () => {
    const response = { products: [{ _id: "p-1", name: "Window" }] };
    apiFetch.mockResolvedValue(response);

    const [firstResult, secondResult] = await Promise.all([getProducts(), getProducts()]);
    const cachedResult = await getProducts();

    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(firstResult).toBe(response);
    expect(secondResult).toBe(response);
    expect(cachedResult).toBe(response);
  });

  it("refreshes the list after its short cache lifetime", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    apiFetch.mockResolvedValue({ products: [] });

    await getProducts();
    vi.setSystemTime(11_001);
    await getProducts();

    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("invalidates cached listings after an admin product update", async () => {
    apiFetch
      .mockResolvedValueOnce({ products: [{ _id: "p-1", name: "Old name" }] })
      .mockResolvedValueOnce({ product: { _id: "p-1", name: "New name" } })
      .mockResolvedValueOnce({ products: [{ _id: "p-1", name: "New name" }] });

    await getProducts();
    await updateProduct("p-1", { name: "New name" });
    const refreshed = await getProducts();

    expect(refreshed.products[0].name).toBe("New name");
    expect(apiFetch).toHaveBeenCalledTimes(3);
  });
});
