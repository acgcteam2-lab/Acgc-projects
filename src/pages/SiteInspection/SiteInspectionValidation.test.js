import { describe, expect, it } from "vitest";
import {
  isSiteInspectionVisible,
  getInspectionDisplayTotal,
  isOnlineCustomerInspection,
  buildWarrantyPayload,
  calculateWarrantyExpiry,
  calculateMeasurementArea,
  calculateMeasurementSubtotal,
  getWarrantyPeriodDays,
  normalizeWalkInWebsiteAccountState,
  normalizeWarrantyPeriodValue,
  validateInspectionPayload,
  resolveInspectionProductPrice,
} from "./SiteInspection";
import { buildOrderTimelineStages } from "@/lib/orderTimeline";

describe("isSiteInspectionVisible", () => {
  it("includes walk-in and no-account records while they are still pending", () => {
    expect(
      isSiteInspectionVisible({
        status: "site_inspection",
        contract_status: "",
      })
    ).toBe(true);

    expect(
      isSiteInspectionVisible({
        status: "site_inspection",
        contract_status: "pending",
      })
    ).toBe(true);

    expect(isSiteInspectionVisible({ status: "site_inspection", contract_status: "sent" })).toBe(true);
    expect(isSiteInspectionVisible({ status: "site_inspection", contract_status: "declined" })).toBe(true);

    expect(
      isSiteInspectionVisible({
        status: "contract_accepted",
        contract_status: "accepted",
      })
    ).toBe(false);
  });
});

describe("normalizeWalkInWebsiteAccountState", () => {
  it("keeps walk-in inspection records aligned with the no-account default", () => {
    expect(
      normalizeWalkInWebsiteAccountState({
        order_type: "walk_in_customer",
        has_account_on_website: true,
      })
    ).toBe(false);

    expect(
      normalizeWalkInWebsiteAccountState({
        customerType: "walk-in",
        has_account_on_website: true,
      })
    ).toBe(false);

    expect(
      normalizeWalkInWebsiteAccountState({
        order_type: "online_order",
        has_account_on_website: true,
      })
    ).toBe(true);
  });
});

describe("isOnlineCustomerInspection", () => {
  it("recognizes a populated registered customer relationship", () => {
    expect(isOnlineCustomerInspection({ customer: { _id: "user-123" } })).toBe(true);
    expect(isOnlineCustomerInspection({ userId: "user-123" })).toBe(true);
  });

  it("does not infer an account from manually entered contact details", () => {
    expect(isOnlineCustomerInspection({
      customer_name: "Ana Cruz",
      customer_email: "ana@example.com",
      customer_phone: "09171234567",
      order_type: "walk_in_customer",
    })).toBe(false);
  });

  it("recognizes an explicitly classified online customer", () => {
    expect(isOnlineCustomerInspection({ customerType: "Online Customer" })).toBe(true);
  });
});

describe("walk-in account linking validation", () => {
  const validWalkInPayload = {
    customerName: "John Doe",
    phone: "09123456789",
    siteAddress: "1 Main Street",
    inspection_date: "2026-10-10",
    order_type: "walk_in_customer",
    items: [{ product_id: "p-1", name: "Sliding Window", width: 120, height: 150, qty: 1 }],
  };

  it("requires selecting an account when a walk-in is marked as having one", () => {
    const errors = validateInspectionPayload({
      ...validWalkInPayload,
      has_account_on_website: true,
    });

    expect(errors.customerId).toMatch(/Select the matching registered customer account/);
  });

  it("accepts an existing customer ID without changing the walk-in order type", () => {
    expect(validateInspectionPayload({
      ...validWalkInPayload,
      customerId: "customer-123",
      has_account_on_website: true,
    })).toEqual({});
  });

  it("allows creating a walk-in inspection before the signed contract is approved", () => {
    expect(validateInspectionPayload(validWalkInPayload)).toEqual({});
  });
});

describe("getInspectionDisplayTotal", () => {
  it("prefers the manual override over stored and calculated totals", () => {
    expect(getInspectionDisplayTotal({ manual_override: 1250, total_amount: 900 }, 800)).toBe(1250);
  });

  it("uses the saved order total when no manual override is present", () => {
    expect(getInspectionDisplayTotal({ manual_override: 0, total_amount: 900 }, 800)).toBe(900);
  });

  it("falls back to item totals when no saved total is available", () => {
    expect(getInspectionDisplayTotal({}, 800)).toBe(800);
  });
});

