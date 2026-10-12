import { describe, expect, it } from "vitest";
import { isProgressMonitorEligibleOrder } from "./orderWorkflow";

describe("isProgressMonitorEligibleOrder", () => {
  it("keeps a customer-accepted contract in Transactions until an admin approves it", () => {
    expect(isProgressMonitorEligibleOrder({
      status: "contract_accepted",
      contract_status: "accepted",
      acceptedByCustomer: true,
      transaction_approved: false,
    })).toBe(false);
  });

  it("admits a transaction after approval while retaining existing admin review projects", () => {
    expect(isProgressMonitorEligibleOrder({ status: "approved", transaction_approved: true })).toBe(true);
    expect(isProgressMonitorEligibleOrder({ status: "admin_review" })).toBe(true);
  });

  it("shows saved active production stages even when the coarse order status is site inspection", () => {
    expect(isProgressMonitorEligibleOrder({
      status: "site_inspection",
      contract_status: "accepted",
      transaction_approved: false,
      progress_stages: [
        { key: "cutting", status: "done", completed: true },
        { key: "fabrication", status: "done", completed: true },
        { key: "installation", status: "pending", completed: false },
      ],
    })).toBe(true);
  });

  it("includes batch rows when an item's saved stage is active", () => {
    expect(isProgressMonitorEligibleOrder({
      status: "site_inspection",
      items: [{ progress_stages: [{ key: "installation", status: "in_progress" }] }],
    })).toBe(true);
  });

  it("continues excluding unapproved accepted contracts with no saved progress", () => {
    expect(isProgressMonitorEligibleOrder({
      status: "contract_accepted",
      contract_status: "accepted",
      transaction_approved: false,
      progress_stages: [{ key: "installation", status: "pending", completed: false }],
    })).toBe(false);
  });
});