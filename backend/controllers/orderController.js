import process from "node:process";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import Order from "../models/Order.js";
import Product from "../models/Product.js";
import User from "../models/User.js";
import Cart from "../models/Cart.js";
import { sendMail } from "../config/mailer.js";
import { formatOrderEmailDate, sendOrderNotification } from "../services/orderEmails.js";
import { applyInstallationWarranty, isCompletedInstallationStage } from "../services/warranty.js";
import { buildProductPriceSnapshot, getMeasuredProductLineTotal } from "../../src/lib/productPricing.js";
import { calculateRequiredDownpayment, getFinalProjectCost, getRequiredDownpayment } from "../../src/lib/orderPricing.js";
import { getInstallationDateError } from "../../src/lib/installationSchedule.js";

const isWithinReviewEditWindow = (submittedAt) => {
  if (!submittedAt) return false;
  const reviewDate = new Date(submittedAt);
  const editDeadline = new Date(reviewDate.getTime() + 7 * 24 * 60 * 60 * 1000);
  return new Date() <= editDeadline;
};

const buildReviewNotificationMessage = (order, review, productName = order.items?.[0]?.name || "project") => {
  return `New customer review received for ${productName} (${order.tracking}).\nOrder ID: ${order.tracking || order._id}\nRating: ${"⭐".repeat(review.rating || 0)}\nTitle: ${review.title || "-"}\nComment: ${review.comment || "-"}`;
};

const getDelayEventKey = (stage, entry, index) => [
  stage.key || stage.name || index,
  entry.reportedAt ? new Date(entry.reportedAt).getTime() : "",
  entry.reason || "",
].join("|");

const normalizeAddress = (value) => {
  if (!value) return "";
  const cleaned = value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[,;]+/g, ",")
    .replace(/\s*[.,]\s*/g, ", ")
    .replace(/\s*,\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const canonical = (text) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\b(city|province|zip|code|street|st|road|rd)\b/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const parts = cleaned
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const normalizedParts = [];
  const seen = [];

  for (const part of parts) {
    const key = canonical(part);
    if (!key) {
      normalizedParts.push(part);
      continue;
    }
    const isDuplicate = seen.some(
      (existing) => existing === key || existing.includes(key) || key.includes(existing)
    );
    if (!isDuplicate) {
      seen.push(key);
      normalizedParts.push(part);
    }
  }

  return normalizedParts.join(", ");
};

const buildAddressFromUser = (user) => {
  if (!user) return "";
  return normalizeAddress(
    [user.street_address, user.city, user.province, user.zip_code].filter(Boolean).join(", ")
  );
};

