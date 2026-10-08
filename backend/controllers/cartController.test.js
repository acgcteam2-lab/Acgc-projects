import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import Cart from "../models/Cart.js";
import Order from "../models/Order.js";
import { getCart, saveCart } from "./cartController.js";

const originalCartFindOne = Cart.findOne;
const originalCartFindOneAndUpdate = Cart.findOneAndUpdate;
const originalCartUpdateOne = Cart.updateOne;
const originalOrderFind = Order.find;

afterEach(() => {
  Cart.findOne = originalCartFindOne;
  Cart.findOneAndUpdate = originalCartFindOneAndUpdate;
  Cart.updateOne = originalCartUpdateOne;
  Order.find = originalOrderFind;
});

const mockPurchasedCartIds = (cartIds) => {
  Order.find = () => ({
    select() {
      return this;
    },
    lean: async () => [{ cart_item_ids: cartIds }],
  });
};

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(statusCode) {
    this.statusCode = statusCode;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

describe("cart persistence after checkout", () => {
  it("filters purchased IDs from stale cart saves and preserves other entries", async () => {
    mockPurchasedCartIds(["purchased-cart-id"]);
    Cart.findOneAndUpdate = (_filter, update) => ({
      lean: async () => ({ items: update.$set.items }),
    });
    const response = createResponse();

    await saveCart({
      user: { id: "customer-id" },
      body: {
        items: [
          { cartId: "purchased-cart-id", name: "Purchased window", quantity: 1 },
          { cartId: "unselected-cart-id", name: "Unselected door", quantity: 2, selected: false },
        ],
      },
    }, response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.items, [
      { cartId: "unselected-cart-id", name: "Unselected door", quantity: 2, selected: false },
    ]);
  });

  it("repairs purchased entries when reading an older persisted cart", async () => {
    mockPurchasedCartIds(["purchased-cart-id"]);
    Cart.findOne = () => ({
      lean: async () => ({
        items: [
          { cartId: "purchased-cart-id", name: "Purchased window", quantity: 1 },
          { cartId: "remaining-cart-id", name: "Remaining door", quantity: 1 },
        ],
      }),
    });
    let repairedItems;
    Cart.updateOne = async (_filter, update) => {
      repairedItems = update.$set.items;
    };
    const response = createResponse();

    await getCart({ user: { id: "customer-id" } }, response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.items, [
      { cartId: "remaining-cart-id", name: "Remaining door", quantity: 1 },
    ]);
    assert.deepEqual(repairedItems, response.body.items);
  });
});