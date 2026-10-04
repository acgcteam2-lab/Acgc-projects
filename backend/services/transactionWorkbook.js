import ExcelJS from "exceljs";

const excludedStatuses = new Set(["declined", "rejected", "cancelled", "contract_declined"]);

const getTransactionDate = (order) => {
  const value = order.transactionCreatedAt || order.acceptedAt || order.createdAt;
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

const hasAcceptedContract = (order) => {
  if (String(order.contract_status || "").toLowerCase() !== "accepted") return false;
  if (order.order_type === "walk_in_customer") {
    return order.acceptance_method === "walk_in_signed_contract" &&
      Boolean(order.signed_contract_url) &&
      Boolean(order.contract_signed_date);
  }
  return order.acceptance_method === "online" && order.acceptedByCustomer === true;
};

const getPaymentSummary = (order) => {
  const totalAmount = Math.max(Number(order.contract_amount || order.total_amount) || 0, 0);
  const paymentTerms = String(order.payment_terms || "").toLowerCase();
  const legacyRequired = Number(order.downpayment_amount) || 0;
  const fallbackRequired = paymentTerms === "full_payment" ? totalAmount : totalAmount * 0.5;
  const requiredValue = Number(order.required_downpayment_amount) > 0
    ? Number(order.required_downpayment_amount)
    : legacyRequired > 0
      ? legacyRequired
      : fallbackRequired;
  const requiredAmount = Math.min(totalAmount, Math.max(requiredValue, 0));
  const explicitPaidAmount = order.amount_paid ?? order.payment_amount ?? order.paid_amount;
  let paidAmount = Number(explicitPaidAmount);

  if (explicitPaidAmount === undefined || explicitPaidAmount === null || !Number.isFinite(paidAmount)) {
    if (order.payment_proof_confirmed_at) {
      paidAmount = Number(order.payment_proof_amount) || 0;
    } else if (order.payment_status === "paid" && !order.payment_proof_submitted_at) {
      paidAmount = totalAmount;
    } else if (order.downpayment_received) {
      paidAmount = requiredAmount;
    } else {
      paidAmount = 0;
    }
  }

  paidAmount = Math.min(Math.max(paidAmount, 0), totalAmount);
  const paidCents = Math.round(paidAmount * 100);
  const requiredCents = Math.round(requiredAmount * 100);
  const totalCents = Math.round(totalAmount * 100);
  const status = totalCents > 0 && paidCents >= totalCents
    ? "Paid"
    : paidAmount > 0
      ? paidCents < requiredCents && paymentTerms !== "full_payment"
        ? "Partial Downpayment"
        : paidCents <= requiredCents
          ? "Downpayment Paid"
          : "Partial"
      : "Pending";

  return {
    totalAmount,
    paidAmount,
    balance: Math.max(totalAmount - paidAmount, 0),
    status,
  };
};

const getCustomerName = (order, usersById) => {
  const linkedCustomer = order.customer ? usersById.get(String(order.customer)) : null;
  const linkedName = [linkedCustomer?.first_name, linkedCustomer?.last_name].filter(Boolean).join(" ");
  return order.customer_name || linkedName || "Customer";
};

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