const getLocalUploadedAttachment = (fileUrl) => {
  if (!fileUrl || typeof fileUrl !== "string") return null;
  try {
    const url = new URL(fileUrl, "http://localhost");
    const pathname = url.pathname || "";
    if (!pathname.startsWith("/uploads/")) return null;
    const filename = pathname.replace(/^\/uploads\//, "");
    if (!filename) return null;
    const filepath = path.join(process.cwd(), "uploads", filename);
    if (!fs.existsSync(filepath)) return null;
    return {
      filename,
      path: filepath,
    };
  } catch (err) {
    return null;
  }
};

const getDataUrlAttachment = (dataUrl, filename) => {
  if (typeof dataUrl !== "string") return null;
  const match = dataUrl.match(/^data:(application\/pdf|image\/png|image\/jpeg)(?:;filename=[^;]+)?;base64,(.+)$/s);
  if (!match) return null;
  return {
    filename,
    content: Buffer.from(match[2], "base64"),
    contentType: match[1],
  };
};

const normalizeProductId = (productId) => {
  if (!productId) return null;
  if (typeof productId === "object") {
    return String(productId._id || productId.id || productId);
  }
  return String(productId);
};

const getOrderItemPricingMethod = (product = {}, item = {}) => {
  const method = String(product.pricing_method || item.pricing_method || "").toLowerCase();
  if (method) return method;
  const unit = String(product.unit || item.unit || "").toLowerCase();
  if (unit === "per_blade") return "blade";
  if (unit === "per_sqft") return "sqft";
  return unit;
};

const hasValidDimensions = (item) =>
  Number(item.dimensions?.width) > 0 &&
  Number(item.dimensions?.height) > 0 &&
  Number(item.dimensions?.quantity) > 0 &&
  Boolean(item.dimensions?.unit);

const requiresOrderItemDimensions = (product = {}, item = {}) => {
  const pricingMethod = getOrderItemPricingMethod(product, item);
  const isBladeProduct = pricingMethod === "blade" || pricingMethod === "per_blade";
  return !isBladeProduct || (item.sale_mode === "frame" && Boolean(item.custom_frame_size));
};

const hasValidOrderItemPricingInput = (product = {}, item = {}) => {
  const pricingMethod = getOrderItemPricingMethod(product, item);
  const isBladeProduct = pricingMethod === "blade" || pricingMethod === "per_blade";
  if (!isBladeProduct) return hasValidDimensions(item);
  if (requiresOrderItemDimensions(product, item) && !hasValidDimensions(item)) return false;
  return Number(item.dimensions?.quantity) > 0 && Number(item.blade_count) > 0;
};

const sanitizeOrderItems = (items = []) => {
  return (items || []).map((item) => {
    const incomingDimensions = item.dimensions || {};
    const quantity = Number(item.quantity ?? incomingDimensions.quantity) || 1;
    const width = Number(incomingDimensions.width ?? item.width) || 0;
    const height = Number(incomingDimensions.height ?? item.height) || 0;
    const measurement_unit = incomingDimensions.unit || item.measurement_unit || item.measurementUnit || "in";
    const area = Number(item.area) || 0;
    const productUnitPrice = Number(item.product_id?.unit_price ?? item.product?.unit_price ?? item.base_price ?? item.price ?? item.unit_price ?? 0) || 0;
    const productRatePerSqft = Number(item.product_id?.price_per_sqft ?? item.product?.price_per_sqft ?? item.price_per_sqft ?? 0) || 0;
    const unit_price = Number(item.unit_price) || productUnitPrice || (productRatePerSqft > 0 && area > 0 ? productRatePerSqft * area : 0);
    const estimated_price = item.is_estimate
      ? Number(item.estimated_price) || Number(item.manual_estimated_total) || area * (productRatePerSqft || unit_price || 0)
      : 0;
    const estimation_mode = item.estimation_mode === "manual" ? "manual" : "auto";
    const manual_estimated_total = Number(item.manual_estimated_total) || 0;
    const customized = Boolean(incomingDimensions.customized ?? item.customized ?? item.is_estimate);

    return {
      product_id: normalizeProductId(item.product_id) || normalizeProductId(item._id) || null,
      name: item.name,
      quantity,
      unit_price,
      pricing_method: item.pricing_method || "",
      price_per_sqft: Number(item.price_per_sqft) || 0,
      price_per_blade: Number(item.price_per_blade) || 0,
      blade_glass_type: item.blade_glass_type || "",
      sale_mode: item.sale_mode || "",
      frame_type: item.frame_type || "",
      frame_price: Number(item.frame_price) || 0,
      custom_frame_size: Boolean(item.custom_frame_size),
      blade_glass_types: Array.isArray(item.blade_glass_types) ? item.blade_glass_types : [],
      sell_blades_only: item.sell_blades_only !== false,
      sell_with_frame: Boolean(item.sell_with_frame),
      blade_frame_types: Array.isArray(item.blade_frame_types) ? item.blade_frame_types : [],
      allow_custom_frame_size: Boolean(item.allow_custom_frame_size),
      custom_frame_size_unit: item.custom_frame_size_unit || item.measurement_unit || measurement_unit,
      minimum_blades: Math.max(1, Number(item.minimum_blades) || 1),
      maximum_blades: Number(item.maximum_blades) || 0,
      customer_can_choose_blade_count: Boolean(item.customer_can_choose_blade_count),
      default_blade_glass_type: item.default_blade_glass_type || "",
      default_sale_mode: item.default_sale_mode || "",
      default_frame_type: item.default_frame_type || "",
      show_price_per_blade: item.show_price_per_blade !== false,
      base_price: Number(item.base_price) || 0,
      blade_count: Number(item.blade_count) || 0,
      estimated_price_override: Number(item.estimated_price_override) || 0,
      customization: Boolean(item.customization),
      customization_fee: Number(item.customization_fee) || 0,
      extra_charges: Array.isArray(item.extra_charges) ? item.extra_charges : [],
      size_limits: item.size_limits || {},
      line_total: Number(item.line_total) || 0,
      unit: item.unit || "piece",
      category: item.category || "",
      product_type: item.product_type || "",
      measurement_unit,
      width,
      height,
      dimensions: {
        width,
        height,
        unit: measurement_unit,
        quantity,
        customized,
      },
      area,
      estimated_price,
      estimation_mode,
      manual_estimated_total,
      notes: item.notes || "",
      warranty_period: item.warranty_period !== undefined ? String(item.warranty_period) : "",
      custom_warranty_days: Number(item.custom_warranty_days) > 0 ? Number(item.custom_warranty_days) : null,
      warranty_start_date: item.warranty_start_date ? new Date(item.warranty_start_date) : null,
      warranty_expiry_date: item.warranty_expiry_date ? new Date(item.warranty_expiry_date) : null,
      warranty_status: item.warranty_status || "",
      customized,
      is_estimate: Boolean(item.is_estimate),
    };
  });
};

const getItemAmountValue = (item) => {
  if (!item) return 0;

  if (Number(item.line_total) > 0) {
    return Number(item.line_total);
  }

  if (item.is_estimate && Number(item.estimated_price || item.manual_estimated_total || 0) > 0) {
    return Number(item.estimated_price || item.manual_estimated_total || 0);
  }

  const quantity = Number(item.quantity || 1) || 1;
  const unitPrice = Number(item.unit_price || 0) || 0;
  const area = Number(item.area || 0) || 0;
  const productRate = Number(item.price_per_sqft || item.product?.price_per_sqft || 0) || 0;

  if (productRate > 0 && area > 0) {
    return productRate * area;
  }

  return unitPrice > 0 ? unitPrice * quantity : 0;
};

const repriceInspectionItems = async (items) => {
  const sanitizedItems = sanitizeOrderItems(items);
  const productIds = [...new Set(sanitizedItems.map((item) => item.product_id).filter(Boolean))];
  const products = productIds.length
    ? await Product.find({ _id: { $in: productIds } })
        .select("pricing_method unit unit_price base_price price_per_sqft price_per_blade blade_count blade_glass_types sell_blades_only sell_with_frame blade_frame_types allow_custom_frame_size custom_frame_price minimum_blades maximum_blades customer_can_choose_blade_count default_blade_glass_type default_sale_mode default_frame_type show_price_per_blade customization customization_fee extra_charges size_limits estimated_price estimated_price_override width height measurement_unit")
        .lean()
    : [];
  const productsById = new Map(products.map((product) => [String(product._id), product]));

  return sanitizedItems.map((item) => {
    const product = productsById.get(String(item.product_id));
    if (!product) return { ...item, line_total: getItemAmountValue(item) };

    const priceSnapshot = buildProductPriceSnapshot(product, item);
    const itemOverride = item.estimation_mode === "manual"
      ? Number(item.manual_estimated_total) || 0
      : 0;
    const lineTotal = itemOverride > 0
      ? itemOverride
      : getMeasuredProductLineTotal(product, item);

    return {
      ...item,
      ...priceSnapshot,
      estimated_price: lineTotal,
      line_total: lineTotal,
    };
  });
};

const generateTrackingNumber = () => {
  return `TRK-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
};

const getOrderPaymentAmounts = (order) => {
  const totalAmount = getFinalProjectCost(order);
  const requiredAmount = getRequiredDownpayment(order);

  let paidAmount = Number(order.amount_paid);
  if (order.amount_paid === undefined || order.amount_paid === null || !Number.isFinite(paidAmount)) {
    if (order.payment_proof_confirmed_at) {
      paidAmount = Number(order.payment_proof_amount) || 0;
    } else if (order.payment_status === "paid" && !order.payment_proof_submitted_at) {
      paidAmount = totalAmount;
    } else if (order.downpayment_received) {
      paidAmount = requiredAmount;
    } else {
      paidAmount = 0;
    }
  }

  paidAmount = Math.min(Math.max(paidAmount, 0), totalAmount);
  return { totalAmount, requiredAmount, paidAmount };
};

const getOrderPaymentStatus = (order) => {
  const { totalAmount, requiredAmount, paidAmount } = getOrderPaymentAmounts(order);
  const paidCents = Math.round(paidAmount * 100);
  const requiredCents = Math.round(requiredAmount * 100);
  const totalCents = Math.round(totalAmount * 100);
  if (totalCents > 0 && paidCents >= totalCents) return "paid";
  if (paidAmount <= 0) return "pending";
  if (order.payment_terms === "full_payment") return "partial";
  if (paidCents < requiredCents) return "partial_downpayment";
  if (paidCents === requiredCents) return "downpayment";
  return "partial";
};

const getInstallationPlan = (order) => {
  const stages = Array.isArray(order?.progress_stages) ? order.progress_stages : [];
  const stage = stages.find((entry) => {
    const key = `${entry.key || ""} ${entry.name || ""}`.toLowerCase();
    return key.includes("installation") && (entry.proposedInstallationDate || entry.proposedInstallationTime);
  });
  return {
    date: stage?.proposedInstallationDate || order?.estimated_installation_date || order?.inspection_date || null,
    time: stage?.proposedInstallationTime || "",
    status: stage?.status || (stage?.customerResponse === "accepted" ? "Confirmed" : "Scheduled"),
  };
};


const getWarrantyEmailLines = (order) => {
  const items = Array.isArray(order?.items) ? order.items : [];
  const assignedItems = items.filter((item) => item.warranty_start_date || item.warranty_expiry_date || item.warranty_status);
  const formatWarranty = (item, name) => {
    const start = item.warranty_start_date || order.warranty_start_date;
    const end = item.warranty_expiry_date || order.warranty_expiry_date;
    const period = item.warranty_period || order.warranty_period || "Warranty coverage";
    const status = String(item.warranty_status || order.warranty_status || "Active").replace(/_/g, " ");
    const remainingDays = end ? Math.max(Math.ceil((new Date(end).getTime() - Date.now()) / 86400000), 0) : null;
    const remaining = remainingDays === null || status === "expired" ? "" : `; ${remainingDays} day${remainingDays === 1 ? "" : "s"} remaining`;
    return `${name}: ${period}; starts ${formatOrderEmailDate(start) || "not specified"}; ends ${formatOrderEmailDate(end) || "not specified"}; status ${status}${remaining}`;
  };
  if (assignedItems.length > 0) {
    return assignedItems.map((item, index) => formatWarranty(item, item.name || `Product ${index + 1}`));
  }
  if (order?.warranty_start_date || order?.warranty_expiry_date || order?.warranty_status) {
    return [formatWarranty(order, "Order coverage")];
  }
  return [];
};

export const listOrders = async (req, res) => {
  try {
    const filter = {};

    if (req.user.role !== "admin") {
      filter.customer = req.user.id;
    }

    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .populate("customer", "first_name last_name email phone street_address city province zip_code")
      .populate("items.product_id", "image_url image images name product_name category product_type unit pricing_method unit_price base_price price_per_sqft price_per_blade blade_count estimated_price estimated_price_override width height measurement_unit standard_size");

    res.json({ success: true, orders });
  } catch (error) {
    console.error("List orders error:", error);
    res.status(500).json({ success: false, message: "Unable to list orders", error: error.message });
  }
};

export const createOrder = async (req, res) => {
  try {
    const { items, shipping_address, customer_phone, order_type } = req.body;
    const requestedCartItemIds = Array.isArray(req.body.cart_item_ids)
      ? [...new Set(req.body.cart_item_ids.map((cartId) => String(cartId || "").trim()).filter(Boolean))]
      : [];

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: "Order items are required" });
    }

    if (requestedCartItemIds.length > 0) {
      const cart = await Cart.findOne({ customer: req.user.id }).select("items.cartId").lean();
      const availableCartIds = new Set((cart?.items || []).map((item) => String(item.cartId)));
      if (requestedCartItemIds.some((cartId) => !availableCartIds.has(cartId))) {
        return res.status(409).json({ success: false, message: "Your cart changed. Refresh it and try checkout again." });
      }
    }

    const sanitizedItems = sanitizeOrderItems(items);
    const productIds = [...new Set(sanitizedItems.map((item) => item.product_id).filter(Boolean))];
    if (
      productIds.length !== sanitizedItems.length ||
      productIds.some((productId) => !mongoose.Types.ObjectId.isValid(productId))
    ) {
      return res.status(400).json({ success: false, message: "Each order item must reference a valid product." });
    }

    const products = productIds.length
      ? await Product.find({ _id: { $in: productIds } })
          .select("pricing_method unit unit_price base_price price_per_sqft price_per_blade blade_count blade_glass_types sell_blades_only sell_with_frame blade_frame_types allow_custom_frame_size custom_frame_price minimum_blades maximum_blades customer_can_choose_blade_count default_blade_glass_type default_sale_mode default_frame_type show_price_per_blade customization customization_fee extra_charges estimated_price estimated_price_override width height measurement_unit")
          .lean()
      : [];
    const productsById = new Map(products.map((product) => [String(product._id), product]));
    if (productsById.size !== productIds.length) {
      return res.status(400).json({ success: false, message: "One or more selected products are no longer available." });
    }
    const hasInvalidPricingInput = sanitizedItems.some((item) => {
      const product = productsById.get(String(item.product_id));
      return !hasValidOrderItemPricingInput(product, item);
    });

    if (hasInvalidPricingInput) {
      return res.status(400).json({
        success: false,
        message: "Please provide valid product dimensions before submitting your order.",
      });
    }

    const pricedItems = sanitizedItems.map((item) => {
      const product = productsById.get(String(item.product_id));
      return { ...item, ...buildProductPriceSnapshot(product, item) };
    });

    const total_amount = pricedItems.reduce((sum, item) => sum + getItemAmountValue(item), 0);
    const requiredDownpayment = calculateRequiredDownpayment(total_amount, "50%_down_payment");

    const order = new Order({
      customer: req.user.id,
      cart_item_ids: requestedCartItemIds,
      customer_name: [req.user.first_name, req.user.last_name].filter(Boolean).join(" "),
      customer_email: req.user.email || "",
      customer_phone: String(customer_phone || req.user.phone || "").trim(),
      items: pricedItems,
      total_amount,
      estimated_cost: total_amount,
      final_project_cost: total_amount,
      payment_terms: "50%_down_payment",
      downpayment_amount: requiredDownpayment,
      required_downpayment_amount: requiredDownpayment,
      amount_paid: 0,
      shipping_address: normalizeAddress(shipping_address || buildAddressFromUser(req.user)),
      tracking: generateTrackingNumber(),
      order_type: order_type === "walk_in_customer" ? "walk_in_customer" : "online_order",
      contract_status: "pending",
      payment_status: "pending",
      status: "site_inspection",
    });

    await order.save();

    let cartCleanupPending = false;
    if (requestedCartItemIds.length > 0) {
      try {
        await Cart.updateOne(
          { customer: req.user.id },
          { $pull: { items: { cartId: { $in: requestedCartItemIds } } } }
        );
      } catch (cartError) {
        cartCleanupPending = true;
        console.error("Cart cleanup after checkout failed; purchased IDs will be excluded on future cart reads:", cartError);
      }
    }

    res.status(201).json({ success: true, order, cart_cleanup_pending: cartCleanupPending });
    void sendOrderNotification("order_submitted", order, { customerEmail: req.user.email });
  } catch (error) {
    console.error("Create order error:", error);
    res.status(500).json({ success: false, message: "Unable to create order", error: error.message });
  }
};

export const createOrderAsAdmin = async (req, res) => {
  try {
    const { 
      items, 
      shipping_address, 
      order_type, 
      attachments, 
      payment_terms,
      agreed_payment_date,
      customer_name, 
      customer_phone, 
      customer_email, 
      customer_id,
      has_account_on_website,
      downpayment_received,
      warranty_period,
      custom_warranty_days,
      warranty_assignment_mode,
      required_downpayment_amount,
      // Walk-in customer fields
      signed_contract_url,
      contract_number,
      contract_signed_date,
      inspection_date,
      estimated_installation_date,
      inspection_notes,
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: "Order items are required" });
    }

    const installationDateError = getInstallationDateError(inspection_date, estimated_installation_date);
    if (installationDateError) {
      return res.status(400).json({ success: false, message: installationDateError });
    }

    const normalizedOrderType = order_type === "walk_in_customer" ? "walk_in_customer" : "online_order";
    const isWalkInCustomer = normalizedOrderType === "walk_in_customer";

    if (customer_id && !mongoose.Types.ObjectId.isValid(customer_id)) {
      return res.status(400).json({ success: false, message: "Customer account ID is invalid" });
    }

    const linkedCustomer = customer_id
      ? await User.findOne({ _id: customer_id, role: "customer" }).select("first_name last_name email phone street_address city province zip_code")
      : null;

    if (customer_id && !linkedCustomer) {
      return res.status(400).json({ success: false, message: "The selected customer account was not found" });
    }

    const repricedItems = await repriceInspectionItems(items);
    const pricedItems = repricedItems.map((item) => ({
      ...item,
      warranty_start_date: null,
      warranty_expiry_date: null,
      warranty_status: item.warranty_period === "No Warranty" ? "no_warranty" : "pending",
    }));
    const calculatedEstimatedCost = pricedItems.reduce((sum, item) => sum + getItemAmountValue(item), 0);
    const estimated_cost = calculatedEstimatedCost > 0
      ? calculatedEstimatedCost
      : Math.max(Number(req.body.estimated_cost) || 0, 0);
    const manualOverride = Math.max(Number(req.body.manual_override) || 0, 0);
    const total_amount = manualOverride || estimated_cost || Math.max(Number(req.body.total_amount) || 0, 0);
    const requiredAmount = calculateRequiredDownpayment(total_amount, payment_terms, required_downpayment_amount);
    const initialPaidAmount = downpayment_received ? requiredAmount : 0;

    const hasWebsiteAccount = Boolean(linkedCustomer);
    const hasSignedWalkInContract = isWalkInCustomer && Boolean(signed_contract_url);
    const walkInSignedAt = hasSignedWalkInContract
      ? contract_signed_date ? new Date(contract_signed_date) : new Date()
      : null;
    const linkedCustomerName = `${linkedCustomer?.first_name || ""} ${linkedCustomer?.last_name || ""}`.trim();

    const order = new Order({
      customer: linkedCustomer?._id,
      customer_name: linkedCustomerName || customer_name || "",
      customer_phone: linkedCustomer?.phone || customer_phone || "",
      customer_email: linkedCustomer?.email || customer_email || "",
      items: pricedItems,
      total_amount,
      estimated_cost,
      final_project_cost: total_amount,
      manual_override: manualOverride,
      contract_amount: isWalkInCustomer ? total_amount : 0,
      downpayment_amount: requiredAmount,
      required_downpayment_amount: requiredAmount,
      amount_paid: initialPaidAmount,
      shipping_address: normalizeAddress(shipping_address || buildAddressFromUser(linkedCustomer)),
      payment_terms: payment_terms || "",
      agreed_payment_date: agreed_payment_date ? new Date(agreed_payment_date) : null,
      has_account_on_website: hasWebsiteAccount,
      downpayment_received: initialPaidAmount >= requiredAmount && requiredAmount > 0,
      warranty_period: warranty_period !== undefined && warranty_period !== null && String(warranty_period).trim() !== ""
        ? String(warranty_period)
        : "90",
      warranty_assignment_mode: warranty_assignment_mode === "per_product" ? "per_product" : "same",
      custom_warranty_days: custom_warranty_days !== undefined && custom_warranty_days !== null && Number(custom_warranty_days) > 0
        ? Number(custom_warranty_days)
        : null,
      attachments: Array.isArray(attachments) ? attachments : [],
      tracking: generateTrackingNumber(),
      order_type: normalizedOrderType,
      contract_status: hasSignedWalkInContract ? "accepted" : "pending",
      payment_status: "pending",
      status: hasSignedWalkInContract ? "contract_accepted" : "site_inspection",
      inspection_status: hasSignedWalkInContract ? "completed" : "pending",
      inspection_completed_at: hasSignedWalkInContract ? walkInSignedAt : null,
      inspection_date: inspection_date ? new Date(inspection_date) : null,
      estimated_installation_date: estimated_installation_date ? new Date(estimated_installation_date) : null,
      inspection_notes: inspection_notes || "",
      // Walk-in specific
      acceptance_method: hasSignedWalkInContract ? "walk_in_signed_contract" : isWalkInCustomer ? "walk_in_pending_contract" : "online",
      acceptanceMethod: hasSignedWalkInContract ? "Walk-in Signed Contract" : isWalkInCustomer ? "Walk-in Pending Contract" : "Online",
      acceptedByCustomer: false,
      acceptedAt: null,
      transactionCreated: hasSignedWalkInContract,
      transactionCreatedAt: hasSignedWalkInContract ? new Date() : null,
      signed_contract_url: isWalkInCustomer ? (signed_contract_url || "") : "",
      contract_number: isWalkInCustomer ? (contract_number || "") : "",
      contract_signed_date: hasSignedWalkInContract ? walkInSignedAt : null,
      contractStatus: hasSignedWalkInContract ? "Accepted" : "Not Generated",
      contractGenerated: hasSignedWalkInContract,
      contractId: hasSignedWalkInContract ? (contract_number || "") : "",
      contractVersion: hasSignedWalkInContract ? 1 : 0,
      currentContractVersion: hasSignedWalkInContract ? 1 : 0,
      contractGeneratedAt: hasSignedWalkInContract ? walkInSignedAt : null,
      contractHistory: hasSignedWalkInContract ? [{
        version: 1,
        contractId: contract_number || "",
        generatedAt: walkInSignedAt,
        status: "Accepted",
        acceptedAt: walkInSignedAt,
        acceptanceMethod: "Walk-in Signed Contract",
      }] : [],
    });

    order.payment_status = getOrderPaymentStatus(order);
    await order.save();

    res.status(201).json({ success: true, order });
    void sendOrderNotification(hasSignedWalkInContract ? "contract_accepted" : "order_submitted", order);
  } catch (error) {
    console.error("Create order as admin error:", error);
    res.status(500).json({ success: false, message: "Unable to create order", error: error.message });
  }
};

export const trackOrder = async (req, res) => {
  try {
    const tracking = req.params.tracking?.trim().toUpperCase();
    if (!tracking) {
      return res.status(400).json({ success: false, message: "Tracking number is required" });
    }

    const orderQuery = mongoose.Types.ObjectId.isValid(tracking)
      ? { $or: [{ tracking }, { _id: tracking }] }
      : { tracking };
    const order = await Order.findOne(orderQuery)
      .populate("customer", "first_name last_name email phone street_address city province zip_code")
      .populate("items.product_id", "image_url image images name product_name category product_type unit unit_price price_per_sqft price_per_blade width height measurement_unit standard_size");
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    if (req.query.itemIndex !== undefined) {
      const itemIndex = Number(req.query.itemIndex);
      if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= order.items.length) {
        return res.status(400).json({ success: false, message: "A valid product index is required." });
      }
      if (!order.items[itemIndex]?.review?.submittedAt) {
        return res.status(404).json({ success: false, message: "Product feedback not found." });
      }

      order.items[itemIndex].review = null;
      order.markModified(`items.${itemIndex}.review`);
      await order.save();
      return res.json({ success: true, order });
    }


    if (req.user && req.user.role !== "admin" && order.customer._id.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: "Not authorized to view this order" });
    }

    res.json({ success: true, order });
  } catch (error) {
    console.error("Track order error:", error);
    res.status(500).json({ success: false, message: "Unable to track order", error: error.message });
  }
};

export const getAdminOrders = async (req, res) => {
  try {
    if (!["admin", "skilled_worker"].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Staff access required" });
    }

    const { status, contract_status, payment_proof_submitted } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (contract_status) filter.contract_status = contract_status;
    if (payment_proof_submitted === "true") {
      filter.payment_proof_submitted_at = { $exists: true, $ne: null };
    }
    if (status === "site_inspection" && !contract_status) {
      filter.$or = [
        { contract_status: { $in: ["pending", "sent", "declined", ""] } },
        { contract_status: { $exists: false } },
        { contract_status: null },
      ];
    }

    const orders = await Order.find(filter)
      .populate("items.product_id", "image_url image images name category product_type width height measurement_unit standard_size")
      .populate("customer", "first_name last_name email phone street_address city province zip_code")
      .sort({ createdAt: -1 });

    res.json({ success: true, orders });
  } catch (error) {
    console.error("Get admin orders error:", error);
    res.status(500).json({ success: false, message: "Unable to fetch orders", error: error.message });
  }
};

export const getAdminOrderById = async (req, res) => {
  try {
    if (!["admin", "skilled_worker"].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Staff access required" });
    }

    const { orderId } = req.params;
    const order = await Order.findById(orderId)
      .populate("customer", "first_name last_name email phone street_address city province zip_code")
      .populate("items.product_id", "image_url image images name category product_type width height measurement_unit standard_size");

    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    res.json({ success: true, order });
  } catch (error) {
    console.error("Get admin order error:", error);
    res.status(500).json({ success: false, message: "Unable to fetch order", error: error.message });
  }
};

export const updateOrderStatus = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }

    const { orderId } = req.params;
    const {
      status,
      contract_status,
      items,
      payment_amount,
      amount_paid,
      downpayment_amount,
      required_downpayment_amount,
      payment_proof_amount,
      payment_proof_confirmed_at,
      payment_method,
      transaction_number,
      inspection_notes,
      inspection_date,
      warranty_period,
      warranty_assignment_mode,
      warranty_terms,
      custom_warranty_days,
      signed_contract_url,
      acceptance_method,
      acceptanceMethod,
      contract_number,
      contract_signed_date,
      inspection_status,
      inspection_completed_at,
      acceptedByCustomer,
      acceptedAt,
      transactionCreated,
      transactionCreatedAt,
    } = req.body;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const previousPaymentStatus = order.payment_status;
    const previousOrderStatus = String(order.status || "").toLowerCase();
    const previousPaidAmount = getOrderPaymentAmounts(order).paidAmount;
    const hadConfirmedPaymentProof = Boolean(order.payment_proof_confirmed_at);
    const previousContractStatus = String(order.contract_status || "").toLowerCase();
    const previousWarranty = JSON.stringify({
      period: order.warranty_period,
      start: order.warranty_start_date,
      end: order.warranty_expiry_date,
      status: order.warranty_status,
      items: (order.items || []).map((item) => [item.warranty_period, item.warranty_start_date, item.warranty_expiry_date, item.warranty_status]),
    });

    const requestedStatus = String(status || order.status || "").toLowerCase();
    const requestedContractStatus = String(contract_status || order.contract_status || "").toLowerCase();
    const requestsTransactionEntry =
      requestedStatus === "contract_accepted" ||
      requestedContractStatus === "accepted" ||
      transactionCreated === true;

    if (requestsTransactionEntry) {
      const requestedAcceptanceMethod = acceptance_method || order.acceptance_method;
      const isVerifiedWalkInContract =
        order.order_type === "walk_in_customer" &&
        requestedStatus === "contract_accepted" &&
        requestedContractStatus === "accepted" &&
        requestedAcceptanceMethod === "walk_in_signed_contract" &&
        Boolean(signed_contract_url || order.signed_contract_url) &&
        Boolean(contract_signed_date || order.contract_signed_date);
      const isCustomerAcceptedOnlineContract =
        order.order_type !== "walk_in_customer" &&
        order.acceptedByCustomer === true &&
        requestedAcceptanceMethod === "online" &&
        String(order.contract_status || "").toLowerCase() === "accepted";

      if (!isVerifiedWalkInContract && !isCustomerAcceptedOnlineContract) {
        return res.status(400).json({
          success: false,
          message: "Customer acceptance is required before this order can enter Transactions.",
        });
      }
    }

    const isOrderCompleted = order.status === "completed" || Number(order.progress) >= 100;
    if (String(status || "").toLowerCase() === "cancelled" && isOrderCompleted) {
      return res.status(400).json({
        success: false,
        message: "This project has already been completed and can no longer be cancelled.",
      });
    }

    const requestedPaidAmount = amount_paid ?? payment_amount;
    if (requestedPaidAmount !== undefined) {
      const totalAmount = getOrderPaymentAmounts(order).totalAmount;
      if (Math.round(Number(requestedPaidAmount) * 100) > Math.round(totalAmount * 100)) {
        return res.status(400).json({ success: false, message: "Payment cannot exceed the project total." });
      }
    }

    if (status) order.status = status;
    if (contract_status) order.contract_status = contract_status;
    if (required_downpayment_amount !== undefined) {
      const nextRequiredAmount = Math.min(
        getOrderPaymentAmounts(order).totalAmount,
        Math.max(Number(required_downpayment_amount) || 0, 0),
      );
      order.required_downpayment_amount = nextRequiredAmount;
      order.downpayment_amount = nextRequiredAmount;
    } else if (downpayment_amount !== undefined && payment_amount === undefined && amount_paid === undefined) {
      const nextRequiredAmount = Math.min(
        getOrderPaymentAmounts(order).totalAmount,
        Math.max(Number(downpayment_amount) || 0, 0),
      );
      order.required_downpayment_amount = nextRequiredAmount;
      order.downpayment_amount = nextRequiredAmount;
    }
    if (amount_paid !== undefined) order.amount_paid = Math.max(Number(amount_paid) || 0, 0);
    if (payment_amount !== undefined) order.amount_paid = Math.max(Number(payment_amount) || 0, 0);
    if (payment_proof_amount !== undefined) order.payment_proof_amount = Number(payment_proof_amount) || 0;
    if (payment_proof_confirmed_at !== undefined) {
      order.payment_proof_confirmed_at = payment_proof_confirmed_at ? new Date(payment_proof_confirmed_at) : null;
    }
    if (payment_method !== undefined) order.payment_method = payment_method || order.payment_method || "Cash";
    if (transaction_number !== undefined) order.transaction_number = transaction_number || "";
    if (inspection_date) order.inspection_date = inspection_date;
    if (inspection_notes) order.inspection_notes = inspection_notes;
    if (warranty_period !== undefined) order.warranty_period = warranty_period !== null && String(warranty_period).trim() !== "" ? String(warranty_period) : "90";
    if (warranty_assignment_mode !== undefined) {
      order.warranty_assignment_mode = warranty_assignment_mode === "per_product" ? "per_product" : "same";
    }
    if (custom_warranty_days !== undefined) order.custom_warranty_days = Number(custom_warranty_days) > 0 ? Number(custom_warranty_days) : null;
    if (signed_contract_url !== undefined) order.signed_contract_url = signed_contract_url || "";
    if (acceptance_method !== undefined) order.acceptance_method = ["online", "walk_in_signed_contract"].includes(String(acceptance_method)) ? acceptance_method : order.acceptance_method;
    if (acceptanceMethod !== undefined) order.acceptanceMethod = acceptanceMethod;
    if (contract_number !== undefined) order.contract_number = contract_number || "";
    if (contract_signed_date !== undefined) order.contract_signed_date = contract_signed_date ? new Date(contract_signed_date) : null;
    if (inspection_status !== undefined) order.inspection_status = inspection_status;
    if (inspection_completed_at !== undefined) order.inspection_completed_at = inspection_completed_at ? new Date(inspection_completed_at) : null;
    if (acceptedByCustomer !== undefined) order.acceptedByCustomer = Boolean(acceptedByCustomer);
    if (acceptedAt !== undefined) order.acceptedAt = acceptedAt ? new Date(acceptedAt) : null;
    if (transactionCreated !== undefined) order.transactionCreated = Boolean(transactionCreated);
    if (transactionCreatedAt !== undefined) order.transactionCreatedAt = transactionCreatedAt ? new Date(transactionCreatedAt) : null;
    if (warranty_period !== undefined) order.warranty_period = warranty_period;
    if (warranty_terms !== undefined) order.warranty_terms = warranty_terms;
    if (Array.isArray(items)) {
      items.forEach((incomingItem, index) => {
        const item = order.items[index];
        if (!item) return;
        ["warranty_period", "custom_warranty_days"].forEach((field) => {
          if (incomingItem[field] !== undefined) item[field] = incomingItem[field];
        });
      });
      order.markModified("items");
    }

    const { requiredAmount, paidAmount } = getOrderPaymentAmounts(order);
    order.downpayment_received = requiredAmount > 0 && paidAmount >= requiredAmount;
    order.payment_status = getOrderPaymentStatus(order);

    await order.save();

    res.json({ success: true, order });
    const currentPaidAmount = getOrderPaymentAmounts(order).paidAmount;
    const paymentProofJustConfirmed = Boolean(order.payment_proof_confirmed_at && !hadConfirmedPaymentProof);
    const confirmedPaymentAmount = Math.max(currentPaidAmount - previousPaidAmount, 0) || Number(order.payment_proof_amount) || 0;
    if (paymentProofJustConfirmed) {
      void sendOrderNotification("payment_proof_confirmed", order, {
        customerEmail: order.customer_email || order.customer?.email,
        previousStatus: previousPaymentStatus,
        confirmedAmount: confirmedPaymentAmount,
      });
    } else if (currentPaidAmount > previousPaidAmount || previousPaymentStatus !== order.payment_status) {
      void sendOrderNotification("transaction_update", order, {
        customerEmail: order.customer_email || order.customer?.email,
        previousStatus: previousPaymentStatus,
        confirmedAmount: Math.max(currentPaidAmount - previousPaidAmount, 0),
      });
    }
    if (previousContractStatus !== "accepted" && String(order.contract_status || "").toLowerCase() === "accepted") {
      void sendOrderNotification("contract_accepted", order);
    }
    if (previousOrderStatus !== "cancelled" && String(order.status || "").toLowerCase() === "cancelled") {
      void sendOrderNotification("order_cancelled", order, {
        audience: "customer",
        customerEmail: order.customer_email || order.customer?.email,
        date: new Date(),
        reason: req.body?.reason || req.body?.cancellation_reason || "",
      });
    }
    const currentWarranty = JSON.stringify({
      period: order.warranty_period,
      start: order.warranty_start_date,
      end: order.warranty_expiry_date,
      status: order.warranty_status,
      items: (order.items || []).map((item) => [item.warranty_period, item.warranty_start_date, item.warranty_expiry_date, item.warranty_status]),
    });
    const warrantyLines = getWarrantyEmailLines(order);
    if (previousWarranty !== currentWarranty && warrantyLines.length > 0) {
      void sendOrderNotification("warranty_notification", order, { audience: "customer", warrantyLines });
    }
  } catch (error) {
    console.error("Update order status error:", error);
    res.status(500).json({ success: false, message: "Unable to update order", error: error.message });
  }
};

export const deleteOrderReview = async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found." });
    }

    if (req.query.itemIndex !== undefined) {
      const itemIndex = Number(req.query.itemIndex);
      if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= order.items.length) {
        return res.status(400).json({ success: false, message: "A valid product index is required." });
      }
      if (!order.items[itemIndex]?.review?.submittedAt) {
        return res.status(404).json({ success: false, message: "Product feedback not found." });
      }

      order.items[itemIndex].review = null;
      order.markModified(`items.${itemIndex}.review`);
      await order.save();
      return res.json({ success: true, order });
    }

    if (!order.review || (!order.review.submittedAt && !order.review.rating)) {
      return res.status(404).json({ success: false, message: "Customer feedback not found." });
    }

    order.review = undefined;
    order.markModified("review");
    await order.save();

    return res.json({ success: true, order });
  } catch (error) {
    console.error("Delete order review error:", error);
    return res.status(500).json({ success: false, message: "Unable to delete customer feedback.", error: error.message });
  }
};

export const submitOrderReview = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { rating, title, comment, photos = [], itemIndex: rawItemIndex } = req.body;

    if (!rating || typeof rating !== "number" || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: "Rating must be a number between 1 and 5." });
    }
    if (!comment || typeof comment !== "string" || comment.trim().length < 10 || comment.trim().length > 500) {
      return res.status(400).json({ success: false, message: "Comment must be between 10 and 500 characters." });
    }
    if (!Array.isArray(photos)) {
      return res.status(400).json({ success: false, message: "Photos must be an array." });
    }
    if (photos.length > 5) {
      return res.status(400).json({ success: false, message: "You may upload up to 5 photos." });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found." });
    }
    if (!order.customer || order.customer.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: "Not authorized to review this order." });
    }

    const orderStatus = String(order.status || "").toLowerCase();
    const invalidReviewStatuses = ["cancelled", "declined", "contract_declined", "rejected"];
    const isStageComplete = (stage) =>
      stage?.completed === true || ["done", "completed"].includes(String(stage?.status || "").toLowerCase());
    const orderStages = Array.isArray(order.progress_stages) ? order.progress_stages : [];
    const orderStagesComplete = orderStages.length > 0 && orderStages.every(isStageComplete);
    const isBatchOrder = Array.isArray(order.items) && order.items.length > 1;
    const batchItemsComplete = isBatchOrder && order.items.every((item) => {
      const itemStages = Array.isArray(item.progress_stages) ? item.progress_stages : [];
      return itemStages.length > 0
        ? itemStages.every(isStageComplete)
        : Number(item.progress) >= 100;
    });
    const parentOrderComplete = orderStatus === "completed" && Number(order.progress) >= 100;
    const isCompleted =
      !invalidReviewStatuses.includes(orderStatus) &&
      (parentOrderComplete || orderStagesComplete || batchItemsComplete);
    if (!isCompleted) {
      return res.status(400).json({ success: false, message: "Only completed orders may be reviewed." });
    }

    const itemIndex = rawItemIndex === undefined || rawItemIndex === null ? null : Number(rawItemIndex);
    if (isBatchOrder && itemIndex === null) {
      return res.status(400).json({ success: false, message: "Select the product you want to review." });
    }
    if (itemIndex !== null && (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= order.items.length)) {
      return res.status(400).json({ success: false, message: "A valid product index is required." });
    }

    const reviewTarget = itemIndex === null ? order : order.items[itemIndex];
    const existingReview = reviewTarget.review?.submittedAt;
    if (existingReview && !isWithinReviewEditWindow(existingReview)) {
      return res.status(400).json({ success: false, message: "This review is locked and can no longer be edited." });
    }

    const now = new Date();
    const savedReview = {
      rating,
      title: title?.trim() || "",
      comment: comment.trim(),
      photos: photos.slice(0, 5).map((photo) => (typeof photo === "string" ? photo : "")).filter(Boolean),
      submittedAt: existingReview || now,
      updatedAt: now,
    };
    reviewTarget.review = savedReview;
    if (itemIndex !== null) order.markModified(`items.${itemIndex}.review`);

    await order.save();

    const productName = itemIndex === null ? order.items?.[0]?.name : order.items[itemIndex]?.name;
    const reviewMessage = buildReviewNotificationMessage(order, savedReview, productName);
    const adminEmail = process.env.ADMIN_EMAIL || "admin@example.com";
    const customerEmail = req.user.email || order.customer_email || "";

    res.json({ success: true, order });

    void sendMail({
      to: adminEmail,
      subject: `New customer review received for ${productName || order.tracking}`,
      text: reviewMessage,
    }).catch((mailError) => console.error("Review notification email failed:", mailError));

    if (customerEmail) {
      void sendMail({
        to: customerEmail,
        subject: "Thank you for your review",
        text: `Thank you for your feedback on order ${order.tracking || order._id}. Your review has been submitted successfully.\nOrder ID: ${order.tracking || order._id}`,
      }).catch((mailError) => console.error("Customer review confirmation email failed:", mailError));
    }
  } catch (error) {
    console.error("Submit order review error:", error);
    res.status(500).json({ success: false, message: "Unable to submit review.", error: error.message });
  }
};

const getProductReviewOrdersFilter = (productId) => ({
  "items.product_id": productId,
  $or: [
    { "review.submittedAt": { $ne: null } },
    { items: { $elemMatch: { product_id: productId, "review.submittedAt": { $ne: null } } } },
  ],
});

export const getProductReviewSummary = async (req, res) => {
  try {
    const { productId } = req.params;
    if (!productId) {
      return res.status(400).json({ success: false, message: "Product ID is required." });
    }

    const orders = await Order.find(getProductReviewOrdersFilter(productId))
      .select("review items.product_id items.review")
      .lean();
    const counts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    let total = 0;
    let ratingTotal = 0;

    for (const order of orders) {
      for (const item of order.items || []) {
        if (String(item.product_id) !== String(productId)) continue;
        const review = item.review?.submittedAt ? item.review : order.review;
        const rating = Number(review?.rating);
        if (!review?.submittedAt || !Number.isFinite(rating) || rating < 1 || rating > 5) continue;
        counts[Math.round(rating)] += 1;
        ratingTotal += rating;
        total += 1;
      }
    }

    return res.json({
      success: true,
      average: total ? ratingTotal / total : 0,
      total,
      counts,
    });
  } catch (error) {
    console.error("Get product review summary error:", error);
    return res.status(500).json({ success: false, message: "Unable to fetch product ratings." });
  }
};

export const getProductReviews = async (req, res) => {
  try {
    const { productId } = req.params;
    if (!productId) {
      return res.status(400).json({ success: false, message: "Product ID is required." });
    }

    const reviews = await Order.find(getProductReviewOrdersFilter(productId))
      .populate("customer", "first_name last_name")
      .populate("items.product_id", "name")
      .sort({ "review.submittedAt": -1 })
      .lean();

    const mappedReviews = reviews
      .flatMap((order) =>
        (order.items || [])
          .filter((item) => item.product_id && String(item.product_id._id || item.product_id) === String(productId))
          .flatMap((item, itemIndex) => {
            if (!item.product_id || String(item.product_id._id || item.product_id) !== String(productId)) return [];
            const review = item.review?.submittedAt ? item.review : order.review;
            if (!review?.submittedAt) return [];
            return [{
              orderId: order._id,
              tracking: order.tracking,
              productName: item.name,
              customerName: order.customer ? `${order.customer.first_name || ""} ${order.customer.last_name || ""}`.trim() : order.customer_name || "Customer",
              rating: review.rating || 0,
              title: review.title || "",
              comment: review.comment || "",
              photos: review.photos || [],
              submittedAt: review.submittedAt || null,
              itemIndex,
            }];
          })
      )
      .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

    res.json({ success: true, reviews: mappedReviews });
  } catch (error) {
    console.error("Get product reviews error:", error);
    res.status(500).json({ success: false, message: "Unable to fetch product reviews.", error: error.message });
  }
};

export const respondToContract = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { action, declineReason = "" } = req.body;

    if (!action || !["accept", "decline"].includes(action)) {
      return res.status(400).json({ success: false, message: "Contract action must be accept or decline." });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    if (!order.customer || order.customer.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: "Not authorized to respond to this contract." });
    }

    const orderStatus = (order.status || "").toString().toLowerCase();
    const contractStatus = (order.contract_status || "").toString().toLowerCase();
    const isAwaitingCustomerResponse =
      (orderStatus === "contract_sent" || orderStatus === "site_inspection" || contractStatus === "sent") &&
      !["accepted", "declined"].includes(contractStatus) &&
      !["contract_accepted", "contract_declined", "cancelled"].includes(orderStatus);

    if (action === "accept" && (orderStatus === "contract_accepted" || contractStatus === "accepted")) {
      return res.json({ success: true, order, message: "Contract already accepted." });
    }

    if (!isAwaitingCustomerResponse) {
      return res.status(400).json({ success: false, message: "Contract cannot be responded to at this stage." });
    }

    if (action === "decline" && !String(declineReason).trim()) {
      return res.status(400).json({ success: false, message: "Please provide a reason for declining the contract." });
    }

    if (order.order_type === "walk_in_customer") {
      return res.status(400).json({ success: false, message: "Walk-in contracts must be verified by an admin." });
    }

    if (action === "accept") {
      const acceptedAt = new Date();
      order.contract_status = "accepted";
      order.status = "contract_accepted";
      order.contractStatus = "Accepted";
      order.acceptance_method = "online";
      order.acceptanceMethod = "Online";
      order.acceptedByCustomer = true;
      order.acceptedAt = acceptedAt;
      order.contract_signed_date = acceptedAt;
      order.inspection_status = "completed";
      order.inspection_completed_at = acceptedAt;
      if (order.transactionCreated !== true) {
        order.transactionCreated = true;
        order.transactionCreatedAt = acceptedAt;
      }
      const activeContract = Array.isArray(order.contractHistory)
        ? order.contractHistory.find((entry) => entry.status === "Current")
        : null;
      if (activeContract) {
        activeContract.status = "Accepted";
        activeContract.acceptedAt = acceptedAt;
        activeContract.acceptanceMethod = "Online";
      }
    } else {
      order.contract_status = "declined";
      order.status = "site_inspection";
      order.contractStatus = "Declined";
      order.contractDeclineReason = String(declineReason).trim();
      order.contractDeclinedAt = new Date();
    }

    await order.save();

    res.json({ success: true, order });
    if (action === "accept") {
      void sendOrderNotification("contract_accepted", order, { customerEmail: req.user.email });
    }
  } catch (error) {
    console.error("Respond to contract error:", error);
    res.status(500).json({ success: false, message: "Unable to update contract response", error: error.message });
  }
};

export const cancelCustomerOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    if (!order.customer || order.customer.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: "Not authorized to cancel this order." });
    }

    if (order.status === "cancelled") {
      return res.json({ success: true, order, message: "Order already cancelled." });
    }

    const isCompleted = order.status === "completed" || Number(order.progress) >= 100;
    if (isCompleted) {
      return res.status(400).json({
        success: false,
        message: "This order has already been completed and cannot be cancelled.",
      });
    }

    const cancellationReason = String(req.body?.reason || req.body?.cancellation_reason || "").trim();
    order.status = "cancelled";
    if (order.contract_status === "accepted") {
      order.contract_status = "declined";
    }

    await order.save();

    res.json({ success: true, order, message: "Order cancelled successfully." });
    void sendOrderNotification("order_cancelled", order, {
      customerEmail: req.user.email || order.customer_email,
      date: new Date(),
      reason: cancellationReason,
    });
  } catch (error) {
    console.error("Cancel customer order error:", error);
    res.status(500).json({ success: false, message: "Unable to cancel order", error: error.message });
  }
};

export const submitCustomerPaymentProof = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { amount, payment_method, transaction_number, proof_file_name, proof_file_url } = req.body || {};

    const normalizedAmount = Number(amount);
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      return res.status(400).json({ success: false, message: "Please enter a valid payment amount." });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found." });
    }

    if (!order.customer || order.customer.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: "Not authorized to update payment proof for this order." });
    }

    if (order.payment_proof_submitted_at && !order.payment_proof_confirmed_at) {
      return res.status(409).json({
        success: false,
        message: "Your previous payment is awaiting confirmation before another payment can be submitted.",
      });
    }

    const { totalAmount, paidAmount } = getOrderPaymentAmounts(order);
    const remainingAmount = Math.max(totalAmount - paidAmount, 0);
    if (normalizedAmount > remainingAmount) {
      const formattedRemainingAmount = remainingAmount.toLocaleString("en-PH", {
        minimumFractionDigits: Number.isInteger(remainingAmount) ? 0 : 2,
        maximumFractionDigits: 2,
      });
      return res.status(400).json({
        success: false,
        message: `Payment cannot exceed the remaining balance of ₱${formattedRemainingAmount}.`,
      });
    }

    order.payment_proof_amount = normalizedAmount;
    order.payment_proof_submitted_at = new Date();
    order.payment_proof_confirmed_at = null;
    order.payment_proof_file_name = proof_file_name || order.payment_proof_file_name || "";
    order.payment_proof_file_url = proof_file_url || order.payment_proof_file_url || "";
    order.payment_method = payment_method || order.payment_method || "Cash";
    order.transaction_number = transaction_number || order.transaction_number || "";
    order.payment_status = getOrderPaymentStatus(order);

    await order.save();

    res.json({
      success: true,
      message: "Payment proof submitted successfully.",
      order,
    });
    void sendOrderNotification("payment_proof_submitted", order, { customerEmail: req.user.email || order.customer_email });
  } catch (error) {
    console.error("Submit customer payment proof error:", error);
    res.status(500).json({ success: false, message: "Unable to submit payment proof", error: error.message });
  }
};

export const respondToInstallationSchedule = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { action, reason, preferredInstallationDate, preferredInstallationTime, notes } = req.body;

    if (!action || !["accept", "reschedule", "accept_preferred"].includes(action)) {
      return res.status(400).json({ success: false, message: "Schedule action must be accept, reschedule, or accept_preferred." });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const isCustomer = order.customer && order.customer.toString() === req.user.id;
    const isAdmin = req.user.role === "admin";

    // Accept preferred requires admin, other actions require customer
    if (action === "accept_preferred") {
      if (!isAdmin) {
        return res.status(403).json({ success: false, message: "Only admins can accept preferred schedules." });
      }
    } else {
      if (!isCustomer) {
        return res.status(403).json({ success: false, message: "Not authorized to respond to this installation schedule." });
      }
    }

    const scheduleStageKeys = ["installation_scheduling", "installation_scheduled", "installation_agreement"];
    const scheduleStages = Array.isArray(order.progress_stages)
      ? order.progress_stages.filter((stage) => {
          const scheduleStageKey = (stage.key || stage.name || "").toString().toLowerCase().replace(/\s+/g, "_");
          return scheduleStageKeys.includes(scheduleStageKey);
        })
      : [];
    const scheduleStage =
      scheduleStages.find((stage) => stage.customerResponse === "reschedule_requested") ||
      scheduleStages.find((stage) => stage.proposedInstallationDate || stage.proposedInstallationTime) ||
      scheduleStages[0] ||
      null;

    if (!scheduleStage) {
      return res.status(400).json({ success: false, message: "Installation schedule is not available for response." });
    }

    const hasProposal = scheduleStage.proposedInstallationDate || scheduleStage.proposedInstallationTime;
    const hasPreferredProposal = scheduleStage.customerPreferredInstallationDate || scheduleStage.customerPreferredInstallationTime;

    if (action !== "accept_preferred" && !hasProposal) {
      return res.status(400).json({ success: false, message: "No installation proposal is available to respond to." });
    }

    if (action === "accept") {
      const alreadyAccepted = scheduleStage.customerResponse === "accepted" && scheduleStage.completed;
      if (alreadyAccepted) {
        return res.json({ success: true, order, message: "Installation schedule already accepted." });
      }

      scheduleStage.customerResponse = "accepted";
      scheduleStage.customerResponseAt = new Date();
      scheduleStage.customerDeclineReason = "";
      scheduleStage.customerPreferredInstallationDate = null;
      scheduleStage.customerPreferredInstallationTime = "";
      scheduleStage.customerRescheduleNotes = "";
      scheduleStage.completed = true;
      scheduleStage.status = "done";
      scheduleStage.date = new Date();
      order.status = order.status === "contract_accepted" ? "contract_accepted" : order.status;
    } else if (action === "accept_preferred") {
      // Admin accepting customer's preferred reschedule
      const alreadyAcceptedPreferred =
        scheduleStage.customerResponse === "accepted" &&
        scheduleStage.completed &&
        (scheduleStage.customerPreferredInstallationDate || scheduleStage.customerPreferredInstallationTime);
      if (alreadyAcceptedPreferred) {
        const installationStage = Array.isArray(order.progress_stages)
          ? order.progress_stages.find((stage) => {
              const stageKey = (stage.key || stage.name || "").toString().toLowerCase().replace(/\s+/g, "_");
              return stageKey === "installation";
            })
          : null;
        if (installationStage && !installationStage.completed && installationStage.status !== "in_progress") {
          installationStage.status = "in_progress";
          await order.save();
        }
        return res.json({ success: true, order, message: "Customer preferred schedule already accepted." });
      }

      if (scheduleStage.customerResponse !== "reschedule_requested") {
        return res.status(400).json({
          success: false,
          message: `Customer has not requested a reschedule. Current status: ${scheduleStage.customerResponse || "unknown"}.`,
        });
      }

      if (!hasPreferredProposal) {
        return res.status(400).json({
          success: false,
          message: "No customer preferred schedule is available to accept. Missing date or time.",
        });
      }

      // Update the proposed date/time to the customer's preferred values
      scheduleStage.proposedInstallationDate = scheduleStage.customerPreferredInstallationDate
        ? new Date(scheduleStage.customerPreferredInstallationDate)
        : null;
      scheduleStage.proposedInstallationTime = scheduleStage.customerPreferredInstallationTime || "";
      scheduleStage.customerResponse = "accepted";
      scheduleStage.customerResponseAt = new Date();
      scheduleStage.completed = true;
      scheduleStage.status = "done";
      scheduleStage.date = new Date();
      const installationStage = Array.isArray(order.progress_stages)
        ? order.progress_stages.find((stage) => {
            const stageKey = (stage.key || stage.name || "").toString().toLowerCase().replace(/\s+/g, "_");
            return stageKey === "installation";
          })
        : null;
      if (installationStage && !installationStage.completed) {
        installationStage.status = "in_progress";
      }
      order.status = order.status === "contract_accepted" ? "contract_accepted" : order.status;
    } else {
      if (!reason || !preferredInstallationDate || !preferredInstallationTime) {
        return res.status(400).json({
          success: false,
          message: "Reschedule requests require a reason, preferred installation date, and preferred installation time.",
        });
      }

      scheduleStage.customerResponse = "reschedule_requested";
      scheduleStage.customerResponseAt = new Date();
      scheduleStage.customerDeclineReason = reason.trim();
      scheduleStage.customerPreferredInstallationDate = new Date(preferredInstallationDate);
      scheduleStage.customerPreferredInstallationTime = preferredInstallationTime.trim();
      scheduleStage.customerRescheduleNotes = notes ? notes.trim() : "";
      scheduleStage.completed = false;
      scheduleStage.status = "pending";
      order.status = order.status === "contract_accepted" ? "contract_accepted" : order.status;
    }

    await order.save();

    res.json({ success: true, order });
  } catch (error) {
    console.error("Respond to installation schedule error:", error);
    res.status(500).json({ success: false, message: "Unable to update installation schedule response", error: error.message });
  }
};

export const updateOrderInspection = async (req, res) => {
  let updateData = {};

  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }

    const { orderId } = req.params;
    const { inspection_status, inspection_date, estimated_installation_date, inspection_notes, issues_found, shipping_address, payment_terms, agreed_payment_date, items, estimated_cost, total_amount, customer_name, customer_email, customer_phone, has_account_on_website, downpayment_received, required_downpayment_amount, manual_override, warranty_period, custom_warranty_days, warranty_assignment_mode } = req.body;

    updateData = {
      status: "site_inspection",
    };

    if (inspection_status !== undefined) updateData.inspection_status = inspection_status;
    if (inspection_date !== undefined) {
      updateData.inspection_date = inspection_date;
      if (inspection_status === undefined || inspection_status === null) {
        updateData.inspection_status = "scheduled";
      }
    }
    if (estimated_installation_date !== undefined) {
      const parsedInstallationDate = estimated_installation_date ? new Date(estimated_installation_date) : null;
      if (parsedInstallationDate && Number.isNaN(parsedInstallationDate.getTime())) {
        return res.status(400).json({ success: false, message: "Estimated installation date must be a valid date." });
      }
      updateData.estimated_installation_date = parsedInstallationDate;
    }
    if (inspection_notes !== undefined) updateData.inspection_notes = inspection_notes;
    if (issues_found !== undefined) updateData.issues_found = issues_found;
    if (shipping_address !== undefined) updateData.shipping_address = normalizeAddress(shipping_address || "");
    if (payment_terms !== undefined) updateData.payment_terms = payment_terms || "";
    if (agreed_payment_date !== undefined) {
      const parsedAgreedDate = agreed_payment_date ? new Date(agreed_payment_date) : null;
      if (agreed_payment_date && Number.isNaN(parsedAgreedDate.getTime())) {
        return res.status(400).json({ success: false, message: "Agreed payment date must be a valid date." });
      }
      updateData.agreed_payment_date = parsedAgreedDate;
    }
    if (has_account_on_website !== undefined) updateData.has_account_on_website = Boolean(has_account_on_website);
    if (downpayment_received !== undefined) updateData.downpayment_received = Boolean(downpayment_received);
    if (warranty_period !== undefined) updateData.warranty_period = warranty_period !== null && String(warranty_period).trim() !== "" ? String(warranty_period) : "90";
    if (warranty_assignment_mode !== undefined) updateData.warranty_assignment_mode = warranty_assignment_mode === "per_product" ? "per_product" : "same";
    if (custom_warranty_days !== undefined) updateData.custom_warranty_days = Number(custom_warranty_days) > 0 ? Number(custom_warranty_days) : null;
    if (manual_override !== undefined) updateData.manual_override = Number(manual_override) || 0;
    if (customer_name !== undefined) updateData.customer_name = customer_name || "";
    if (customer_email !== undefined) updateData.customer_email = customer_email || "";
    if (customer_phone !== undefined) updateData.customer_phone = customer_phone || "";
    if (Array.isArray(items)) {
      const repricedItems = await repriceInspectionItems(items);
      const invalidItem = repricedItems.find((item) => !item.product_id || !item.name);
      if (invalidItem) {
        return res.status(400).json({ success: false, message: "Invalid item data in inspection update." });
      }
      updateData.items = repricedItems;
    }
    if (total_amount !== undefined) {
      updateData.total_amount = Number(total_amount) || 0;
    }

    const order = await Order.findById(orderId).populate(
      "customer",
      "first_name last_name email phone street_address city province zip_code"
    );

    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const previousInstallationDate = order.estimated_installation_date
      ? new Date(order.estimated_installation_date).getTime()
      : null;

    const installationDateError = getInstallationDateError(
      inspection_date !== undefined ? inspection_date : order.inspection_date,
      estimated_installation_date !== undefined ? estimated_installation_date : order.estimated_installation_date,
    );
    if (installationDateError) {
      return res.status(400).json({ success: false, message: installationDateError });
    }

    const registeredCustomer = order.customer?._id ? order.customer : null;
    if (registeredCustomer) {
      const registeredName = `${registeredCustomer.first_name || ""} ${registeredCustomer.last_name || ""}`.trim();
      updateData.customer_name = registeredName || order.customer_name || "";
      updateData.customer_email = registeredCustomer.email || "";
      updateData.customer_phone = registeredCustomer.phone || "";
      updateData.has_account_on_website = true;
      updateData.shipping_address = normalizeAddress(
        shipping_address !== undefined
          ? shipping_address || ""
          : order.shipping_address || buildAddressFromUser(registeredCustomer)
      );
    }

    if (Array.isArray(updateData.items)) {
      updateData.items = updateData.items.map((item, index) => {
        const existingItem = order.items[index];
        const itemProductId = String(item.product_id?._id || item.product_id || "");
        const existingProductId = String(existingItem?.product_id?._id || existingItem?.product_id || "");
        const sameProduct = Boolean(existingItem && itemProductId === existingProductId);
        return {
          ...item,
          progress: existingItem?.progress ?? null,
          progress_stages: existingItem?.progress_stages || [],
          warranty_start_date: sameProduct ? existingItem.warranty_start_date || null : null,
          warranty_expiry_date: sameProduct ? existingItem.warranty_expiry_date || null : null,
          warranty_status: sameProduct && existingItem.warranty_status
            ? existingItem.warranty_status
            : item.warranty_period === "No Warranty" ? "no_warranty" : "pending",
        };
      });
    }

    const wasDownpaymentReceived = Boolean(order.downpayment_received);
    const currentItems = Array.isArray(updateData.items) ? updateData.items : order.items || [];
    const calculatedItemsEstimate = currentItems.reduce((sum, item) => sum + getItemAmountValue(item), 0);
    const updatedEstimatedCost = Array.isArray(updateData.items)
      ? calculatedItemsEstimate
      : Number(estimated_cost) > 0
        ? Number(estimated_cost)
        : Number(order.estimated_cost) > 0
          ? Number(order.estimated_cost)
          : calculatedItemsEstimate;
    const updatedManualOverride = manual_override !== undefined
      ? Math.max(Number(manual_override) || 0, 0)
      : Math.max(Number(order.manual_override) || 0, 0);
    const updatedTotalAmount = updatedManualOverride > 0
      ? updatedManualOverride
      : updatedEstimatedCost > 0
        ? updatedEstimatedCost
        : total_amount !== undefined
          ? Math.max(Number(total_amount) || 0, 0)
          : getFinalProjectCost(order);
    const updatedPaymentTerms = payment_terms !== undefined ? payment_terms : order.payment_terms;
    const configuredRequiredAmount = required_downpayment_amount !== undefined
      ? required_downpayment_amount
      : order.required_downpayment_amount ?? order.downpayment_amount;
    const updatedRequiredAmount = calculateRequiredDownpayment(
      updatedTotalAmount,
      updatedPaymentTerms,
      configuredRequiredAmount,
    );
    updateData.manual_override = updatedManualOverride;
    updateData.estimated_cost = updatedEstimatedCost;
    updateData.final_project_cost = updatedTotalAmount;
    updateData.total_amount = updatedTotalAmount;
    updateData.contract_amount = updatedTotalAmount;
    updateData.downpayment_amount = updatedRequiredAmount;
    updateData.required_downpayment_amount = updatedRequiredAmount;

    Object.assign(order, updateData);
    if (downpayment_received === true && !wasDownpaymentReceived && (Number(order.amount_paid) || 0) < updatedRequiredAmount) {
      order.amount_paid = updatedRequiredAmount;
    }
    if (order.amount_paid === undefined && order.downpayment_received) {
      order.amount_paid = updatedRequiredAmount;
    }
    const { requiredAmount, paidAmount } = getOrderPaymentAmounts(order);
    order.downpayment_received = requiredAmount > 0 && paidAmount >= requiredAmount;
    order.payment_status = getOrderPaymentStatus(order);
    await order.save();

    res.json({ success: true, order });
    const currentInstallationDate = order.estimated_installation_date
      ? new Date(order.estimated_installation_date).getTime()
      : null;
    if (estimated_installation_date !== undefined && currentInstallationDate && currentInstallationDate !== previousInstallationDate) {
      const plan = getInstallationPlan(order);
      void sendOrderNotification("installation_date", order, {
        installationDate: order.estimated_installation_date,
        installationTime: plan.time,
        installationStatus: plan.status,
      });
    }
  } catch (error) {
    console.error("Update inspection payload:", JSON.stringify(req.body, null, 2));
    console.error("Update inspection data:", JSON.stringify(updateData, null, 2));
    console.error("Update inspection error name:", error.name);
    console.error("Update inspection error:", error);
    if (error.name === "ValidationError" || error.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "Inspection update failed validation",
        details: error.name === "ValidationError"
          ? Object.values(error.errors).map((err) => err.message)
          : [error.message],
      });
    }
    res.status(500).json({
      success: false,
      message: error.message || "Unable to update inspection",
      error: error.name,
      details: error.stack || error.errors || null,
    });
  }
};

export const updateOrderProgress = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }

    const { orderId } = req.params;
    const { progress, status, installation_date, estimated_installation_date, stages, proof_images } = req.body;

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    const previousInstallationPlan = getInstallationPlan(order);
    const itemIndex = req.body.itemIndex;
    const isItemProgressUpdate = typeof itemIndex === "number" && Number.isInteger(itemIndex) && order.items.length > 1;
    if (estimated_installation_date) {
      const installationDateError = getInstallationDateError(order.inspection_date, estimated_installation_date);
      if (installationDateError) {
        return res.status(400).json({ success: false, message: installationDateError });
      }
    }
    if (itemIndex !== undefined && (!isItemProgressUpdate || itemIndex < 0 || itemIndex >= order.items.length)) {
      return res.status(400).json({ success: false, message: "Invalid item index for batch progress update." });
    }
    const previousStages = isItemProgressUpdate && order.items[itemIndex].progress_stages?.length
      ? order.items[itemIndex].progress_stages
      : order.progress_stages || [];
    const previousDelayEventKeys = new Set(previousStages.flatMap((stage, index) =>
      (stage.delayHistory || []).map((entry) => getDelayEventKey(stage, entry, index))
    ));
    let newDelayEvents = [];

    if (typeof progress !== "undefined") {
      if (isItemProgressUpdate) order.items[itemIndex].progress = Number(progress) || 0;
      else order.progress = Number(progress) || 0;
    }

    // Map friendly status values back to internal statuses when possible
    const mapFriendlyToInternal = (s) => {
      if (!s) return undefined;
      const key = String(s).toLowerCase();
      if (key.includes("fabrication") || key.includes("processing")) return "processing";
      if (key.includes("installation") || key.includes("site_inspection")) return "site_inspection";
      if (key.includes("completed")) return "completed";
      if (key.includes("cutting")) return "processing";
      if (key.includes("pending")) return "admin_review";
      if (key.includes("delayed")) return "processing";
      return undefined;
    };

    const mapped = isItemProgressUpdate ? undefined : mapFriendlyToInternal(status);
    if (mapped) order.status = mapped;

    if (!isItemProgressUpdate && installation_date) {
      // store as inspection_date for compatibility with existing schema
      order.inspection_date = installation_date;
    }

    if (!isItemProgressUpdate && estimated_installation_date !== undefined) {
      const parsedInstallationDate = estimated_installation_date ? new Date(estimated_installation_date) : null;
      if (parsedInstallationDate && Number.isNaN(parsedInstallationDate.getTime())) {
        return res.status(400).json({ success: false, message: "Estimated installation date must be a valid date." });
      }
      order.estimated_installation_date = parsedInstallationDate;
    }

    if (Array.isArray(stages)) {
      const normalizedStages = stages.map((s) => ({
        key: s.key || (s.name || "").toString().toLowerCase().replace(/\s+/g, "_"),
        name: s.name || "",
        status: ["pending", "in_progress", "done", "delayed", "on_hold"].includes(s.status) ? s.status : s.completed ? "done" : "pending",
        completed: !!s.completed,
        date: s.date ? new Date(s.date) : null,
        delayReason: s.delayReason || "",
        delayExpectedResolution: s.delayExpectedResolution ? new Date(s.delayExpectedResolution) : null,
        delayNotes: s.delayNotes || "",
        delayReportedAt: s.delayReportedAt ? new Date(s.delayReportedAt) : null,
        delayReportedBy: s.delayReportedBy || "",
        proposedInstallationDate: s.proposedInstallationDate ? new Date(s.proposedInstallationDate) : null,
        proposedInstallationTime: s.proposedInstallationTime ? String(s.proposedInstallationTime).trim() : "",
        delayHistory: Array.isArray(s.delayHistory)
          ? s.delayHistory.map((entry) => ({
              reason: entry.reason || "",
              expectedResolution: entry.expectedResolution ? new Date(entry.expectedResolution) : null,
              notes: entry.notes || "",
              reportedAt: entry.reportedAt ? new Date(entry.reportedAt) : null,
              reportedBy: entry.reportedBy || "",
              status: entry.status || "delayed",
              resolvedAt: entry.resolvedAt ? new Date(entry.resolvedAt) : null,
            }))
          : [],
        images: Array.isArray(s.images) ? s.images : [],
        customerResponse: ["pending", "accepted", "declined", "reschedule_requested"].includes(s.customerResponse)
          ? s.customerResponse
          : "pending",
        customerResponseAt: s.customerResponseAt ? new Date(s.customerResponseAt) : null,
        customerDeclineReason: s.customerDeclineReason ? s.customerDeclineReason : "",
        customerPreferredInstallationDate: s.customerPreferredInstallationDate ? new Date(s.customerPreferredInstallationDate) : null,
        customerPreferredInstallationTime: s.customerPreferredInstallationTime ? s.customerPreferredInstallationTime : "",
        customerRescheduleNotes: s.customerRescheduleNotes ? s.customerRescheduleNotes : "",
        subStages: Array.isArray(s.subStages)
          ? s.subStages.map((sub) => ({
              name: sub.name || "",
              description: sub.description || "",
              status: ["pending", "in_progress", "done", "delayed", "on_hold"].includes(sub.status)
                ? sub.status
                : sub.completed
                ? "done"
                : "pending",
              completed: !!sub.completed,
              date: sub.date ? new Date(sub.date) : null,
              images: Array.isArray(sub.images) ? sub.images : [],
            }))
          : [],
      }));

      const delayReporter = req.user?.email || "";
      const targetStages = normalizedStages.map((stage) => {
        const history = Array.isArray(stage.delayHistory)
          ? stage.delayHistory.map((entry) => ({
              ...entry,
              reportedBy: entry.reportedBy || delayReporter,
            }))
          : [];

        const last = history[history.length - 1];
        if (stage.status !== "delayed" && last && last.status === "delayed" && !last.resolvedAt) {
          history[history.length - 1] = {
            ...last,
            resolvedAt: new Date(),
          };
        }

        return {
          ...stage,
          delayReportedBy: stage.delayReportedBy || delayReporter,
          delayHistory: history,
        };
      });

      const requestedInstallationDate = !isItemProgressUpdate && estimated_installation_date
        ? new Date(estimated_installation_date)
        : null;
      const previousPlannedDate = previousInstallationPlan.date
        ? new Date(previousInstallationPlan.date).getTime()
        : null;
      const isRescheduled = requestedInstallationDate && previousPlannedDate !== null
        && requestedInstallationDate.getTime() !== previousPlannedDate;
      const installationAlreadyCompleted = targetStages.some(isCompletedInstallationStage);
      if (isRescheduled && installationAlreadyCompleted) {
        return res.status(400).json({ success: false, message: "Installation cannot be rescheduled after it is completed." });
      }
      if (requestedInstallationDate && !installationAlreadyCompleted) {
        const scheduleStage = targetStages.find((stage) => {
          const key = String(stage.key || "").toLowerCase();
          const name = String(stage.name || "").toLowerCase();
          return key.includes("installation_scheduling") || name.includes("installation scheduling");
        }) || targetStages.find((stage) => {
          const key = String(stage.key || "").toLowerCase();
          const name = String(stage.name || "").toLowerCase();
          return !stage.completed && (key.includes("installation") || name.includes("installation"))
            && !key.includes("schedul") && !name.includes("schedul");
        });

        if (scheduleStage) {
          scheduleStage.proposedInstallationDate = requestedInstallationDate;
          if (isRescheduled) {
            const reportedAt = new Date();
            const reason = "Installation rescheduled";
            const notes = "Installation date changed in Progress Monitor.";
            scheduleStage.status = "delayed";
            scheduleStage.completed = false;
            scheduleStage.delayReason = reason;
            scheduleStage.delayExpectedResolution = requestedInstallationDate;
            scheduleStage.delayReportedAt = reportedAt;
            scheduleStage.delayReportedBy = req.user?.email || "";
            scheduleStage.delayNotes = notes;
            scheduleStage.delayHistory = [
              ...(scheduleStage.delayHistory || []),
              { reason, expectedResolution: requestedInstallationDate, notes, reportedAt, reportedBy: req.user?.email || "", status: "delayed", resolvedAt: null },
            ];
          }
        }
      }

      newDelayEvents = targetStages.flatMap((stage, stageIndex) =>
        stage.delayHistory
          .filter((entry) => entry.status === "delayed" && !previousDelayEventKeys.has(getDelayEventKey(stage, entry, stageIndex)))
          .map((entry) => ({
            stageName: stage.name || stage.key || "Project stage",
            reason: entry.reason,
            expectedResolution: entry.expectedResolution,
            notes: entry.notes,
            productName: isItemProgressUpdate ? order.items[itemIndex]?.name : "",
          }))
      );

      if (isItemProgressUpdate) {
        const orderStages = Array.isArray(order.progress_stages) ? order.progress_stages : [];
        order.items.forEach((item) => {
          if (!Array.isArray(item.progress_stages) || item.progress_stages.length === 0) {
            item.progress_stages = orderStages.map((stage) => stage.toObject?.() || stage);
            item.progress = order.progress ?? null;
          }
        });
        order.items[itemIndex].progress_stages = targetStages;
        order.items[itemIndex].progress = Number(progress) || 0;

        const allBatchItemsCompleted = order.items.length > 0 && order.items.every((item) => {
          const itemStages = Array.isArray(item.progress_stages) ? item.progress_stages : [];
          const stagesCompleted = itemStages.length > 0 && itemStages.every((stage) =>
            stage.completed === true || ["done", "completed"].includes(String(stage.status || "").toLowerCase())
          );
          return itemStages.length > 0 ? stagesCompleted : Number(item.progress) >= 100;
        });

        if (allBatchItemsCompleted) {
          order.progress = 100;
          order.status = "completed";
          order.progress_stages = (order.progress_stages || []).map((stage) => {
            const stageData = stage.toObject?.() || stage;
            return {
              ...stageData,
              status: "done",
              completed: true,
              subStages: Array.isArray(stageData.subStages)
                ? stageData.subStages.map((subStage) => ({ ...subStage, status: "done", completed: true }))
                : stageData.subStages,
            };
          });
        }
      } else {
        order.progress_stages = targetStages;
        const allProjectStagesDone =
          order.progress_stages.length > 0 &&
          order.progress_stages.every((stage) => stage.completed === true);
        if (allProjectStagesDone) {
          order.status = "completed";
        }
      }

      // If a site inspection stage exists, keep inspection_date/status in sync
      if (!isItemProgressUpdate) {
        try {
        const inspectionStage = order.progress_stages.find((s) => {
          const key = (s.key || "").toString().toLowerCase();
          const name = (s.name || "").toString().toLowerCase();
          return (
            key.includes("site_inspection") ||
            name.includes("site inspection") ||
            key.includes("inspection") ||
            name.includes("inspection")
          );
        });

        if (inspectionStage) {
          // If admin saved a proposed date/time for inspection/scheduling, keep inspection_date in sync
          if (inspectionStage.proposedInstallationDate) {
            order.inspection_date = inspectionStage.proposedInstallationDate;
            // mark scheduled unless already completed
            if (order.inspection_status !== "completed") order.inspection_status = "scheduled";
          }

          // If the inspection stage is completed, ensure the order's inspection_status is marked completed
          if (inspectionStage.completed) {
            order.inspection_status = "completed";
            if (inspectionStage.date) {
              order.inspection_date = inspectionStage.date;
            }
          }
        }
      } catch (syncErr) {
        console.warn("Failed to sync inspection stage to order fields:", syncErr && syncErr.message ? syncErr.message : syncErr);
        }
      }
    }

    const warrantyStages = isItemProgressUpdate
      ? order.items[itemIndex]?.progress_stages || []
      : order.progress_stages || [];
    applyInstallationWarranty(order, warrantyStages, isItemProgressUpdate ? itemIndex : undefined);

    // Accept an array of proof_images to append to the last stage or attachments
    if (Array.isArray(proof_images) && proof_images.length > 0) {
      order.attachments = Array.isArray(order.attachments) ? order.attachments.concat(proof_images) : proof_images.slice();
      if (order.progress_stages && order.progress_stages.length > 0) {
        const last = order.progress_stages[order.progress_stages.length - 1];
        last.images = Array.isArray(last.images) ? last.images.concat(proof_images) : proof_images.slice();
      }
    }

    await order.save();

    const currentInstallationPlan = getInstallationPlan(order);
    const previousPlanDate = previousInstallationPlan.date ? new Date(previousInstallationPlan.date).getTime() : null;
    const currentPlanDate = currentInstallationPlan.date ? new Date(currentInstallationPlan.date).getTime() : null;
    if (currentPlanDate && (previousPlanDate !== currentPlanDate || previousInstallationPlan.time !== currentInstallationPlan.time)) {
      void sendOrderNotification("installation_date", order, {
        installationDate: currentInstallationPlan.date,
        installationTime: currentInstallationPlan.time,
        installationStatus: currentInstallationPlan.status,
      });
    }

    if (newDelayEvents.length > 0) {
      const linkedCustomer = order.customer_email
        ? null
        : order.customer
          ? await User.findById(order.customer).select("email first_name")
          : null;
      const customerEmail = order.customer_email || linkedCustomer?.email || "";
      if (customerEmail) {
        await Promise.all(newDelayEvents.map(async (delayEvent) => {
          const expectedResolution = delayEvent.expectedResolution
            ? new Date(delayEvent.expectedResolution).toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" })
            : "Not yet determined";
          const projectName = delayEvent.productName || order.items?.[0]?.name || "your project";
          const message = [
            `Hello ${order.customer_name || linkedCustomer?.first_name || ""},`,
            "",
            `There is a delay affecting ${projectName}.`,
            `Stage: ${delayEvent.stageName}`,
            `Reason: ${delayEvent.reason || "Not provided"}`,
            `Expected resolution: ${expectedResolution}`,
            delayEvent.notes ? `Additional notes: ${delayEvent.notes}` : "",
            "",
            `Order ID: ${order.tracking || order._id}`,
          ].filter(Boolean).join("\n");

          try {
            await sendMail({
              to: customerEmail,
              subject: `Project delay update - ${order.tracking || "your order"}`,
              text: message,
            });
          } catch (mailError) {
            console.error("Customer project delay email failed:", mailError);
          }
        }));
      }
    }

    res.json({ success: true, order });
  } catch (error) {
    console.error("Update order progress error:", error);
    res.status(500).json({ success: false, message: "Unable to update order progress", error: error.message });
  }
};

export const generateContract = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }

    const { orderId } = req.params;
    const { contract_terms, snapshot, regenerate = false } = req.body;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const estimatedInstallationDate = order.estimated_installation_date
      ? new Date(order.estimated_installation_date)
      : null;
    const estimatedInstallationDateText = String(order.estimated_installation_date || "").slice(0, 10);
    const hasInvalidCalendarDate = /^\d{4}-\d{2}-\d{2}$/.test(estimatedInstallationDateText)
      && estimatedInstallationDate?.toISOString().slice(0, 10) !== estimatedInstallationDateText;
    if (!estimatedInstallationDate || Number.isNaN(estimatedInstallationDate.getTime()) || hasInvalidCalendarDate) {
      return res.status(400).json({
        success: false,
        message: "Set the Est. Install Date first before generating the contract.",
      });
    }

    const finalProjectCost = getFinalProjectCost(order);
    const requiredAmount = calculateRequiredDownpayment(
      finalProjectCost,
      order.payment_terms,
      order.required_downpayment_amount ?? order.downpayment_amount,
    );
    const contractSnapshot = {
      ...(snapshot || order.contractSnapshot || {}),
      projectCost: finalProjectCost,
      downpayment: requiredAmount,
    };

    const version = regenerate
      ? Number(order.currentContractVersion || order.contractVersion || 0) + 1
      : Number(order.currentContractVersion || order.contractVersion || 0) || 1;

    const nextContractId = order.contractId || `ACGC-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
    const history = Array.isArray(order.contractHistory) ? order.contractHistory.map((entry) => ({
      ...entry,
      status: entry.status === "Current" ? "Superseded" : entry.status,
    })) : [];

    history.push({
      version,
      contractId: nextContractId,
      generatedAt: new Date(),
      status: "Current",
      snapshot: contractSnapshot,
    });

    order.contractGenerated = true;
    order.contractId = nextContractId;
    order.contractVersion = version;
    order.currentContractVersion = version;
    order.contractGeneratedAt = new Date();
    order.contractNeedsRegeneration = false;
    order.contractStatus = "Created";
    order.contractSnapshot = contractSnapshot;
    order.contractHistory = history;
    order.contract_status = "pending";
    order.contractSentAt = null;
    order.contract_email_status = "not_sent";
    order.contract_email_queued_at = null;
    order.contract_email_sent_at = null;
    order.contract_email_error = "";
    order.contract_terms = contract_terms || "";
    order.total_amount = finalProjectCost;
    order.final_project_cost = finalProjectCost;
    order.contract_amount = finalProjectCost;
    order.required_downpayment_amount = requiredAmount;
    order.downpayment_amount = requiredAmount;
    order.inspection_status = order.inspection_status || "pending";

    if (order.status === "contract_sent") {
      order.status = "site_inspection";
    }

    await order.save();

    res.json({ success: true, order });
  } catch (error) {
    console.error("Generate contract error:", error);
    res.status(500).json({ success: false, message: "Unable to generate contract", error: error.message });
  }
};

