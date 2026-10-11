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
});