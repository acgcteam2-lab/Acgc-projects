import assert from "node:assert/strict";
import { describe, it } from "node:test";
import mongoose from "mongoose";
import { buildRealtimeEvent, getStaffRealtimeModules, realtimeResponseMiddleware } from "./realtime.js";

describe("realtime event payloads", () => {
  it("identifies contract updates without exposing customer data", () => {
    const event = buildRealtimeEvent({
      method: "PUT",
      url: "/api/orders/order-1/contract",
      user: { id: "customer-1", role: "customer" },
    }, {
      order: {
        _id: "order-1",
        tracking: "TRK-1",
        status: "contract_accepted",
        customer: "customer-1",
        customer_email: "private@example.com",
      },
    }, "2026-10-11T00:00:00.000Z");

    assert.equal(event.type, "orders.put");
    assert.equal(event.area, "orders");
    assert.equal(event.orderId, "order-1");
    assert.equal(event.tracking, "TRK-1");
    assert.equal(event.status, "contract_accepted");
    assert.equal(event.targetCustomerId, "customer-1");
    assert.equal(event.timestamp, "2026-10-11T00:00:00.000Z");
    assert.equal(JSON.stringify(event).includes("private@example.com"), false);
  });

  it("routes product mutations to the product area without a customer target", () => {
    const event = buildRealtimeEvent({ method: "DELETE", url: "/api/products/p-1", user: { id: "admin-1", role: "admin" } }, { success: true });
    assert.equal(event.area, "products");
    assert.equal(event.recordId, "p-1");
    assert.equal(event.targetCustomerId, "");
  });

  it("normalizes BSON owner IDs for private room delivery", () => {
    const customerId = new mongoose.Types.ObjectId("507f1f77bcf86cd799439011");
    const event = buildRealtimeEvent({ method: "PUT", url: "/api/orders/order-1/payment-proof", user: { id: "admin-1", role: "admin" } }, {
      order: { _id: "order-1", customer: customerId },
    });
    assert.equal(event.targetCustomerId, "507f1f77bcf86cd799439011");
  });

  it("classifies settings and review changes for scoped page reconciliation", () => {
    const settingsEvent = buildRealtimeEvent({ method: "PATCH", url: "/api/auth/system-settings", user: { id: "admin-1", role: "admin" } }, { success: true });
    const reviewEvent = buildRealtimeEvent({ method: "PUT", url: "/api/orders/order-1/review", user: { id: "customer-1", role: "customer" } }, { success: true, order: { _id: "order-1", customer: "customer-1" } });

    assert.equal(settingsEvent.area, "settings");
    assert.equal(reviewEvent.area, "reviews");
    assert.deepEqual(reviewEvent.relatedAreas, ["orders"]);
    assert.equal(reviewEvent.targetCustomerId, "customer-1");
  });

  it("limits skilled-worker rooms to enabled modules with view permission", () => {
    const rooms = getStaffRealtimeModules("orders", {
      modules: {
        site_inspection: { enabled: true, actions: { view: true } },
        transactions: { enabled: true, actions: { view: false } },
        progress_monitoring: { enabled: false, actions: { view: true } },
      },
    });
    assert.deepEqual(rooms, ["site_inspection"]);
  });

  it("emits only after successful nonduplicate mutations", () => {
    const emissions = [];
    const io = { to: (room) => ({ emit: (name, payload) => emissions.push({ room, name, payload }) }) };
    const req = { method: "PUT", originalUrl: "/api/orders/order-1/contract", user: { id: "customer-1", role: "customer" } };
    const res = { statusCode: 200, json: (body) => body };
    realtimeResponseMiddleware(io)(req, res, () => {});

    res.json({ success: true, order: { _id: "order-1", customer: "customer-1", tracking: "TRK-1", status: "contract_accepted" } });
    assert.deepEqual(emissions.map((entry) => entry.room), ["admins", "user:customer-1", "order:order-1"]);
    assert.equal(emissions[0].payload.orderId, "order-1");

    emissions.length = 0;
    res.json({ success: true, duplicate: true, order: { _id: "order-1", customer: "customer-1" } });
    assert.equal(emissions.length, 0);

    res.statusCode = 400;
    res.json({ success: false });
    assert.equal(emissions.length, 0);

    emissions.length = 0;
    res.statusCode = 200;
    req.originalUrl = "/api/orders/order-1/review";
    res.json({ success: true, order: { _id: "order-1", customer: "customer-1", tracking: "TRK-1", status: "completed" } });
    const customerReviewEvent = emissions.find((entry) => entry.room === "customers")?.payload;
    const ownerReviewEvent = emissions.find((entry) => entry.room === "user:customer-1")?.payload;
    assert.ok(customerReviewEvent);
    assert.equal(customerReviewEvent.orderId, undefined);
    assert.equal(customerReviewEvent.tracking, undefined);
    assert.equal(ownerReviewEvent.orderId, "order-1");
  });
});