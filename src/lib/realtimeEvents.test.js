import { describe, expect, it, vi } from "vitest";
import { subscribeToRealtime } from "./realtimeEvents";

describe("subscribeToRealtime", () => {
  it("notifies only for subscribed areas or reconnect reconciliation", () => {
    const callback = vi.fn();
    const unsubscribe = subscribeToRealtime(["orders", "payments"], callback);

    window.dispatchEvent(new CustomEvent("acgc:realtime", { detail: { area: "products" } }));
    window.dispatchEvent(new CustomEvent("acgc:realtime", { detail: { area: "orders", orderId: "order-1" } }));
    window.dispatchEvent(new CustomEvent("acgc:realtime", { detail: { area: "all", action: "reconcile" } }));

    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback.mock.calls[0][0]).toMatchObject({ area: "orders", orderId: "order-1" });
    expect(callback.mock.calls[1][0]).toMatchObject({ area: "all", action: "reconcile" });

    unsubscribe();
    window.dispatchEvent(new CustomEvent("acgc:realtime", { detail: { area: "orders" } }));
    expect(callback).toHaveBeenCalledTimes(2);
  });
});