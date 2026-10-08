import { describe, expect, it } from "vitest";
import {
  calculateRequiredDownpayment,
  getFinalProjectCost,
  getRequiredDownpayment,
} from "./orderPricing";

describe("order pricing source of truth", () => {
  it("prefers the approved manual override over stored estimate totals", () => {
    expect(getFinalProjectCost({
      manual_override: 120000,
      final_project_cost: 100000,
      contract_amount: 100000,
      total_amount: 100000,
    })).toBe(120000);
  });

  it("uses the saved final cost and falls back to legacy totals", () => {
    expect(getFinalProjectCost({ final_project_cost: 120000, total_amount: 100000 })).toBe(120000);
    expect(getFinalProjectCost({ contract_amount: 110000, total_amount: 100000 })).toBe(110000);
    expect(getFinalProjectCost({ total_amount: 100000 })).toBe(100000);
    expect(getFinalProjectCost({ totalAmount: 90000 })).toBe(90000);
    expect(getFinalProjectCost({ total: 80000 })).toBe(80000);
  });

  it("recalculates the configured percentage and full-payment requirements from final cost", () => {
    expect(getRequiredDownpayment({
      manual_override: 120000,
      total_amount: 100000,
      payment_terms: "50%_down_payment",
      required_downpayment_amount: 50000,
    })).toBe(60000);
    expect(calculateRequiredDownpayment(120000, "full_payment", 50000)).toBe(120000);
  });

  it("preserves an explicitly configured fixed downpayment for other terms", () => {
    expect(calculateRequiredDownpayment(120000, "custom_arrangement", 30000)).toBe(30000);
  });
});
