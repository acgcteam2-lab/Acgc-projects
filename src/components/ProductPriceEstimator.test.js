import { describe, expect, it } from "vitest";
import { getProductEstimatorState } from "./ProductPriceEstimator";

const product = {
  pricing_method: "blade",
  minimum_blades: 1,
  maximum_blades: 12,
  blade_glass_types: [{ name: "Clear", price_per_blade: 100 }],
  blade_frame_types: [{ name: "Large", blade_count: 8, price: 500 }],
  sell_blades_only: true,
  sell_with_frame: true,
};

const getLargeFrameState = (blade_count) => getProductEstimatorState(product, {
  blade_glass_type: "Clear",
  sale_mode: "frame",
  frame_type: "Large",
  custom_frame_size: false,
  blade_count,
});

describe("getProductEstimatorState blade count validation", () => {
  it("rejects a count below the selected frame minimum", () => {
    const state = getLargeFrameState("7");

    expect(state.bladeCountError).toBe("Minimum for Large frame is 8 blades.");
    expect(state.hasEstimate).toBe(false);
  });

  it("rejects counts above the product maximum", () => {
    expect(getLargeFrameState("13").bladeCountError).toBe("Maximum for Large frame is 12 blades.");
  });

  it("rejects fractional blade counts", () => {
    expect(getLargeFrameState("8.5").bladeCountError).toBe("Enter a whole number of blades.");
  });

  it("allows the optional count to remain empty and uses the frame minimum", () => {
    const state = getLargeFrameState("");

    expect(state.bladeCountError).toBe("");
    expect(state.bladeCount).toBe(8);
    expect(state.hasEstimate).toBe(true);
  });
});