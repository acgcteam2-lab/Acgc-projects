import { describe, it } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  createTransactionReportWorkbookBuffer,
  createTransactionWorkbookBuffer,
  validateTransactionReportFilters,
} from "./transactionWorkbook.js";

const acceptedOrder = (overrides = {}) => ({
  contract_status: "accepted",
  acceptance_method: "online",
  acceptedByCustomer: true,
  status: "processing",
  transactionCreatedAt: new Date(2026, 8, 29, 12),
  customer_name: "Austine Lee",
  items: [{ name: "Sliding Window" }],
  total_amount: 16000,
  amount_paid: 0,
  ...overrides,
});

describe("transaction backup workbook", () => {
  it("writes overview totals and monthly transaction details", async () => {
    const workbookBuffer = await createTransactionWorkbookBuffer([
      acceptedOrder(),
      acceptedOrder({ amount_paid: 16000, total_amount: 16000, customer_name: "Customer Two" }),
      acceptedOrder({ status: "cancelled", amount_paid: 9000 }),
    ]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(workbookBuffer);

    const overview = workbook.getWorksheet("Overview");
    const september = workbook.getWorksheet("September 2026");
    assert.ok(overview);
    assert.ok(september);
    assert.deepEqual(overview.getRow(1).values.slice(1), ["Month", "Transactions", "Total Paid"]);
    assert.deepEqual(overview.getRow(2).values.slice(1), ["September 2026", 2, 16000]);
    assert.deepEqual(september.getRow(1).values.slice(1), [
      "Date",
      "Client",
      "Project / Product",
      "Amount Paid",
      "Total Amount",
      "Balance",
      "Status",
    ]);
    assert.equal(september.getRow(2).getCell(2).value, "Austine Lee");
    assert.equal(september.getRow(2).getCell(4).value, 0);
    assert.equal(september.getRow(2).getCell(5).value, 16000);
    assert.equal(september.getRow(2).getCell(6).value, 16000);
    assert.equal(september.getRow(2).getCell(7).value, "Pending");
    assert.equal(september.rowCount, 3);
  });

  it("resolves linked customer names and creates an empty overview when needed", async () => {
    const workbookBuffer = await createTransactionWorkbookBuffer(
      [acceptedOrder({ customer_name: "", customer: "customer-id" })],
      [{ _id: "customer-id", first_name: "Alex", last_name: "Santos" }],
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(workbookBuffer);
    assert.equal(workbook.getWorksheet("September 2026").getRow(2).getCell(2).value, "Alex Santos");

    const emptyBuffer = await createTransactionWorkbookBuffer([]);
    const emptyWorkbook = new ExcelJS.Workbook();
    await emptyWorkbook.xlsx.load(emptyBuffer);
    assert.deepEqual(emptyWorkbook.getWorksheet("Overview").getRow(2).values.slice(1), ["No transactions", 0, 0]);
  });
});

describe("filtered transaction report workbook", () => {
  it("creates separate sheets for all categories and counts only verified payment amounts", async () => {
    const workbookBuffer = await createTransactionReportWorkbookBuffer([
      acceptedOrder({
        _id: "order-1",
        customer: { _id: "customer-1", first_name: "Austine", last_name: "Lee" },
        status: "completed",
        total_amount: 100000,
        required_downpayment_amount: 50000,
        payment_ledger_initialized: true,
        payment_records: [
          { status: "verified", verified_amount: 30000, submitted_amount: 30000, payment_method: "Cash", payment_date: new Date(2026, 8, 29) },
          { status: "pending", submitted_amount: 20000, payment_method: "Online", submitted_at: new Date(2026, 8, 30) },
        ],
        review: { rating: 5, title: "Great", comment: "Looks good", submittedAt: new Date(2026, 8, 29) },
        warranty_period: "90 days",
        warranty_start_date: new Date(2026, 8, 29),
        warranty_expiry_date: new Date(2026, 11, 28),
        warranty_status: "active",
      }),
      acceptedOrder({ _id: "order-2", status: "processing", customer_name: "Customer Two", transactionCreatedAt: new Date(2026, 9, 2) }),
      acceptedOrder({ _id: "order-3", status: "cancelled", customer_name: "Customer Three" }),
    ], { type: "all_reports" });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(workbookBuffer);
    assert.deepEqual(workbook.worksheets.map((worksheet) => worksheet.name), [
      "Report Info",
      "All Transactions",
      "Completed Projects",
      "Active Projects",
      "Pending Transactions",
      "Customer Feedback",
      "Payment Records",
      "Warranty Records",
    ]);
    assert.equal(workbook.getWorksheet("Report Info").getRow(1).getCell(1).value, "Filter");

    const allTransactions = workbook.getWorksheet("All Transactions");
    const verifiedOrderRow = [2, 3, 4].map((rowNumber) => allTransactions.getRow(rowNumber))
      .find((row) => row.getCell(1).value === "order-1");
    assert.equal(verifiedOrderRow.getCell(13).value, 30000);

    const paymentRecords = workbook.getWorksheet("Payment Records");
    const paymentRows = [2, 3].map((rowNumber) => paymentRecords.getRow(rowNumber));
    const pendingPaymentRow = paymentRows.find((row) => row.getCell(11).value === "pending");
    const verifiedPaymentRow = paymentRows.find((row) => row.getCell(11).value === "verified");
    assert.equal(pendingPaymentRow.getCell(10).value, 0);
    assert.equal(verifiedPaymentRow.getCell(10).value, 30000);

    assert.equal(workbook.getWorksheet("Completed Projects").rowCount, 2);
    assert.equal(workbook.getWorksheet("Active Projects").rowCount, 2);
    assert.equal(workbook.getWorksheet("Pending Transactions").rowCount, 2);
    assert.equal(workbook.getWorksheet("Customer Feedback").rowCount, 2);
    assert.equal(workbook.getWorksheet("Warranty Records").rowCount, 2);
  });

  it("applies date, project status, payment status, customer, and search filters", async () => {
    const workbookBuffer = await createTransactionReportWorkbookBuffer([
      acceptedOrder({
        _id: "target-order",
        customer: { _id: "64b000000000000000000001", first_name: "Taylor", last_name: "Jones" },
        tracking: "ACGC-TARGET",
        status: "processing",
        amount_paid: 2500,
        required_downpayment_amount: 2000,
        transactionCreatedAt: new Date("2026-09-12T12:00:00.000Z"),
      }),
      acceptedOrder({
        _id: "outside-date",
        customer_name: "Taylor Jones",
        tracking: "ACGC-OLD",
        status: "processing",
        transactionCreatedAt: new Date("2026-08-12T12:00:00.000Z"),
      }),
      acceptedOrder({
        _id: "wrong-status",
        customer_name: "Taylor Jones",
        tracking: "ACGC-COMPLETE",
        status: "completed",
        amount_paid: 16000,
        transactionCreatedAt: new Date("2026-09-12T12:00:00.000Z"),
      }),
    ], {
      type: "all_transactions",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      projectStatus: "active",
      paymentStatus: "partial",
      customer: "64b000000000000000000001",
      search: "ACGC-TARGET",
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(workbookBuffer);
    const transactions = workbook.getWorksheet("All Transactions");
    assert.equal(transactions.rowCount, 2);
    assert.equal(transactions.getRow(2).getCell(1).value, "target-order");
  });

  it("includes the complete browser-local day and legacy accepted contracts", async () => {
    const workbookBuffer = await createTransactionReportWorkbookBuffer([
      acceptedOrder({
        _id: "local-day-start",
        tracking: "LOCAL-START",
        contract_status: undefined,
        contractStatus: "Accepted",
        acceptance_method: "",
        acceptedByCustomer: false,
        transactionCreatedAt: new Date("2026-10-13T16:00:00.000Z"),
      }),
      acceptedOrder({
        _id: "local-day-end",
        tracking: "LOCAL-END",
        transactionCreatedAt: new Date("2026-10-14T15:59:59.999Z"),
      }),
      acceptedOrder({
        _id: "legacy-completed",
        tracking: "LEGACY-COMPLETED",
        contract_status: undefined,
        contractStatus: undefined,
        acceptance_method: "",
        acceptedByCustomer: false,
        status: "completed",
        transactionCreatedAt: new Date("2026-10-14T10:00:00.000Z"),
      }),
      acceptedOrder({
        _id: "prior-local-day",
        tracking: "PRIOR-DAY",
        transactionCreatedAt: new Date("2026-10-13T15:59:59.999Z"),
      }),
      acceptedOrder({
        _id: "next-local-day",
        tracking: "NEXT-DAY",
        transactionCreatedAt: new Date("2026-10-14T16:00:00.000Z"),
      }),
    ], {
      type: "all_transactions",
      startDate: "2026-10-14",
      endDate: "2026-10-14",
      startAt: "2026-10-13T16:00:00.000Z",
      endAt: "2026-10-14T15:59:59.999Z",
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(workbookBuffer);
    const transactions = workbook.getWorksheet("All Transactions");
    assert.equal(transactions.rowCount, 4);
    assert.deepEqual(
      [2, 3, 4].map((rowNumber) => transactions.getRow(rowNumber).getCell(1).value),
      ["local-day-end", "legacy-completed", "local-day-start"],
    );
  });

  it("applies shared filters to each applicable All Reports worksheet", async () => {
    const workbookBuffer = await createTransactionReportWorkbookBuffer([
      acceptedOrder({
        _id: "target-order",
        tracking: "ACGC-TARGET",
        customer: { _id: "64b000000000000000000001", first_name: "Taylor", last_name: "Jones" },
        status: "completed",
        payment_ledger_initialized: true,
        payment_records: [{ status: "pending", submitted_amount: 500, submitted_at: new Date("2026-10-14T08:00:00.000Z") }],
        review: { rating: 5, comment: "Target review", submittedAt: new Date("2026-10-14T08:00:00.000Z") },
        warranty_period: "90 days",
        warranty_start_date: new Date("2026-10-14T08:00:00.000Z"),
        transactionCreatedAt: new Date("2026-10-14T08:00:00.000Z"),
      }),
      acceptedOrder({
        _id: "other-order",
        tracking: "ACGC-OTHER",
        customer: { _id: "64b000000000000000000002", first_name: "Morgan", last_name: "Lee" },
        status: "completed",
        payment_records: [{ status: "pending", submitted_amount: 500, submitted_at: new Date("2026-10-14T08:00:00.000Z") }],
        review: { rating: 5, comment: "Other review", submittedAt: new Date("2026-10-14T08:00:00.000Z") },
        warranty_period: "90 days",
        warranty_start_date: new Date("2026-10-14T08:00:00.000Z"),
        transactionCreatedAt: new Date("2026-10-14T08:00:00.000Z"),
      }),
    ], {
      type: "all_reports",
      startDate: "2026-10-14",
      endDate: "2026-10-14",
      startAt: "2026-10-13T16:00:00.000Z",
      endAt: "2026-10-14T15:59:59.999Z",
      projectStatus: "completed",
      paymentStatus: "pending",
      customer: "64b000000000000000000001",
      search: "ACGC-TARGET",
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(workbookBuffer);
    for (const sheetName of ["All Transactions", "Completed Projects", "Customer Feedback", "Payment Records", "Warranty Records"]) {
      const sheet = workbook.getWorksheet(sheetName);
      assert.equal(sheet.rowCount, 2, `${sheetName} should contain only the matching target record`);
      assert.equal(sheet.getRow(2).getCell(1).value, "target-order");
    }
    for (const sheetName of ["Active Projects", "Pending Transactions"]) {
      assert.equal(workbook.getWorksheet(sheetName).getRow(2).getCell(1).value, "No matching records");
    }
  });

  it("rejects unsupported report filters and invalid date ranges", () => {
    assert.throws(() => validateTransactionReportFilters({ type: "unknown" }), /supported report category/);
    assert.throws(() => validateTransactionReportFilters({ startDate: "2026-02-30" }), /valid date/);
    assert.throws(() => validateTransactionReportFilters({ startDate: "2026-10-02", endDate: "2026-10-01" }), /on or before/);
    assert.throws(() => validateTransactionReportFilters({ customer: "not-an-object-id" }), /valid customer/);
  });

  it("filters reports by every payment ledger status", async () => {
    const statuses = [
      { paymentStatus: "pending", amount_paid: 0 },
      { paymentStatus: "partial_downpayment", amount_paid: 1000 },
      { paymentStatus: "downpayment", amount_paid: 2000 },
      { paymentStatus: "partial", amount_paid: 5000 },
      { paymentStatus: "paid", amount_paid: 10000 },
    ];
    const orders = statuses.map(({ amount_paid }, index) => acceptedOrder({
      _id: `payment-status-${index}`,
      total_amount: 10000,
      required_downpayment_amount: 2000,
      amount_paid,
    }));

    for (const [index, { paymentStatus }] of statuses.entries()) {
      assert.equal(validateTransactionReportFilters({ paymentStatus }).paymentStatus, paymentStatus);
      const workbookBuffer = await createTransactionReportWorkbookBuffer(orders, {
        type: "all_transactions",
        paymentStatus,
      });
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(workbookBuffer);
      const transactions = workbook.getWorksheet("All Transactions");
      assert.equal(transactions.rowCount, 2);
      assert.equal(transactions.getRow(2).getCell(1).value, `payment-status-${index}`);
    }
  });
});
