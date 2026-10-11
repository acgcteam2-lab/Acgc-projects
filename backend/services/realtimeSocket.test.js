import assert from "node:assert/strict";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import jwt from "jsonwebtoken";
import { io as connectSocket } from "socket.io-client";
import Admin from "../models/Admin.js";
import Order from "../models/Order.js";
import User from "../models/User.js";
import { createRealtimeServer } from "./realtime.js";

describe("authenticated realtime sockets", () => {
  it("rejects anonymous clients and confines customers to their own rooms", async () => {
    const previousSecret = process.env.JWT_SECRET;
    const originalFindUser = User.findById;
    const originalFindOrders = Order.find;
    const httpServer = createServer();
    const realtimeServer = createRealtimeServer(httpServer);
    let customerSocket;
    let anonymousSocket;

    process.env.JWT_SECRET = "realtime-test-secret";
    User.findById = () => ({
      select: () => ({ lean: async () => ({ _id: "customer-1", role: "customer", session_version: 2 }) }),
    });
    Order.find = () => ({
      select() { return this; },
      sort() { return this; },
      limit() { return this; },
      lean: async () => [{ _id: "order-1" }],
    });

    try {
      await new Promise((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(0, "127.0.0.1", resolve);
      });
      const address = httpServer.address();
      const serverUrl = `http://127.0.0.1:${address.port}`;
      const token = jwt.sign({
        id: "customer-1",
        role: "customer",
        auth_source: "user",
        session_version: 2,
      }, process.env.JWT_SECRET, { expiresIn: "1m" });

      customerSocket = connectSocket(serverUrl, { auth: { token }, transports: ["polling"], reconnection: false });
      const readyPromise = new Promise((resolve) => customerSocket.once("realtime:ready", resolve));
      await new Promise((resolve, reject) => {
        customerSocket.once("connect", resolve);
        customerSocket.once("connect_error", reject);
      });
      await readyPromise;

      anonymousSocket = connectSocket(serverUrl, { transports: ["polling"], reconnection: false });
      const authError = await new Promise((resolve) => anonymousSocket.once("connect_error", resolve));
      assert.match(authError.message, /Authentication required/);

      const orderEvent = new Promise((resolve) => customerSocket.once("private-order-event", resolve));
      realtimeServer.to("order:order-1").emit("private-order-event", { orderId: "order-1" });
      assert.deepEqual(await orderEvent, { orderId: "order-1" });

      let receivedAdminEvent = false;
      customerSocket.on("admin-only-event", () => { receivedAdminEvent = true; });
      realtimeServer.to("admins").emit("admin-only-event", { status: "private" });
      await new Promise((resolve) => setTimeout(resolve, 25));
      assert.equal(receivedAdminEvent, false);
    } finally {
      customerSocket?.disconnect();
      anonymousSocket?.disconnect();
      await new Promise((resolve) => realtimeServer.close(resolve));
      User.findById = originalFindUser;
      Order.find = originalFindOrders;
      if (previousSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousSecret;
    }
  });
});