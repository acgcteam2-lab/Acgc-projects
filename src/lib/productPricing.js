import { toSquareFeet } from "./estimator.js";

const toNonNegativeNumber = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(amount, 0) : 0;
};

const getQuantity = (item = {}) =>
  Math.max(1, Number(item.quantity ?? item.dimensions?.quantity) || 1);

const getPricingMethod = (product = {}, item = {}) => {
  const configuredMethod = String(product.pricing_method || item.pricing_method || "").toLowerCase();
  if (configuredMethod) return configuredMethod;
  const legacyUnit = String(product.unit || item.unit || "").toLowerCase();
  if (legacyUnit === "per_sqft" || legacyUnit === "sqft") return "sqft";
  if (legacyUnit === "per_blade" || legacyUnit === "blade") return "blade";
  if (["per_piece", "piece", "per_set", "set", "per_meter", "meter"].includes(legacyUnit)) return "fixed";
  if (Number(product.price_per_sqft ?? item.price_per_sqft) > 0) return "sqft";
  if (Number(product.price_per_blade ?? item.price_per_blade) > 0) return "blade";
  return "fixed";
};

export const getProductLineTotal = (product = {}, item = {}) => {
  const quantity = getQuantity(item);
  const method = getPricingMethod(product, item);
  const overridePrice = toNonNegativeNumber(
    product.estimated_price_override ?? item.estimated_price_override,
  );

  if (overridePrice > 0) {
    return Math.round(overridePrice * quantity * 100) / 100;
  }

  const unit = item.measurement_unit || item.measurementUnit || item.dimensions?.unit || product.measurement_unit || "in";
  const width = Number(item.width ?? item.dimensions?.width ?? product.width) || 0;
  const height = Number(item.height ?? item.dimensions?.height ?? product.height) || 0;

  if (method === "sqft" || method === "per_sqft") {
    const rate = toNonNegativeNumber(product.price_per_sqft ?? item.price_per_sqft);
    if (rate > 0 && width > 0 && height > 0) {
      const areaPerUnit = toSquareFeet(width, height, unit);
      const customizationFee = product.customization && item.customized
        ? toNonNegativeNumber(product.customization_fee)
        : 0;
      return Math.round((areaPerUnit * rate * quantity + customizationFee) * 100) / 100;
    }
  }

  if (method === "blade" || method === "per_blade") {
    const rate = toNonNegativeNumber(product.price_per_blade ?? item.price_per_blade);
    const bladesPerUnit = toNonNegativeNumber(product.blade_count ?? item.blade_count);
    if (rate > 0 && bladesPerUnit > 0) {
      return Math.round(rate * bladesPerUnit * quantity * 100) / 100;
    }
  }

  if (["fixed", "per_piece", "per_set", "per_meter", "piece", "set", "meter"].includes(method)) {
    const savedEstimate = toNonNegativeNumber(product.estimated_price ?? item.estimated_price);
    const basePrice = toNonNegativeNumber(product.base_price ?? item.base_price);
    const fixedPrice = basePrice || savedEstimate || toNonNegativeNumber(product.unit_price ?? item.unit_price);
    return Math.round(fixedPrice * quantity * 100) / 100;
  }

  const basePrice = toNonNegativeNumber(product.base_price ?? item.base_price);
  if (basePrice > 0) {
    return Math.round(basePrice * quantity * 100) / 100;
  }

  const savedEstimate = toNonNegativeNumber(product.estimated_price ?? item.estimated_price);
  if (savedEstimate > 0) {
    return Math.round(savedEstimate * quantity * 100) / 100;
  }

  const unitPrice = toNonNegativeNumber(product.unit_price ?? item.unit_price);
  return Math.round(unitPrice * quantity * 100) / 100;
};

export const getMeasuredProductLineTotal = (product = {}, item = {}) => {
  const method = getPricingMethod(product, item);
  const overridePrice = toNonNegativeNumber(product.estimated_price_override ?? item.estimated_price_override);
  const configuredFixedPrice = toNonNegativeNumber(product.base_price ?? item.base_price)
    || toNonNegativeNumber(product.estimated_price ?? item.estimated_price)
    || toNonNegativeNumber(product.unit_price ?? item.unit_price);
  const measuredPrice = overridePrice || configuredFixedPrice;
  const width = Number(item.width ?? item.dimensions?.width) || 0;
  const height = Number(item.height ?? item.dimensions?.height) || 0;
  const productWidth = Number(product.width) || 0;
  const productHeight = Number(product.height) || 0;

  if (!measuredPrice || width <= 0 || height <= 0) {
    return getProductLineTotal(product, item);
  }

  const itemUnit = item.measurement_unit || item.measurementUnit || item.dimensions?.unit || product.measurement_unit || "in";
  const productUnit = product.measurement_unit || "in";
  const measuredArea = toSquareFeet(width, height, itemUnit);
  const standardArea = productWidth > 0 && productHeight > 0
    ? toSquareFeet(productWidth, productHeight, productUnit)
    : toNonNegativeNumber(product.estimated_area);
  const isMeasuredOverride = ["sqft", "per_sqft"].includes(method);
  const isDimensionedFixedPrice = method === "fixed" && standardArea > 0;

  if (!isMeasuredOverride && !isDimensionedFixedPrice) {
    return getProductLineTotal(product, item);
  }

  if (standardArea > 0 && Math.abs(measuredArea - standardArea) <= 0.01) {
    return getProductLineTotal(product, item);
  }

  if (isDimensionedFixedPrice) {
    const quantity = getQuantity(item);
    return Math.round((measuredPrice * measuredArea / standardArea * quantity) * 100) / 100;
  }

  return getProductLineTotal(
    { ...product, estimated_price_override: 0 },
    { ...item, estimated_price_override: 0 },
  );
};

export const buildProductPriceSnapshot = (product, item) => {
  const lineTotal = getProductLineTotal(product, item);
  const method = getPricingMethod(product, item);
  const unitPrice = method === "sqft"
    ? toNonNegativeNumber(product.price_per_sqft)
    : method === "blade"
      ? toNonNegativeNumber(product.price_per_blade)
      : toNonNegativeNumber(product.base_price || product.estimated_price || product.unit_price);

  return {
    pricing_method: method,
    unit_price: unitPrice,
    price_per_sqft: toNonNegativeNumber(product.price_per_sqft),
    price_per_blade: toNonNegativeNumber(product.price_per_blade),
    base_price: toNonNegativeNumber(product.base_price),
    blade_count: toNonNegativeNumber(product.blade_count),
    estimated_price_override: toNonNegativeNumber(product.estimated_price_override),
    line_total: lineTotal,
  };
};