describe("contract workflow timeline", () => {
  it("keeps the inspection incomplete while a sent contract awaits a response", () => {
    const stages = buildOrderTimelineStages({
      status: "site_inspection",
      contract_status: "sent",
      contractGenerated: true,
      contract_terms: "Terms",
      inspection_status: "scheduled",
    });

    expect(stages.find((stage) => stage.key === "site_inspection_completed").status).toBe("pending");
    expect(stages.find((stage) => stage.key === "contract_created").status).toBe("completed");
    expect(stages.find((stage) => stage.key === "contract_sent").label).toBe("Contract Sent to Customer");
    expect(stages.find((stage) => stage.key === "contract_sent").status).toBe("completed");
  });

  it("completes the inspection and acceptance stages after online signing", () => {
    const stages = buildOrderTimelineStages({
      status: "contract_accepted",
      contract_status: "accepted",
      acceptedByCustomer: true,
      acceptedAt: "2026-09-26T10:00:00.000Z",
      inspection_status: "completed",
      inspection_completed_at: "2026-09-26T10:00:00.000Z",
    });

    expect(stages.find((stage) => stage.key === "site_inspection_completed").label).toBe("Site Inspection Completed");
    expect(stages.find((stage) => stage.key === "site_inspection_completed").status).toBe("completed");
    expect(stages.find((stage) => stage.key === "contract_accepted").status).toBe("completed");
  });

  it("shows the customer's decline reason in the timeline", () => {
    const stages = buildOrderTimelineStages({
      status: "site_inspection",
      contract_status: "declined",
      contractSentAt: "2026-09-25T10:00:00.000Z",
      contractDeclineReason: "Please revise the payment schedule.",
    });
    const declinedStage = stages.find((stage) => stage.key === "contract_declined");

    expect(declinedStage.status).toBe("completed");
    expect(declinedStage.notes).toBe("Please revise the payment schedule.");
    expect(stages.find((stage) => stage.key === "contract_sent").date).not.toBe("—");
  });
});

describe("normalizeWarrantyPeriodValue", () => {
  it("keeps the standard 30-day and 90-day warranty options as valid numeric values", () => {
    expect(normalizeWarrantyPeriodValue(30)).toBe(30);
    expect(normalizeWarrantyPeriodValue(90)).toBe(90);
    expect(normalizeWarrantyPeriodValue("90")).toBe(90);
    expect(normalizeWarrantyPeriodValue("90 days")).toBe(90);
  });

  it("preserves no-warranty and custom warranty selections", () => {
    expect(normalizeWarrantyPeriodValue("No Warranty")).toBe("No Warranty");
    expect(normalizeWarrantyPeriodValue("Custom")).toBe("Custom");
    expect(normalizeWarrantyPeriodValue(45)).toBe("Custom");
    expect(normalizeWarrantyPeriodValue(0)).toBe(90);
  });
});

describe("per-product custom warranty duration", () => {
  it("restores stored custom-day values and calculates expiry from them", () => {
    expect(getWarrantyPeriodDays("365 days")).toBe(365);
    expect(getWarrantyPeriodDays("1 year")).toBe(365);
    expect(getWarrantyPeriodDays(1000)).toBe(1000);
    expect(calculateWarrantyExpiry("2026-10-04", "Custom", 365)).toBe("2027-10-04T00:00:00.000Z");
    expect(calculateWarrantyExpiry("2026-10-04", "365 days", 365)).toBe("2027-10-04T00:00:00.000Z");
    const expiry = new Date(calculateWarrantyExpiry("2026-10-04", "Custom", 1000));
    expect((expiry.getTime() - new Date("2026-10-04T00:00:00.000Z").getTime()) / 86400000).toBe(1000);
  });
});

describe("inspection measurement calculations", () => {
  it("recalculates row area when dimensions or quantity change", () => {
    expect(calculateMeasurementArea(48, 24, 1)).toBe(8);
    expect(calculateMeasurementArea(72, 36, 2)).toBe(36);
  });

  it("uses quantity-inclusive area once for square-foot and fallback pricing", () => {
    const item = {
      width: 72,
      height: 36,
      quantity: 2,
      area: calculateMeasurementArea(72, 36, 2),
      unit_price: 100,
    };

    expect(calculateMeasurementSubtotal(item, {
      pricing_method: "sqft",
      price_per_sqft: 100,
    })).toBe(3600);
    expect(calculateMeasurementSubtotal(item)).toBe(3600);
  });
});

describe("resolveInspectionProductPrice", () => {
  it("uses the product pricing method instead of a stale generic unit price", () => {
    expect(resolveInspectionProductPrice({
      pricing_method: "sqft",
      unit_price: 500,
      price_per_sqft: 180,
      base_price: 1500,
      width: 48,
      height: 72,
    })).toMatchObject({
      unit_price: 180,
      pricing_method: "sqft",
      width: 48,
      height: 72,
    });

    expect(resolveInspectionProductPrice({
      pricing_method: "fixed",
      unit_price: 500,
      base_price: 1500,
      width: 36,
      height: 48,
    })).toMatchObject({
      unit_price: 1500,
      pricing_method: "fixed",
      width: 36,
      height: 48,
    });
  });
});

describe("buildWarrantyPayload", () => {
  it("preserves No Warranty instead of converting it to the 90-day default", () => {
    expect(buildWarrantyPayload("No Warranty", 90)).toEqual({
      warranty_period: "No Warranty",
      custom_warranty_days: null,
    });
  });
});
