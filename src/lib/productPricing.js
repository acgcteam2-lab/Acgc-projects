import { toSquareFeet } from "./estimator.js";

const toNonNegativeNumber = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(amount, 0) : 0;
};

const getQuantity = (item = {}) =>
  Math.max(1, Number(item.quantity ?? item.dimensions?.quantity) || 1);

export const getDefaultExtraChargeSelections = (product = {}) => (
  (Array.isArray(product.extra_charges) ? product.extra_charges : []).map((charge) => ({
    ...charge,
    is_selected: charge?.is_optional === true ? charge.is_default_selected !== false : true,
  }))
);

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

const getBladePricing = (product = {}, item = {}) => {
  const glassTypes = Array.isArray(product.blade_glass_types) ? product.blade_glass_types : [];
  const frameTypes = Array.isArray(product.blade_frame_types) ? product.blade_frame_types : [];
  const glassName = item.blade_glass_type || product.default_blade_glass_type || glassTypes[0]?.name || "";
  const glassType = glassTypes.find((glass) => String(glass.name).toLowerCase() === String(glassName).toLowerCase());
  const saleMode = item.sale_mode || product.default_sale_mode || "blades_only";
  const frameName = item.frame_type || product.default_frame_type || "";
  const frameType = frameTypes.find((frame) => String(frame.name).toLowerCase() === String(frameName).toLowerCase());
  const configuredBladeCount = Number(item.blade_count) || Number(frameType?.blade_count) || Number(product.blade_count) || Number(product.minimum_blades) || 0;
  const bladeCount = Math.max(0, configuredBladeCount);
  const bladeRate = toNonNegativeNumber(glassType?.price_per_blade ?? product.price_per_blade ?? item.price_per_blade);
  const framePrice = saleMode === "frame"
    ? toNonNegativeNumber(item.frame_price ?? (item.custom_frame_size ? product.custom_frame_price : frameType?.price))
    : 0;

  return { glassTypes, frameTypes, glassName, saleMode, frameName, frameType, bladeCount, bladeRate, framePrice };
};

