import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPendingProductAction,
  consumePendingProductRedirect,
  getPendingProductAction,
  preservePendingProductRedirect,
  savePendingProductAction,
} from "@/lib/pendingProductAction";

const customerDestination = {
  pathname: "/customer-dashboard",
  search: "?resumeLandingProduct=1",
};

beforeEach(() => {
  localStorage.clear();
});

describe("pending product actions", () => {
  it("persists the selected action and its measurements", () => {
    const action = savePendingProductAction({
      actionType: "estimate",
      productId: "product-1",
      selection: { width: "42", height: "36", unit: "cm", quantity: 2 },
    });

    expect(getPendingProductAction()).toMatchObject({
      id: action.id,
      actionType: "estimate",
      productId: "product-1",
      selection: { width: "42", height: "36", unit: "cm", quantity: 2 },
    });
  });

  it("preserves a one-time redirect only for a matching pending action", () => {
    savePendingProductAction({ actionType: "direct", productId: "product-1", selection: {} });

    expect(preservePendingProductRedirect(customerDestination)).toBe(true);
    expect(consumePendingProductRedirect()).toEqual(customerDestination);
    expect(consumePendingProductRedirect()).toBeNull();
  });

  it("rejects a redirect after the pending action has been replaced", () => {
    savePendingProductAction({ actionType: "direct", productId: "product-1", selection: {} });
    preservePendingProductRedirect(customerDestination);
    savePendingProductAction({ actionType: "estimate", productId: "product-2", selection: {} });

    expect(consumePendingProductRedirect()).toBeNull();
    expect(getPendingProductAction().productId).toBe("product-2");
  });

  it("clears only the action whose id is supplied", () => {
    const first = savePendingProductAction({ actionType: "direct", productId: "product-1", selection: {} });
    const second = savePendingProductAction({ actionType: "direct", productId: "product-2", selection: {} });

    clearPendingProductAction(first.id);

    expect(getPendingProductAction().id).toBe(second.id);
  });
});