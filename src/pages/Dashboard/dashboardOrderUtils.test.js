import { describe, expect, it } from "vitest";
import { isUntransferredSiteInspection } from "./dashboardOrderUtils";

describe("isUntransferredSiteInspection", () => {
  it("includes active site inspections that have not entered Transactions", () => {
    expect(isUntransferredSiteInspection({ status: "site_inspection", contract_status: "pending" })).toBe(true);
    expect(isUntransferredSiteInspection({ status: "site_inspection" })).toBe(true);
  });

  it("excludes records that have left the site-inspection workflow", () => {
    expect(isUntransferredSiteInspection({ status: "site_inspection", transactionCreated: true })).toBe(false);
    expect(isUntransferredSiteInspection({ status: "site_inspection", contractStatus: "accepted" })).toBe(false);
    expect(isUntransferredSiteInspection({ status: "contract_accepted" })).toBe(false);
  });
});