export const getProductLineTotal = (product = {}, item = {}) => {
  const quantity = getQuantity(item);
  const method = getPricingMethod(product, item);
  const bladePricing = method === "blade" ? getBladePricing(product, item) : null;
  const usesConfiguredBladePricing = Boolean(bladePricing && (bladePricing.glassTypes.length || bladePricing.frameTypes.length));
  const overridePrice = usesConfiguredBladePricing ? 0 : toNonNegativeNumber(
    product.estimated_price_override ?? item.estimated_price_override,
  );

  const unit = item.measurement_unit || item.measurementUnit || item.dimensions?.unit || product.measurement_unit || "in";
  const width = Number(item.width ?? item.dimensions?.width ?? product.width) || 0;
  const height = Number(item.height ?? item.dimensions?.height ?? product.height) || 0;
  let subtotal = overridePrice > 0 ? overridePrice * quantity : 0;

  if (overridePrice <= 0 && (method === "sqft" || method === "per_sqft")) {
    const rate = toNonNegativeNumber(product.price_per_sqft ?? item.price_per_sqft);
    if (rate > 0 && width > 0 && height > 0) {
      const areaPerUnit = toSquareFeet(width, height, unit);
      subtotal = areaPerUnit * rate * quantity;
    }
  }

  if (overridePrice <= 0 && (method === "blade" || method === "per_blade")) {
    const rate = bladePricing?.bladeRate ?? toNonNegativeNumber(product.price_per_blade ?? item.price_per_blade);
    const bladesPerUnit = bladePricing?.bladeCount ?? toNonNegativeNumber(product.blade_count ?? item.blade_count);
    if (rate > 0 && bladesPerUnit > 0) {
      subtotal = (rate * bladesPerUnit + (bladePricing?.framePrice || 0)) * quantity;
    }
  }

  if (overridePrice <= 0 && ["fixed", "per_piece", "per_set", "per_meter", "piece", "set", "meter"].includes(method)) {
    const savedEstimate = toNonNegativeNumber(product.estimated_price ?? item.estimated_price);
    const basePrice = toNonNegativeNumber(product.base_price ?? item.base_price);
    const fixedPrice = basePrice || savedEstimate || toNonNegativeNumber(product.unit_price ?? item.unit_price);
    subtotal = fixedPrice * quantity;
  }

  if (subtotal <= 0) {
    const basePrice = toNonNegativeNumber(product.base_price ?? item.base_price);
    if (basePrice > 0) subtotal = basePrice * quantity;
  }

  if (subtotal <= 0) {
    const savedEstimate = toNonNegativeNumber(product.estimated_price ?? item.estimated_price);
    if (savedEstimate > 0) subtotal = savedEstimate * quantity;
  }

  if (subtotal <= 0) {
    subtotal = toNonNegativeNumber(product.unit_price ?? item.unit_price) * quantity;
  }

  const areaPerUnit = width > 0 && height > 0 ? toSquareFeet(width, height, unit) : 0;
  const configuredCharges = Array.isArray(product.extra_charges ?? item.extra_charges)
    ? product.extra_charges ?? item.extra_charges
    : [];
  const itemCharges = Array.isArray(item.extra_charges) ? item.extra_charges : [];
  const charges = configuredCharges.map((charge, index) => ({
    ...charge,
    ...(itemCharges[index] || {}),
    is_optional: charge?.is_optional,
    is_active: charge?.is_active,
    type: itemCharges[index]?.type || charge?.type,
    label: itemCharges[index]?.label || charge?.label,
    name: itemCharges[index]?.name || charge?.name,
  })).filter((charge, index) => {
    if (charge?.is_active === false) return false;
    if (charge?.is_optional !== true) return true;
    const isSelected = itemCharges[index]?.is_selected;
    return typeof isSelected === "boolean" ? isSelected : charge.is_default_selected !== false;
  });
  const additionalCharges = charges.reduce((total, charge) => {
    const amount = toNonNegativeNumber(charge.amount);
    if (charge.type === "percentage") return total + subtotal * amount / 100;
    if (charge.type === "per_sqft") return total + areaPerUnit * amount * quantity;
    if (charge.type === "per_blade") return total + (bladePricing?.bladeCount || 0) * amount * quantity;
    return total + amount * quantity;
  }, 0);
  const legacyCustomizationFee = overridePrice <= 0 && ["sqft", "per_sqft"].includes(method) && product.customization && item.customized
    ? toNonNegativeNumber(product.customization_fee ?? item.customization_fee)
    : 0;

  return Math.round((subtotal + additionalCharges + legacyCustomizationFee) * 100) / 100;
};

export const getProductSizeLimitWarnings = (product = {}, item = {}) => {
  const limits = product.size_limits || item.size_limits;
  if (!limits) return [];

  const itemUnit = item.measurement_unit || item.measurementUnit || item.dimensions?.unit || product.measurement_unit || "in";
  const limitUnit = limits.unit || product.measurement_unit || "in";
  const itemWidth = Number(item.width ?? item.dimensions?.width);
  const itemHeight = Number(item.height ?? item.dimensions?.height);
  if (!(itemWidth > 0) || !(itemHeight > 0)) return [];

  const toInchesFactor = { in: 1, ft: 12, cm: 1 / 2.54, m: 100 / 2.54 };
  const itemFactor = toInchesFactor[itemUnit] || 1;
  const limitFactor = toInchesFactor[limitUnit] || 1;
  const dimensions = [
    ["Width", itemWidth * itemFactor, "min_width", "max_width"],
    ["Height", itemHeight * itemFactor, "min_height", "max_height"],
  ];

  return dimensions.flatMap(([label, valueInches, minKey, maxKey]) => {
    const warnings = [];
    const minimum = Number(limits[minKey]);
    const maximum = Number(limits[maxKey]);
    if (minimum > 0 && valueInches < minimum * limitFactor) {
      warnings.push(`${label} is below the ${minimum} ${limitUnit} minimum.`);
    }
    if (maximum > 0 && valueInches > maximum * limitFactor) {
      warnings.push(`${label} is above the ${maximum} ${limitUnit} maximum.`);
    }
    return warnings;
  });
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
    const scaledUnitPrice = measuredPrice * measuredArea / standardArea;
    return getProductLineTotal({
      ...product,
      base_price: scaledUnitPrice,
      unit_price: scaledUnitPrice,
      estimated_price: scaledUnitPrice,
      estimated_price_override: 0,
    }, { ...item, quantity });
  }

  return getProductLineTotal(
    { ...product, estimated_price_override: 0 },
    { ...item, estimated_price_override: 0 },
  );
};

