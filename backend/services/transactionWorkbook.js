import ExcelJS from "exceljs";
import { getOrderPaymentAmounts, getOrderPaymentStatus } from "./paymentLedger.js";

const excludedStatuses = new Set(["declined", "rejected", "cancelled", "contract_declined"]);

const getTransactionDate = (order) => {
  const value = order.transactionCreatedAt || order.acceptedAt || order.createdAt;
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

const hasAcceptedContract = (order) => {
  const contractStatus = String(order.contract_status || "").trim().toLowerCase();
  if (contractStatus) return contractStatus === "accepted";
  const legacyContractStatus = String(order.contractStatus || "").trim().toLowerCase();
  if (legacyContractStatus) return legacyContractStatus === "accepted";
  return order.acceptedByCustomer === true || ["contract_accepted", "approved", "processing", "completed"].includes(normalizeReportStatus(order.status));
};

const getPaymentStatusLabel = (status) => ({
  paid: "Fully Paid",
  pending: "Pending",
  partial_downpayment: "Partial Downpayment",
  downpayment: "Downpayment Completed",
  partial: "Partial Payment",
}[status] || "Pending");

const getPaymentSummary = (order) => {
  const amounts = getOrderPaymentAmounts(order);
  return {
    totalAmount: amounts.totalAmount,
    requiredAmount: amounts.requiredAmount,
    paidAmount: amounts.paidAmount,
    balance: amounts.remainingAmount,
    status: getPaymentStatusLabel(getOrderPaymentStatus(order)),
  };
};

const getCustomerName = (order, usersById = new Map()) => {
  const customerId = order.customer?._id || order.customer?.id || order.customer;
  const linkedCustomer = customerId ? usersById.get(String(customerId)) : null;
  const populatedName = [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(" ");
  const linkedName = [linkedCustomer?.first_name, linkedCustomer?.last_name].filter(Boolean).join(" ");
  return order.customer_name || populatedName || linkedName || "Customer";
};

const getCustomerEmail = (order) => order.customer?.email || order.customer_email || "";
const getCustomerPhone = (order) => order.customer?.phone || order.customer_phone || "";

const getProjectName = (order) => {
  const itemNames = (Array.isArray(order.items) ? order.items : [])
    .map((item) => item.name || item.product_name)
    .filter(Boolean);
  return itemNames.length ? itemNames.join(", ") : "Project";
};

const getMonthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

const getMonthTitle = (date) => date.toLocaleDateString("en-US", { month: "long", year: "numeric" });

const styleHeader = (worksheet) => {
  const header = worksheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF7F1D1D" } };
  header.alignment = { vertical: "middle" };
  header.height = 22;
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.autoFilter = { from: "A1", to: `${String.fromCharCode(64 + worksheet.columnCount)}1` };
};

export const createTransactionWorkbookBuffer = async (orders = [], users = []) => {
  const usersById = new Map(users.map((user) => [String(user._id), user]));
  const records = orders
    .filter((order) => {
      const status = String(order.status || "").toLowerCase();
      const contractStatus = String(order.contract_status || "").toLowerCase();
      return hasAcceptedContract(order) &&
        !excludedStatuses.has(status) &&
        !excludedStatuses.has(contractStatus) &&
        Boolean(getTransactionDate(order));
    })
    .map((order) => {
      const date = getTransactionDate(order);
      const payment = getPaymentSummary(order);
      return {
        date,
        monthKey: getMonthKey(date),
        customer: getCustomerName(order, usersById),
        project: getProjectName(order),
        ...payment,
      };
    })
    .sort((first, second) => first.date - second.date);

  const groupedByMonth = new Map();
  for (const record of records) {
    const monthRecords = groupedByMonth.get(record.monthKey) || [];
    monthRecords.push(record);
    groupedByMonth.set(record.monthKey, monthRecords);
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ACGC";
  workbook.created = new Date();

  const overview = workbook.addWorksheet("Overview");
  overview.columns = [
    { header: "Month", key: "month", width: 24 },
    { header: "Transactions", key: "transactions", width: 18 },
    { header: "Total Paid", key: "totalPaid", width: 20, style: { numFmt: '₱#,##0.00;[Red](₱#,##0.00)' } },
  ];
  styleHeader(overview);

  const sortedMonths = [...groupedByMonth.entries()].sort(([first], [second]) => first.localeCompare(second));
  for (const [, monthRecords] of sortedMonths) {
    overview.addRow({
      month: getMonthTitle(monthRecords[0].date),
      transactions: monthRecords.length,
      totalPaid: monthRecords.reduce((sum, record) => sum + record.paidAmount, 0),
    });
  }
  if (sortedMonths.length === 0) overview.addRow({ month: "No transactions", transactions: 0, totalPaid: 0 });

  for (const [, monthRecords] of sortedMonths) {
    const worksheet = workbook.addWorksheet(getMonthTitle(monthRecords[0].date));
    worksheet.columns = [
      { header: "Date", key: "date", width: 16, style: { numFmt: "m/d/yyyy" } },
      { header: "Client", key: "client", width: 28 },
      { header: "Project / Product", key: "project", width: 34 },
      { header: "Amount Paid", key: "paid", width: 18, style: { numFmt: '₱#,##0.00;[Red](₱#,##0.00)' } },
      { header: "Total Amount", key: "total", width: 18, style: { numFmt: '₱#,##0.00;[Red](₱#,##0.00)' } },
      { header: "Balance", key: "balance", width: 18, style: { numFmt: '₱#,##0.00;[Red](₱#,##0.00)' } },
      { header: "Status", key: "status", width: 22 },
    ];
    styleHeader(worksheet);
    for (const record of monthRecords) {
      worksheet.addRow({
        date: record.date,
        client: record.customer,
        project: record.project,
        paid: record.paidAmount,
        total: record.totalAmount,
        balance: record.balance,
        status: record.status,
      });
    }
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
};

export const TRANSACTION_REPORT_CATEGORIES = [
  { value: "all_transactions", label: "All Transactions", worksheet: "All Transactions" },
  { value: "completed_projects", label: "Completed Projects", worksheet: "Completed Projects" },
  { value: "active_projects", label: "Active Projects", worksheet: "Active Projects" },
  { value: "pending_transactions", label: "Pending Transactions", worksheet: "Pending Transactions" },
  { value: "customer_feedback", label: "Customer Feedback", worksheet: "Customer Feedback" },
  { value: "payment_records", label: "Payment Records", worksheet: "Payment Records" },
  { value: "warranty_records", label: "Warranty Records", worksheet: "Warranty Records" },
];

const REPORT_PROJECT_STATUSES = new Set(["all", "pending", "active", "completed", "cancelled"]);
const REPORT_PAYMENT_STATUSES = new Set(["all", "pending", "partial_downpayment", "downpayment", "partial", "paid"]);
const REPORT_TYPES = new Set(["all_reports", ...TRANSACTION_REPORT_CATEGORIES.map(({ value }) => value)]);
const reportError = (message) => Object.assign(new Error(message), { status: 400 });

const normalizeDateTimeFilter = (value, label) => {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw reportError(`${label} must be a valid date and time.`);
  return date;
};

const normalizeDateFilter = (value, label) => {
  if (!value) return "";
  const dateString = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) throw reportError(`${label} must be a valid date.`);
  const date = new Date(`${dateString}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateString) {
    throw reportError(`${label} must be a valid date.`);
  }
  return dateString;
};

export const validateTransactionReportFilters = (input = {}) => {
  const type = String(input.type || "all_transactions").trim().toLowerCase();
  const projectStatus = String(input.projectStatus || "all").trim().toLowerCase();
  const paymentStatus = String(input.paymentStatus || "all").trim().toLowerCase();
  const startDate = normalizeDateFilter(input.startDate, "Start date");
  const endDate = normalizeDateFilter(input.endDate, "End date");
  const startAt = normalizeDateTimeFilter(input.startAt, "Start date");
  const endAt = normalizeDateTimeFilter(input.endAt, "End date");
  const customer = String(input.customer || "all").trim();
  const search = String(input.search || "").trim();

  if (!REPORT_TYPES.has(type)) throw reportError("Select a supported report category.");
  if (!REPORT_PROJECT_STATUSES.has(projectStatus)) throw reportError("Select a supported project status.");
  if (!REPORT_PAYMENT_STATUSES.has(paymentStatus)) throw reportError("Select a supported payment status.");
  if (startDate && endDate && startDate > endDate) throw reportError("Start date must be on or before end date.");
  if (startAt && endAt && startAt > endAt) throw reportError("Start date must be on or before end date.");
  if (customer.length > 100) throw reportError("Customer filter is too long.");
  if (customer !== "all" && !customer.startsWith("name:") && !/^[a-f\d]{24}$/i.test(customer)) {
    throw reportError("Select a valid customer.");
  }
  if (customer.startsWith("name:") && !customer.slice(5).trim()) throw reportError("Select a valid customer.");
  if (search.length > 200) throw reportError("Search must be 200 characters or fewer.");

  return { type, startDate, endDate, startAt, endAt, projectStatus, paymentStatus, customer, search };
};

const normalizeReportStatus = (value) => String(value || "").trim().toLowerCase();
const orderIdOf = (order) => String(order?._id || order?.id || "");
const customerIdOf = (order) => String(order?.customer?._id || order?.customer?.id || order?.customer || "");
const valueDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getReportProjectStatus = (order) => {
  const status = normalizeReportStatus(order.status);
  const contractStatus = normalizeReportStatus(order.contract_status || order.contractStatus);
  if (["cancelled", "contract_declined", "declined", "rejected"].includes(status) || ["declined", "rejected"].includes(contractStatus)) return "Cancelled";
  if (status === "completed") return "Completed";
  const activeStatuses = new Set(["approved", "admin_review", "contract_accepted", "processing"]);
  if (activeStatuses.has(status) || Number(order.progress) > 0 || (order.items || []).some((item) => Number(item?.progress) > 0)) return "Active/In Progress";
  return "Pending";
};

const getReportPaymentStatus = (order) => {
  return getOrderPaymentStatus(order);
};

const isDateInRange = (dateValue, filters) => {
  if (!filters.startDate && !filters.endDate && !filters.startAt && !filters.endAt) return true;
  const date = valueDate(dateValue);
  if (!date) return false;
  const startAt = filters.startAt || (filters.startDate ? new Date(`${filters.startDate}T00:00:00.000Z`) : null);
  const endAt = filters.endAt || (filters.endDate ? new Date(`${filters.endDate}T23:59:59.999Z`) : null);
  if (startAt && date < startAt) return false;
  if (endAt && date > endAt) return false;
  return true;
};

const orderMatchesReportFilters = (order, filters, dateValue = getTransactionDate(order)) => {
  if (!hasAcceptedContract(order)) return false;
  if (!isDateInRange(dateValue, filters)) return false;

  const projectStatus = getReportProjectStatus(order).toLowerCase();
  if (filters.projectStatus !== "all" && projectStatus !== filters.projectStatus && !(filters.projectStatus === "active" && projectStatus === "active/in progress")) return false;
  if (filters.paymentStatus !== "all" && getReportPaymentStatus(order) !== filters.paymentStatus) return false;
  if (filters.customer !== "all") {
    const matchesId = customerIdOf(order) === filters.customer;
    const matchesFallbackName = filters.customer.startsWith("name:")
      && getCustomerName(order).toLowerCase() === filters.customer.slice(5).toLowerCase();
    if (!matchesId && !matchesFallbackName) return false;
  }

  if (filters.search) {
    const search = filters.search.toLowerCase();
    const searchableValues = [
      orderIdOf(order),
      order.tracking,
      getCustomerName(order),
      order.customer_email,
      order.customer?.email,
      order.transaction_number,
      ...(order.items || []).flatMap((item) => [item.name, item.product_name]),
      ...(order.payment_records || []).map((record) => record.transaction_number),
      order.review?.title,
      order.review?.comment,
      ...(order.review?.tags || []),
      ...(order.items || []).flatMap((item) => [item.review?.title, item.review?.comment, ...(item.review?.tags || [])]),
    ];
    if (!searchableValues.some((value) => String(value || "").toLowerCase().includes(search))) return false;
  }
  return true;
};

const formatProjectStatus = (order) => String(order.status || "Unknown").replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
const projectNameOf = (order) => getProjectName(order);

const toTransactionReportRow = (order) => {
  const payment = getOrderPaymentAmounts(order);
  return {
    orderId: orderIdOf(order),
    trackingId: order.tracking || "",
    customer: getCustomerName(order),
    customerEmail: getCustomerEmail(order),
    customerPhone: getCustomerPhone(order),
    project: projectNameOf(order),
    projectStatus: formatProjectStatus(order),
    contractStatus: order.contract_status || "",
    paymentTerms: order.payment_terms || "",
    transactionDate: getTransactionDate(order),
    total: payment.totalAmount,
    requiredPayment: payment.requiredAmount,
    verifiedPaid: payment.paidAmount,
    balance: payment.remainingAmount,
    paymentStatus: getPaymentStatusLabel(getOrderPaymentStatus(order)),
  };
};

const buildTransactionRows = (orders, filters) => orders
  .filter((order) => orderMatchesReportFilters(order, filters))
  .map(toTransactionReportRow)
  .sort((first, second) => (valueDate(second.transactionDate)?.getTime() || 0) - (valueDate(first.transactionDate)?.getTime() || 0));

const buildFeedbackRows = (orders, filters) => {
  const rows = [];
  for (const order of orders) {
    if (!hasAcceptedContract(order)) continue;
    const reviews = [
      ...(order.review ? [{ review: order.review, product: order.items?.length > 1 ? "Order review" : projectNameOf(order), scope: "Order" }] : []),
      ...(order.items || []).map((item) => ({ review: item.review, product: item.name || item.product_name || "Product", scope: "Product" })),
    ];
    for (const { review, product, scope } of reviews) {
      if (!review || !(review.submittedAt || review.rating || review.comment || review.photos?.length)) continue;
      const reviewDate = valueDate(review.submittedAt || review.updatedAt);
      if (!orderMatchesReportFilters(order, filters, reviewDate)) continue;
      rows.push({
        orderId: orderIdOf(order),
        trackingId: order.tracking || "",
        customer: getCustomerName(order),
        customerEmail: getCustomerEmail(order),
        customerPhone: getCustomerPhone(order),
        scope,
        product,
        rating: Number(review.rating) || null,
        title: review.title || "",
        comment: review.comment || "",
        tags: Array.isArray(review.tags) ? review.tags.join(", ") : "",
        reviewDate,
      });
    }
  }
  return rows.sort((first, second) => (valueDate(second.reviewDate)?.getTime() || 0) - (valueDate(first.reviewDate)?.getTime() || 0));
};

const buildPaymentRows = (orders, filters) => {
  const rows = [];
  for (const order of orders) {
    if (!hasAcceptedContract(order)) continue;
    const records = Array.isArray(order.payment_records) ? order.payment_records : [];
    if (records.length === 0) {
      const payment = getOrderPaymentAmounts(order);
      if (payment.paidAmount > 0) {
        const paymentDate = valueDate(order.payment_proof_confirmed_at || order.updatedAt || getTransactionDate(order));
        if (orderMatchesReportFilters(order, filters, paymentDate)) {
          rows.push({
            orderId: orderIdOf(order),
            trackingId: order.tracking || "",
            customer: getCustomerName(order),
            customerEmail: getCustomerEmail(order),
            customerPhone: getCustomerPhone(order),
            paymentDate,
            source: "Legacy verified",
            submittedAmount: null,
            verifiedAmount: payment.paidAmount,
            amountCounted: payment.paidAmount,
            paymentStatus: "verified",
            paymentMethod: order.payment_method || "",
            reference: order.transaction_number || "",
            adminNote: "",
          });
        }
      }
      continue;
    }

    for (const record of records) {
      const paymentDate = valueDate(record.payment_date || record.verified_at || record.recorded_at || record.submitted_at || record.createdAt);
      if (!orderMatchesReportFilters(order, filters, paymentDate)) continue;
      const isVerified = record.status === "verified";
      rows.push({
        orderId: orderIdOf(order),
        trackingId: order.tracking || "",
        customer: getCustomerName(order),
        customerEmail: getCustomerEmail(order),
        customerPhone: getCustomerPhone(order),
        paymentDate,
        source: record.record_source === "admin_recorded" ? "Admin recorded" : "Customer submitted",
        submittedAmount: record.submitted_amount == null ? null : Number(record.submitted_amount),
        verifiedAmount: isVerified ? Number(record.verified_amount) || 0 : null,
        amountCounted: isVerified ? Number(record.verified_amount) || 0 : 0,
        paymentStatus: record.status || "pending",
        paymentMethod: record.payment_method || "",
        reference: record.transaction_number || "",
        adminNote: record.admin_reason || "",
      });
    }
  }
  return rows.sort((first, second) => (valueDate(second.paymentDate)?.getTime() || 0) - (valueDate(first.paymentDate)?.getTime() || 0));
};

const buildWarrantyRows = (orders, filters) => {
  const rows = [];
  for (const order of orders) {
    if (!hasAcceptedContract(order)) continue;
    const items = Array.isArray(order.items) ? order.items : [];
    const itemWarrantyRows = items.map((item) => ({
      item,
      period: item.warranty_period || (order.warranty_assignment_mode === "per_product" ? "" : order.warranty_period),
      start: item.warranty_start_date || (order.warranty_assignment_mode === "per_product" ? null : order.warranty_start_date),
      end: item.warranty_expiry_date || (order.warranty_assignment_mode === "per_product" ? null : order.warranty_expiry_date),
      status: item.warranty_status || (order.warranty_assignment_mode === "per_product" ? "" : order.warranty_status),
      terms: item.warranty_terms || (order.warranty_assignment_mode === "per_product" ? "" : order.warranty_terms),
    })).filter((entry) => entry.period || entry.start || entry.end || entry.status || entry.terms);
    const orderHasWarranty = order.warranty_period || order.warranty_start_date || order.warranty_expiry_date || order.warranty_status || order.warranty_terms;
    const warrantyEntries = order.warranty_assignment_mode !== "per_product" && orderHasWarranty
      ? [{ item: null, period: order.warranty_period, start: order.warranty_start_date, end: order.warranty_expiry_date, status: order.warranty_status, terms: order.warranty_terms }]
      : itemWarrantyRows;

    for (const entry of warrantyEntries) {
      const warrantyDate = valueDate(entry.start || entry.end || order.updatedAt || getTransactionDate(order));
      if (!orderMatchesReportFilters(order, filters, warrantyDate)) continue;
      rows.push({
        orderId: orderIdOf(order),
        trackingId: order.tracking || "",
        customer: getCustomerName(order),
        customerEmail: getCustomerEmail(order),
        customerPhone: getCustomerPhone(order),
        product: entry.item?.name || entry.item?.product_name || projectNameOf(order),
        warrantyPeriod: entry.period || "",
        startDate: valueDate(entry.start),
        endDate: valueDate(entry.end),
        warrantyStatus: entry.status || "Not assigned",
        warrantyTerms: entry.terms || "",
      });
    }
  }
  return rows.sort((first, second) => (valueDate(second.startDate)?.getTime() || 0) - (valueDate(first.startDate)?.getTime() || 0));
};

const buildProjectRows = (orders, filters, category) => orders
  .filter((order) => {
    if (!orderMatchesReportFilters(order, filters)) return false;
    const projectStatus = getReportProjectStatus(order);
    if (category === "completed_projects") return projectStatus === "Completed";
    if (category === "active_projects") return projectStatus === "Active/In Progress";
    if (category === "pending_transactions") {
      if (["Completed", "Cancelled"].includes(projectStatus)) return false;
      const hasPendingPayment = (order.payment_records || []).some((record) => record.status === "pending");
      return hasPendingPayment || ["pending", "partial_downpayment"].includes(getOrderPaymentStatus(order));
    }
    return true;
  })
  .map(toTransactionReportRow)
  .sort((first, second) => (valueDate(second.transactionDate)?.getTime() || 0) - (valueDate(first.transactionDate)?.getTime() || 0));

const reportSheetDefinitions = {
  all_transactions: {
    rows: buildTransactionRows,
    columns: [
      { header: "Order ID", key: "orderId", width: 28 },
      { header: "Tracking ID", key: "trackingId", width: 20 },
      { header: "Customer Name", key: "customer", width: 28 },
      { header: "Customer Email", key: "customerEmail", width: 32 },
      { header: "Customer Phone", key: "customerPhone", width: 20 },
      { header: "Project", key: "project", width: 34 },
      { header: "Project Status", key: "projectStatus", width: 20 },
      { header: "Contract Status", key: "contractStatus", width: 18 },
      { header: "Payment Terms", key: "paymentTerms", width: 28 },
      { header: "Transaction Date", key: "transactionDate", width: 18, style: { numFmt: "yyyy-mm-dd" } },
      { header: "Project Cost", key: "total", width: 18, style: { numFmt: '₱#,##0.00;[Red](₱#,##0.00)' } },
      { header: "Required Payment", key: "requiredPayment", width: 19, style: { numFmt: '₱#,##0.00;[Red](₱#,##0.00)' } },
      { header: "Verified Paid", key: "verifiedPaid", width: 18, style: { numFmt: '₱#,##0.00;[Red](₱#,##0.00)' } },
      { header: "Remaining Balance", key: "balance", width: 20, style: { numFmt: '₱#,##0.00;[Red](₱#,##0.00)' } },
      { header: "Payment Status", key: "paymentStatus", width: 22 },
    ],
  },
  completed_projects: { rows: (orders, filters) => buildProjectRows(orders, filters, "completed_projects"), columns: null },
  active_projects: { rows: (orders, filters) => buildProjectRows(orders, filters, "active_projects"), columns: null },
  pending_transactions: { rows: (orders, filters) => buildProjectRows(orders, filters, "pending_transactions"), columns: null },
  customer_feedback: {
    rows: buildFeedbackRows,
    columns: [
      { header: "Order ID", key: "orderId", width: 28 },
      { header: "Tracking ID", key: "trackingId", width: 20 },
      { header: "Customer Name", key: "customer", width: 28 },
      { header: "Customer Email", key: "customerEmail", width: 32 },
      { header: "Customer Phone", key: "customerPhone", width: 20 },
      { header: "Review Type", key: "scope", width: 16 },
      { header: "Product", key: "product", width: 30 },
      { header: "Rating", key: "rating", width: 12 },
      { header: "Title", key: "title", width: 30 },
      { header: "Comment", key: "comment", width: 60 },
      { header: "Tags", key: "tags", width: 30 },
      { header: "Review Date", key: "reviewDate", width: 18, style: { numFmt: "yyyy-mm-dd" } },
    ],
  },
  payment_records: {
    rows: buildPaymentRows,
    columns: [
      { header: "Order ID", key: "orderId", width: 28 },
      { header: "Tracking ID", key: "trackingId", width: 20 },
      { header: "Customer Name", key: "customer", width: 28 },
      { header: "Customer Email", key: "customerEmail", width: 32 },
      { header: "Customer Phone", key: "customerPhone", width: 20 },
      { header: "Payment Date", key: "paymentDate", width: 18, style: { numFmt: "yyyy-mm-dd" } },
      { header: "Record Source", key: "source", width: 22 },
      { header: "Submitted Amount", key: "submittedAmount", width: 20, style: { numFmt: '₱#,##0.00;[Red](₱#,##0.00)' } },
      { header: "Verified Amount", key: "verifiedAmount", width: 20, style: { numFmt: '₱#,##0.00;[Red](₱#,##0.00)' } },
      { header: "Amount Counted", key: "amountCounted", width: 20, style: { numFmt: '₱#,##0.00;[Red](₱#,##0.00)' } },
      { header: "Payment Status", key: "paymentStatus", width: 18 },
      { header: "Method", key: "paymentMethod", width: 18 },
      { header: "Transaction Reference", key: "reference", width: 26 },
      { header: "Admin Note", key: "adminNote", width: 48 },
    ],
  },
  warranty_records: {
    rows: buildWarrantyRows,
    columns: [
      { header: "Order ID", key: "orderId", width: 28 },
      { header: "Tracking ID", key: "trackingId", width: 20 },
      { header: "Customer Name", key: "customer", width: 28 },
      { header: "Customer Email", key: "customerEmail", width: 32 },
      { header: "Customer Phone", key: "customerPhone", width: 20 },
      { header: "Product", key: "product", width: 32 },
      { header: "Warranty Period", key: "warrantyPeriod", width: 20 },
      { header: "Start Date", key: "startDate", width: 18, style: { numFmt: "yyyy-mm-dd" } },
      { header: "End Date", key: "endDate", width: 18, style: { numFmt: "yyyy-mm-dd" } },
      { header: "Warranty Status", key: "warrantyStatus", width: 20 },
      { header: "Warranty Terms", key: "warrantyTerms", width: 48 },
    ],
  },
};

const transactionColumns = reportSheetDefinitions.all_transactions.columns;
for (const category of ["completed_projects", "active_projects", "pending_transactions"]) {
  reportSheetDefinitions[category].columns = transactionColumns;
}

const reportSelectionLabel = (type) => type === "all_reports"
  ? "All Reports"
  : TRANSACTION_REPORT_CATEGORIES.find((category) => category.value === type)?.label || "All Transactions";

const getReportFilterRows = (filters, generatedAt) => [
  { filter: "Report", selection: reportSelectionLabel(filters.type) },
  { filter: "Generated At", selection: generatedAt },
  { filter: "Start Date", selection: filters.startDate || "Any" },
  { filter: "End Date", selection: filters.endDate || "Any" },
  { filter: "Project Status", selection: filters.projectStatus.replace(/_/g, " ") },
  { filter: "Payment Status", selection: filters.paymentStatus.replace(/_/g, " ") },
  { filter: "Customer", selection: filters.customer },
  { filter: "Search", selection: filters.search || "None" },
];

const writeReportSheet = (workbook, name, columns, rows) => {
  const worksheet = workbook.addWorksheet(name);
  worksheet.columns = columns;
  styleHeader(worksheet);
  if (rows.length === 0) {
    worksheet.addRow({ [columns[0].key]: "No matching records" });
    return worksheet;
  }
  rows.forEach((row) => worksheet.addRow(row));
  return worksheet;
};

export const createTransactionReportWorkbookBuffer = async (orders = [], rawFilters = {}) => {
  const filters = validateTransactionReportFilters(rawFilters);
  const generatedAt = new Date();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ACGC";
  workbook.created = generatedAt;
  workbook.modified = generatedAt;
  workbook.title = `ACGC ${reportSelectionLabel(filters.type)}`;

  const info = workbook.addWorksheet("Report Info");
  info.columns = [
    { header: "Filter", key: "filter", width: 24 },
    { header: "Selection", key: "selection", width: 54 },
  ];
  styleHeader(info);
  getReportFilterRows(filters, generatedAt.toISOString()).forEach((row) => info.addRow(row));

  const categories = filters.type === "all_reports"
    ? TRANSACTION_REPORT_CATEGORIES
    : TRANSACTION_REPORT_CATEGORIES.filter((category) => category.value === filters.type);
  for (const category of categories) {
    const definition = reportSheetDefinitions[category.value];
    const rows = definition.rows(orders, filters);
    writeReportSheet(workbook, category.worksheet, definition.columns, rows);
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
};