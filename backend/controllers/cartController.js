import Cart from "../models/Cart.js";
import Order from "../models/Order.js";

const normalizeCartItems = (items) => {
  if (!Array.isArray(items)) return null;

  return items.map((item) => ({
    ...item,
    cartId: String(item.cartId || item._id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    quantity: Math.max(1, Number(item.quantity) || 1),
    selected: item.selected !== false,
  }));
};

const excludePurchasedItems = async (customerId, items) => {
  const cartIds = [...new Set(items.map((item) => String(item.cartId || "")).filter(Boolean))];
  if (cartIds.length === 0) return items;

  const orders = await Order.find({ customer: customerId, cart_item_ids: { $in: cartIds } })
    .select("cart_item_ids")
    .lean();
  const purchasedCartIds = new Set(orders.flatMap((order) => order.cart_item_ids || []).map(String));

  return items.filter((item) => !purchasedCartIds.has(String(item.cartId)));
};

export const getCart = async (req, res) => {
  try {
    const cart = await Cart.findOne({ customer: req.user.id }).lean();
    const storedItems = cart?.items || [];
    const items = await excludePurchasedItems(req.user.id, storedItems);
    if (items.length !== storedItems.length) {
      await Cart.updateOne({ customer: req.user.id }, { $set: { items } });
    }
    return res.json({ success: true, items });
  } catch (error) {
    console.error("Get cart error:", error);
    return res.status(500).json({ success: false, message: "Unable to load cart." });
  }
};

export const saveCart = async (req, res) => {
  try {
    const normalizedItems = normalizeCartItems(req.body?.items);
    if (!normalizedItems) {
      return res.status(400).json({ success: false, message: "Cart items must be an array." });
    }
    const items = await excludePurchasedItems(req.user.id, normalizedItems);

    const cart = await Cart.findOneAndUpdate(
      { customer: req.user.id },
      { $set: { items } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();

    return res.json({ success: true, items: cart.items });
  } catch (error) {
    console.error("Save cart error:", error);
    return res.status(500).json({ success: false, message: "Unable to save cart." });
  }
};