import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAdminOrder } from "../orders";
import { apiFetch } from "../client";

vi.mock("../client", () => ({
  apiFetch: vi.fn(),
}));

describe("getAdminOrder", () => {
  beforeEach(() => {
    apiFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("deduplicates overlapping detail lookups but fetches fresh data after completion", async () => {
    let resolveRequest;
    const firstResponse = new Promise((resolve) => {
      resolveRequest = resolve;
    });
    apiFetch.mockReturnValueOnce(firstResponse).mockResolvedValueOnce({ order: { _id: "order-1", status: "updated" } });

    const firstRequest = getAdminOrder("order-1", "profile");
    const overlappingRequest = getAdminOrder("order-1", "profile");
    expect(apiFetch).toHaveBeenCalledTimes(1);

    resolveRequest({ order: { _id: "order-1", status: "current" } });
    await expect(firstRequest).resolves.toEqual({ order: { _id: "order-1", status: "current" } });
    await expect(overlappingRequest).resolves.toEqual({ order: { _id: "order-1", status: "current" } });

    await expect(getAdminOrder("order-1", "profile")).resolves.toEqual({
      order: { _id: "order-1", status: "updated" },
    });
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });
});