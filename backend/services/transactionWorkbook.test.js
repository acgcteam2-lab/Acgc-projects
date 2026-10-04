import { describe, it } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { createTransactionWorkbookBuffer } from "./transactionWorkbook.js";

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
