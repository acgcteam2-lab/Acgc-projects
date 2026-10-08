import { describe, expect, it } from "vitest";
import { buildProductPriceSnapshot, getMeasuredProductLineTotal, getProductLineTotal, getProductSizeLimitWarnings } from "./productPricing";

describe("getProductLineTotal", () => {
  it("uses the admin square-foot rate, dimensions, and quantity", () => {
    expect(getProductLineTotal(
      { pricing_method: "sqft", price_per_sqft: 125 },
      { width: 36, height: 48, measurement_unit: "in", quantity: 2 },
    )).toBe(3000);
  });

  it("uses the admin blade rate and blade count", () => {
    expect(getProductLineTotal(
      { pricing_method: "blade", price_per_blade: 100, blade_count: 6 },
      { quantity: 2 },
    )).toBe(1200);
  });

  it("uses the admin base price for fixed products", () => {
    expect(getProductLineTotal(
      { pricing_method: "fixed", base_price: 500 },
      { quantity: 3 },
    )).toBe(1500);
  });

  it("prefers the admin base price over a stale catalog estimate for fixed products", () => {
    expect(getProductLineTotal(
      { pricing_method: "fixed", base_price: 500, estimated_price: 900 },
      { quantity: 2 },
    )).toBe(1000);
  });

  it("uses the admin estimated-cost override as the per-product quote", () => {
    expect(getProductLineTotal(
      { pricing_method: "sqft", estimated_price_override: 2400, price_per_sqft: 300 },
      { width: 48, height: 48, quantity: 2 },
    )).toBe(4800);
  });

  it("keeps legacy per-piece products fixed even when a rate field is present", () => {
    expect(getProductLineTotal(
      { unit: "per_piece", unit_price: 750, price_per_sqft: 300 },
      { width: 36, height: 48, measurement_unit: "in", quantity: 2 },
    )).toBe(1500);
  });

  it("adds fixed, per-area, and percentage charges to the base estimate", () => {
    expect(getProductLineTotal(
      {
        pricing_method: "sqft",
        price_per_sqft: 100,
        extra_charges: [
          { name: "Installation", type: "per_sqft", amount: 20 },
          { name: "Rush", type: "percentage", amount: 10 },
          { name: "Delivery", type: "fixed", amount: 50 },
        ],
      },
      { width: 36, height: 48, measurement_unit: "in", quantity: 2 },
    )).toBe(3220);
  });

  it("adds configured charges to an estimated-price override", () => {
    expect(getProductLineTotal(
      { pricing_method: "fixed", estimated_price_override: 1000, extra_charges: [{ name: "Install", type: "fixed", amount: 100 }] },
      { quantity: 2 },
    )).toBe(2200);
  });

  it("includes optional charges by default unless configured otherwise", () => {
    expect(getProductLineTotal(
      {
        pricing_method: "fixed",
        base_price: 1000,
        extra_charges: [
          { name: "Install", type: "fixed", amount: 100 },
          { name: "Rush", type: "fixed", amount: 50, is_optional: true, is_default_selected: false },
        ],
      },
      {},
    )).toBe(1100);
  });

  it("uses a customer's optional-charge selections in the total", () => {
    expect(getProductLineTotal(
      {
        pricing_method: "fixed",
        base_price: 1000,
        extra_charges: [
          { name: "Install", type: "fixed", amount: 100 },
          { name: "Rush", type: "fixed", amount: 50, is_optional: true, is_default_selected: true },
        ],
      },
      { extra_charges: [{ is_selected: true }, { is_selected: false }] },
    )).toBe(1100);
  });

  it("includes default-selected charges in a blade-and-frame estimate", () => {
    expect(getProductLineTotal(
      {
        pricing_method: "blade",
        blade_glass_types: [{ name: "Reflective", price_per_blade: 100 }],
        blade_frame_types: [{ name: "Large", blade_count: 8, price: 500 }],
        default_sale_mode: "frame",
        default_frame_type: "Large",
        extra_charges: [
          { name: "Additional frame", type: "fixed", amount: 250, is_optional: true, is_default_selected: true },
          { name: "Rush", type: "fixed", amount: 500, is_optional: true, is_default_selected: true },
        ],
      },
      {
        blade_glass_type: "Reflective",
        sale_mode: "frame",
        frame_type: "Large",
        blade_count: 8,
      },
    )).toBe(2050);
  });

  it("adds configured charges to a resized fixed-price product", () => {
    expect(getMeasuredProductLineTotal(
      {
        pricing_method: "fixed",
        base_price: 1000,
        width: 24,
        height: 24,
        measurement_unit: "in",
        extra_charges: [{ name: "Install", type: "fixed", amount: 100 }],
      },
      { width: 48, height: 24, measurement_unit: "in", quantity: 1 },
    )).toBe(2100);
  });

  it("prices configured glass, frame, and per-blade charges together", () => {
    expect(getProductLineTotal(
      {
        pricing_method: "blade",
        blade_glass_types: [{ name: "Clear", price_per_blade: 50 }],
        blade_frame_types: [{ name: "Small", blade_count: 3, price: 200 }],
        extra_charges: [
          { name: "Install", type: "per_blade", amount: 10 },
          { name: "Rush", type: "percentage", amount: 10 },
        ],
      },
      { blade_glass_type: "Clear", sale_mode: "frame", frame_type: "Small", blade_count: 3, quantity: 2 },
    )).toBe(830);
  });
});

describe("getProductSizeLimitWarnings", () => {
  it("warns when inspection dimensions exceed catalog limits across units", () => {
    expect(getProductSizeLimitWarnings(
      { size_limits: { min_width: 24, max_width: 48, min_height: 30, max_height: 80, unit: "in" } },
      { width: 5, height: 250, measurement_unit: "cm" },
    )).toEqual([
      "Width is below the 24 in minimum.",
      "Height is above the 80 in maximum.",
    ]);
  });
});

describe("buildProductPriceSnapshot", () => {
  it("preserves the admin price fields and exact calculated line total", () => {
    expect(buildProductPriceSnapshot(
      { pricing_method: "sqft", price_per_sqft: 125, unit_price: 500 },
      { width: 36, height: 48, measurement_unit: "in", quantity: 2 },
    )).toMatchObject({
      pricing_method: "sqft",
      unit_price: 125,
      price_per_sqft: 125,
      line_total: 3000,
    });
  });

  it("preserves optional-charge selections in order price snapshots", () => {
    expect(buildProductPriceSnapshot(
      {
        pricing_method: "fixed",
        base_price: 1000,
        extra_charges: [{ name: "Rush", type: "fixed", amount: 50, is_optional: true }],
      },
      { quantity: 1, extra_charges: [{ is_selected: false }] },
    )).toMatchObject({
      extra_charges: [{ name: "Rush", is_optional: true, is_selected: false }],
      line_total: 1000,
    });
  });
});