export const sendWalkInApprovalEmail = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }

    const { orderId } = req.params;
    const { customerName, customerEmail, contractUrl, contractAttachment } = req.body;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const customerEmailValue = (customerEmail || order.customer_email || "").trim();
    const isWalkInCustomer = String(order.order_type || "") === "walk_in_customer";

    if (!customerEmailValue) {
      return res.status(400).json({ success: false, message: "Customer email is required" });
    }

    const generatedContractAttachment = getDataUrlAttachment(
      contractAttachment,
      `ACGC-Contract-${order.tracking || orderId}.pdf`
    );
    if (!generatedContractAttachment || generatedContractAttachment.contentType !== "application/pdf") {
      return res.status(400).json({
        success: false,
        message: "Generate the contract PDF before sending it to the customer.",
      });
    }

    const escapeHtml = (value) => String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
    const customerNameValue = customerName || order.customer_name || "Valued Customer";
    const orderIdentifier = order.tracking || order._id.toString();
    const contractLink = contractUrl || order.signed_contract_url || "";
    const fromAddress = process.env.EMAIL_FROM || "ACGC Site Inspection <no-reply@acgc.com>";
    const frontendUrl = (process.env.FRONTEND_URL || process.env.CLIENT_URL || "http://localhost:5173").replace(/\/$/, "");
    const contractLoginLink = `${frontendUrl}/customer-dashboard?tab=contracts&orderId=${encodeURIComponent(order._id)}`;

    const htmlBody = `
      <div style="font-family:Arial,sans-serif;color:#111827">
        <h2 style="color:#dc2626">ACGC Glass &amp; Aluminum Services</h2>
        <p>Hi ${escapeHtml(customerNameValue)},</p>
        <p>Your site inspection contract details are attached as a PDF file.</p>
        <p><strong>Order ID:</strong> ${escapeHtml(orderIdentifier)}</p>
        <p><a href="${escapeHtml(contractLoginLink)}" style="display:inline-block;background:#dc2626;color:#fff;padding:10px 16px;text-decoration:none;border-radius:6px">Log in to view your contract</a></p>
        <p>Please review the attached document and contact our support team if anything needs to be corrected.</p>
        <p>Thank you,<br/>ACGC Site Inspection Team</p>
      </div>
    `;

    const textBody = `
Hi ${customerNameValue},

Your site inspection contract details are attached as a PDF file.

Order ID: ${orderIdentifier}

Log in to view your contract: ${contractLoginLink}

Please review the attached document and contact our support team if anything needs to be corrected.

Thank you,
ACGC Site Inspection Team
`;

    const attachments = [generatedContractAttachment];
    const uploadedContractAttachment = getLocalUploadedAttachment(contractLink);
    if (uploadedContractAttachment) {
      attachments.push(uploadedContractAttachment);
    }

    const emailOptions = {
      from: fromAddress,
      to: customerEmailValue,
      subject: "ACGC Site Inspection Contract Details",
      text: textBody,
      html: htmlBody,
      attachments,
    };

    order.contract_status = "sent";
    order.contractStatus = "Sent";
    order.contractSentAt = new Date();
    order.contract_email_status = "queued";
    order.contract_email_queued_at = new Date();
    order.contract_email_sent_at = null;
    order.contract_email_error = "";
    order.status = "site_inspection";
    await order.save();

    res.once("finish", () => {
      setImmediate(async () => {
        try {
          await sendMail(emailOptions);
          await Order.updateOne(
            { _id: order._id },
            { $set: { contract_email_status: "sent", contract_email_sent_at: new Date(), contract_email_error: "" } }
          );
          console.info(`[contract-email] Delivered contract for order ${order.tracking || order._id}.`);
        } catch (emailError) {
          console.error("Approval email send failed:", emailError);
          const errorMessage = emailError?.code === "EAUTH"
            ? "Email service authentication failed."
            : "Unable to deliver email.";
          try {
            await Order.updateOne(
              { _id: order._id },
              { $set: { contract_email_status: "failed", contract_email_error: errorMessage } }
            );
          } catch (statusError) {
            console.error("Unable to record contract email failure:", statusError);
          }
        }
      });
    });

    return res.status(202).json({
      success: true,
      email_status: "queued",
      message: isWalkInCustomer
        ? "Contract saved to the customer account; approval email queued."
        : "Contract saved to the customer account; email queued.",
    });
  } catch (error) {
    console.error("Send approval email error:", error);
    res.status(500).json({ success: false, message: "Unable to send email", error: error.message });
  }
};
