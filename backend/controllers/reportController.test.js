import { describe, it } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { buildReportOrderQuery } from "./reportController.js";
import { validateTransactionReportFilters } from "../services/transactionWorkbook.js";

describe("transaction report database query", () => {
  it("pushes category dates, customer, and search into an unpaginated order query", async () => {
    const customerId = new mongoose.Types.ObjectId("64b000000000000000000001");
    const filters = validateTransactionReportFilters({
      type: "customer_feedback",
      startDate: "2026-10-14",
      endDate: "2026-10-14",
      startAt: "2026-10-13T16:00:00.000Z",
      endAt: "2026-10-14T15:59:59.999Z",
      projectStatus: "completed",
      paymentStatus: "paid",
      customer: String(customerId),
      search: "Taylor Lee",
    });

    const query = await buildReportOrderQuery(filters, async () => [customerId]);
    const [acceptedClause, dateClause, customerClause, searchClause] = query.$and;
    const acceptedValues = acceptedClause.$or;
    assert.ok(acceptedValues.some((clause) => clause.contract_status?.test("accepted")));
    assert.ok(acceptedValues.some((clause) => clause.contractStatus?.test("Accepted")));
    const dateRanges = dateClause.$or;
    assert.equal(dateRanges.length, 4);
    assert.ok(dateRanges.some((clause) => clause["review.submittedAt"]?.$gte.getTime() === Date.parse("2026-10-13T16:00:00.000Z")));
    assert.ok(dateRanges.every((clause) => clause[Object.keys(clause)[0]].$lte.getTime() === Date.parse("2026-10-14T15:59:59.999Z")));
    assert.equal(String(customerClause.customer), String(customerId));
    assert.ok(searchClause.$or.some((clause) => clause.tracking instanceof RegExp));
    assert.ok(searchClause.$or.some((clause) => clause.customer?.$in?.some((id) => String(id) === String(customerId))));
  });

  it("includes customer-name fallbacks and all category date fields for All Reports", async () => {
    const customerId = new mongoose.Types.ObjectId("64b000000000000000000002");
    const filters = validateTransactionReportFilters({
      type: "all_reports",
      startDate: "2026-10-14",
      endDate: "2026-10-14",
      customer: "name:Taylor Lee",
    });

    const query = await buildReportOrderQuery(filters, async () => [customerId]);
    const dateFields = query.$and[1].$or.map((clause) => Object.keys(clause)[0]);
    assert.ok(dateFields.includes("transactionCreatedAt"));
    assert.ok(dateFields.includes("items.review.submittedAt"));
    assert.ok(dateFields.includes("payment_records.payment_date"));
    assert.ok(dateFields.includes("items.warranty_start_date"));
    const customerMatch = query.$and[2].$or;
    assert.ok(customerMatch.some((clause) => clause.customer_name instanceof RegExp));
    assert.ok(customerMatch.some((clause) => clause.customer?.$in?.some((id) => String(id) === String(customerId))));
  });
});