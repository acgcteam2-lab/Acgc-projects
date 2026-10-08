import { describe, expect, it } from "vitest";
import { applyInstallationWarranty, buildWarrantyCoverage } from "../../backend/services/warranty.js";

describe("buildWarrantyCoverage", () => {
  it("starts coverage on installation completion and adds the configured duration", () => {
    const coverage = buildWarrantyCoverage(
      "2026-10-08T14:30:00.000Z",
      "1 year",
      null,
      new Date("2026-10-09T00:00:00.000Z"),
    );

    expect(coverage.warranty_start_date.toISOString()).toBe("2026-10-08T14:30:00.000Z");
    expect(coverage.warranty_expiry_date.toISOString()).toBe("2027-10-08T14:30:00.000Z");
    expect(coverage.warranty_status).toBe("active");
  });

  it("uses custom days and does not activate a no-warranty product", () => {
    expect(buildWarrantyCoverage("2026-10-08", "Custom", 45).warranty_expiry_date.toISOString())
      .toBe("2026-11-22T00:00:00.000Z");
    expect(buildWarrantyCoverage("2026-10-08", "No Warranty")).toEqual({
      warranty_start_date: null,
      warranty_expiry_date: null,
      warranty_status: "no_warranty",
    });
  });

  it("activates a single-item warranty from the completed Installation stage date", () => {
    const order = {
      warranty_period: 90,
      items: [{ warranty_status: "pending" }],
    };

    applyInstallationWarranty(order, [{
      key: "installation",
      completed: true,
      status: "done",
      date: "2026-10-08T14:30:00.000Z",
    }], undefined, new Date("2026-10-09T00:00:00.000Z"));

    expect(order.warranty_start_date.toISOString()).toBe("2026-10-08T14:30:00.000Z");
    expect(order.warranty_expiry_date.toISOString()).toBe("2027-01-06T14:30:00.000Z");
    expect(order.warranty_status).toBe("active");
  });

  it("activates batch item warranty independently when its Installation stage completes", () => {
    const order = {
      warranty_assignment_mode: "per_product",
      items: [
        { warranty_period: "Custom", custom_warranty_days: 45, warranty_status: "pending" },
        { warranty_period: "No Warranty", warranty_status: "pending" },
      ],
    };
    const stage = [{ key: "installation", completed: true, status: "done", date: "2026-10-08T00:00:00.000Z" }];

    applyInstallationWarranty(order, stage, 0);

    expect(order.items[0].warranty_start_date.toISOString()).toBe("2026-10-08T00:00:00.000Z");
    expect(order.items[0].warranty_expiry_date.toISOString()).toBe("2026-11-22T00:00:00.000Z");
    expect(order.items[1].warranty_status).toBe("pending");
    expect(order.warranty_status).toBe("pending");

    applyInstallationWarranty(order, [{
      key: "installation",
      completed: true,
      status: "done",
      date: "2026-10-09T00:00:00.000Z",
    }], 1);

    expect(order.items[0].warranty_status).toBe("active");
    expect(order.items[1].warranty_status).toBe("no_warranty");
    expect(order.warranty_status).toBe("active");
  });
});