export const buildProductPriceSnapshot = (product, item) => {
  const lineTotal = getProductLineTotal(product, item);
  const method = getPricingMethod(product, item);
  const bladePricing = method === "blade" ? getBladePricing(product, item) : null;
  const defaultExtraCharges = getDefaultExtraChargeSelections({
    extra_charges: product.extra_charges ?? item.extra_charges,
  });
  const extraCharges = defaultExtraCharges.map((charge, index) => ({
    ...charge,
    is_selected: typeof item.extra_charges?.[index]?.is_selected === "boolean"
      ? item.extra_charges[index].is_selected
      : charge.is_selected,
  }));
  const unitPrice = method === "sqft"
    ? toNonNegativeNumber(product.price_per_sqft)
    : method === "blade"
      ? bladePricing.bladeRate
      : toNonNegativeNumber(product.base_price || product.estimated_price || product.unit_price);

  return {
    pricing_method: method,
    unit_price: unitPrice,
    price_per_sqft: toNonNegativeNumber(product.price_per_sqft),
    price_per_blade: toNonNegativeNumber(product.price_per_blade),
    base_price: toNonNegativeNumber(product.base_price),
    blade_count: toNonNegativeNumber(item.blade_count ?? product.blade_count),
    blade_glass_type: item.blade_glass_type || product.default_blade_glass_type || "",
    sale_mode: item.sale_mode || product.default_sale_mode || "blades_only",
    frame_type: item.frame_type || product.default_frame_type || "",
    frame_price: bladePricing?.framePrice || 0,
    blade_glass_types: Array.isArray(product.blade_glass_types) ? product.blade_glass_types : [],
    sell_blades_only: product.sell_blades_only !== false,
    sell_with_frame: Boolean(product.sell_with_frame),
    blade_frame_types: Array.isArray(product.blade_frame_types) ? product.blade_frame_types : [],
    allow_custom_frame_size: Boolean(product.allow_custom_frame_size),
    custom_frame_size_unit: product.custom_frame_size_unit || product.measurement_unit || item.measurement_unit || "in",
    custom_frame_price: toNonNegativeNumber(product.custom_frame_price),
    minimum_blades: Math.max(1, Number(product.minimum_blades) || 1),
    maximum_blades: toNonNegativeNumber(product.maximum_blades),
    customer_can_choose_blade_count: Boolean(product.customer_can_choose_blade_count),
    default_blade_glass_type: product.default_blade_glass_type || "",
    default_sale_mode: product.default_sale_mode || "blades_only",
    default_frame_type: product.default_frame_type || "",
    show_price_per_blade: product.show_price_per_blade !== false,
    estimated_price_override: toNonNegativeNumber(product.estimated_price_override),
    customization: Boolean(product.customization),
    customization_fee: toNonNegativeNumber(product.customization_fee),
    extra_charges: extraCharges,
    size_limits: product.size_limits || {},
    line_total: lineTotal,
  };
};
