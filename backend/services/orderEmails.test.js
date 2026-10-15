import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildOrderEmail, getOrderEmailPaymentTotals, resolveOrderCustomerEmail } from "./orderEmails.js";

describe("order email templates", () => {
  it("uses the current linked-account email instead of historical order snapshots", () => {
    assert.equal(resolveOrderCustomerEmail(
      { customer_email: "old@example.com" },
      { customerEmail: "stale-option@example.com" },
      { email: "current@example.com" },
    ), "current@example.com");
  });

  it("keeps the saved recipient fallback for orders without a linked account", () => {
    assert.equal(resolveOrderCustomerEmail({ customer_email: "walkin@example.com" }), "walkin@example.com");
  });

  it("builds email action links from the configured deployed frontend URL", () => {
    const previousFrontendUrl = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = "https://acgc.example.com/";
    try {
      const email = buildOrderEmail("order_cancelled", {
        _id: "mongo-id",
        tracking: "TRK-123",
        status: "cancelled",
        items: [{ name: "Window", quantity: 1 }],
      });
      assert.ok(email.text.includes("https://acgc.example.com/customer-dashboard?tab=orders&orderId=mongo-id"));
      assert.ok(!email.text.includes("localhost"));
    } finally {
      if (previousFrontendUrl === undefined) delete process.env.FRONTEND_URL;
      else process.env.FRONTEND_URL = previousFrontendUrl;
    }
  });

  it("includes order details, escapes dynamic data, and omits irrelevant cancellation fields", () => {
    const email = buildOrderEmail("order_cancelled", {
      _id: "mongo-id",
      tracking: "TRK-123",
      customer_name: "A <Customer>",
      status: "cancelled",
      total_amount: 1250,
      amount_paid: 0,
      items: [{ name: "<Glass>", quantity: 2 }],
    }, { date: "2026-10-04T12:00:00.000Z" });

    assert.ok(email.subject.includes("TRK-123"));
    assert.ok(email.html.includes("Order ID</th>"));
    assert.ok(email.html.includes("&lt;Glass&gt;"));
    assert.ok(!email.html.includes("Refund information"));
    assert.ok(email.text.includes("Current order status: Cancelled"));
  });

  it("calculates transaction balance from the actual confirmed amount_paid", () => {
    const order = { total_amount: 1000, required_downpayment_amount: 400, amount_paid: 275, payment_status: "partial" };
    const totals = getOrderEmailPaymentTotals(order);
    const email = buildOrderEmail("transaction_update", order, {
      previousStatus: "pending",
      confirmedAmount: 275,
    });

    assert.equal(totals.balance, 725);
    assert.ok(email.text.includes("Remaining balance: PHP 725.00"));
    assert.ok(email.text.includes("Total amount paid: PHP 275.00"));
  });

  it("confirms payment proof and falls back to the submitted proof amount", () => {
    const email = buildOrderEmail("payment_proof_confirmed", {
      _id: "mongo-id",
      tracking: "TRK-123",
      customer_name: "A Customer",
      total_amount: 1000,
      amount_paid: 200,
      payment_proof_amount: 200,
      payment_proof_confirmed_at: "2026-10-04T12:00:00.000Z",
      payment_status: "partial_downpayment",
    }, { confirmedAmount: 0, previousStatus: "Pending Verification" });

    assert.equal(email.subject, "Payment confirmed - TRK-123");
    assert.ok(email.text.includes("reviewed and confirmed"));
    assert.ok(email.text.includes("Confirmed payment amount: PHP 200.00"));
  });

  it("includes both reported amounts and the resolution note in discrepancy emails", () => {
    const email = buildOrderEmail("payment_discrepancy_resolved", {
      _id: "mongo-id",
      tracking: "TRK-123",
      total_amount: 1500,
      amount_paid: 500,
      items: [{ name: "Window", quantity: 1 }],
    }, {
      customerReportedAmount: 1000,
      adminRecordedAmount: 500,
      difference: 500,
      reason: "Reviewed the official receipt with the customer.",
    });

    assert.ok(email.subject.includes("Payment discrepancy resolved"));
    assert.ok(email.text.includes("Customer-reported amount: PHP 1,000.00"));
    assert.ok(email.text.includes("Admin-recorded amount: PHP 500.00"));
    assert.ok(email.text.includes("Reviewed the official receipt with the customer."));
  });

  it("renders each requested event with an order reference and primary action", () => {
    const order = {
      _id: "mongo-id",
      tracking: "TRK-123",
      customer_name: "A Customer",
      createdAt: "2026-10-01T12:00:00.000Z",
      total_amount: 1000,
      required_downpayment_amount: 400,
      amount_paid: 200,
      payment_status: "partial_downpayment",
      payment_method: "Cash",
      payment_proof_amount: 200,
      payment_proof_submitted_at: "2026-10-02T12:00:00.000Z",
      payment_proof_file_name: "receipt.png",
      warranty_start_date: "2026-10-03T00:00:00.000Z",
      warranty_expiry_date: "2027-10-03T00:00:00.000Z",
      warranty_status: "active",
      items: [{ name: "Window", quantity: 1, warranty_period: "1 year", warranty_status: "active" }],
      shipping_address: "Cebu City",
    };
    const events = [
      ["order_submitted", {}],
      ["order_cancelled", {}],
      ["payment_proof_submitted", { audience: "admin" }],
      ["payment_proof_confirmed", { confirmedAmount: 200, previousStatus: "Pending Verification" }],
      ["payment_discrepancy_resolved", { customerReportedAmount: 1000, adminRecordedAmount: 500, difference: 500, reason: "Reviewed." }],
      ["admin_payment_recorded", { confirmedAmount: 200, paymentRecordId: "record-1", reason: "Cash received in person" }],
      ["downpayment_exception_approved", { acceptedAmount: 200, shortfall: 200, reason: "Customer agreed to pay the balance later." }],
      ["downpayment_exception_requested", { acceptedAmount: 200, shortfall: 200 }],
      ["contract_accepted", {}],
      ["transaction_update", { confirmedAmount: 200 }],
      ["transaction_approved", { approvedAt: "2026-10-11T12:00:00.000Z" }],
      ["warranty_notification", { warrantyLines: ["Window: 1 year"] }],
      ["installation_date", { installationDate: "2026-11-01", installationTime: "9:00 AM" }],
    ];

    for (const [event, options] of events) {
      const email = buildOrderEmail(event, order, options);
      assert.ok(email.subject.includes("TRK-123"));
      assert.ok(email.html.includes("ORDER ID"));
      assert.ok(email.html.includes("View") || email.html.includes("Review"));
    }
  });
});