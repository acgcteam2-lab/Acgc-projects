import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  FileText,
  ShieldCheck,
  CheckCircle,
  Eye,
  Pencil,
  Lock,
  Star,
  Trash2,
  X,
  Info,
  XCircle,
} from "lucide-react";
import { toPng } from "html-to-image";
import jsPDF from "jspdf";
import toast, { Toaster } from "react-hot-toast";

import Sidebar from "../../components/layout/Sidebar";
import Navbar from "../../components/layout/Navbar";
import AdminPageHeader from "../../components/layout/AdminPageHeader";
import ContractModal from "../../components/ContractModal";
import { getAdminOrders, acceptContract, declineContract, updateOrderStatus, deleteOrderReview } from "@/api/orders";
import { formatDateToMMDDYYYY, formatDateTimeToMMDDYYYY, formatDateToMMMDDYYYY, getTodayIso, isSameOrAfter } from "@/lib/dateUtils";
import { useAuth } from "@/contexts/AuthContext";
import { recordActivity } from "@/lib/activityLog";
import ProfileAvatar from "../../components/ui/ProfileAvatar";
import { useAdminTheme } from "@/contexts/AdminThemeContext";
import { getCustomerPaymentProof, getPaymentSummary, isPaymentProofConfirmed } from "./paymentProofUtils";
import { useIsMobile } from "@/hooks/useIsMobile";
import useNotificationHighlight from "@/hooks/useNotificationHighlight";

function Transactions() {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const { darkMode } = useAdminTheme();
  const [isSidebarOpen, setIsSidebarOpen] =
    useState(() => {
      if (typeof window === "undefined") return true;
      const stored = localStorage.getItem("sidebarOpen");
      return stored !== null ? JSON.parse(stored) : true;
    });

  const [activeTable, setActiveTable] =
    useState("all");

  const location = useLocation();
  const highlightedNotificationRecordId = useNotificationHighlight(location);

  useEffect(() => {
    if (location?.state?.activeTable) {
      const requestedTable = location.state.activeTable;
      setActiveTable(
        requestedTable === "warranty_in" || requestedTable === "warranty_out"
          ? "projects"
          : requestedTable
      );
      try {
        window.history.replaceState({}, document.title);
      } catch (e) {
        // ignore
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("sidebarOpen", JSON.stringify(isSidebarOpen));
  }, [isSidebarOpen]);

  const [receiptPage, setReceiptPage] =
    useState(1);
  const [allPage, setAllPage] = useState(1);
  const [feedbackPage, setFeedbackPage] = useState(1);

  const [projectPage, setProjectPage] =
    useState(1);
  const [cancelledPage, setCancelledPage] =
    useState(1);
  const [tableSearch, setTableSearch] = useState("");

  useEffect(() => {
    setReceiptPage(1);
    setAllPage(1);
    setFeedbackPage(1);
    setProjectPage(1);
    setCancelledPage(1);
  }, [activeTable]);

  const rowsPerPage = 5;

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [feedbackPreviewOrder, setFeedbackPreviewOrder] = useState(null);
  const [feedbackDeleteOrder, setFeedbackDeleteOrder] = useState(null);
  const [feedbackDeleting, setFeedbackDeleting] = useState(false);
  const [showContractModal, setShowContractModal] = useState(false);
  const [showFullContractModal, setShowFullContractModal] = useState(false);
  const [contractPreviewOrder, setContractPreviewOrder] = useState(null);
  const [contractPreviewData, setContractPreviewData] = useState(null);
  const [showEditPaymentModal, setShowEditPaymentModal] = useState(false);
  const [editPaymentOrder, setEditPaymentOrder] = useState(null);
  const [editPaymentMethod, setEditPaymentMethod] = useState("Cash");
  const [editPaymentAmount, setEditPaymentAmount] = useState("0.00");
  const [editPaymentTransactionNumber, setEditPaymentTransactionNumber] = useState("");
  const [showWarrantyModal, setShowWarrantyModal] = useState(false);
  const [warrantyOrder, setWarrantyOrder] = useState(null);
  const [warrantyTerms, setWarrantyTerms] = useState("Standard parts and workmanship warranty for one year.");
  const [warrantyStartDate, setWarrantyStartDate] = useState("");
  const [warrantyExpiryDate, setWarrantyExpiryDate] = useState("");
  const [warrantySaving, setWarrantySaving] = useState(false);
  const today = getTodayIso();

  const isCompletedProject = (order) => {
    const status = (order.status || "").toString().toLowerCase();
    const contractStatus = (order.contract_status || "").toString().toLowerCase();
    const progress = Number(order.progress || 0);
    const invalidStatuses = ["cancelled", "declined", "contract_declined", "rejected"];

    if (invalidStatuses.includes(status) || invalidStatuses.includes(contractStatus)) {
      return false;
    }

    const batchItems = Array.isArray(order.items) ? order.items : [];
    const allBatchItemsCompleted = batchItems.length > 1 && batchItems.every((item) => {
      const stages = Array.isArray(item?.progress_stages) ? item.progress_stages : [];
      if (stages.length > 0) {
        return stages.every((stage) =>
          stage.completed === true || ["done", "completed"].includes(String(stage.status || "").toLowerCase())
        );
      }
      return Number(item?.progress) >= 100;
    });

    return status === "completed" || progress >= 100 || allBatchItemsCompleted;
  };

  const getFeedbackEntries = (order) => {
    const entries = [];
    const hasOrderReview = order.review?.submittedAt || order.review?.rating;
    if (hasOrderReview) {
      entries.push({
        ...order,
        review: order.review,
        reviewItemIndex: null,
        reviewProductName: order.items?.length > 1
          ? "Batch order"
          : order.items?.[0]?.name || order.items?.[0]?.product_name || "Project",
      });
    }

    (order.items || []).forEach((item, itemIndex) => {
      if (!item?.review?.submittedAt && !item?.review?.rating) return;
      entries.push({
        ...order,
        review: item.review,
        reviewItemIndex: itemIndex,
        reviewProductName: item.name || item.product_name || `Product ${itemIndex + 1}`,
      });
    });

    return entries;
  };

  const hasAcceptedContract = (order) => {
    const contractStatus = String(order.contract_status || "").toLowerCase();
    if (contractStatus !== "accepted") return false;

    if (order.order_type === "walk_in_customer") {
      return order.acceptance_method === "walk_in_signed_contract" &&
        Boolean(order.signed_contract_url) &&
        Boolean(order.contract_signed_date);
    }

    return order.acceptance_method === "online" && order.acceptedByCustomer === true;
  };

  const transactionOrders = orders.filter(hasAcceptedContract);
  const financialOrders = transactionOrders.filter((order) => {
    const status = String(order.status || "").toLowerCase();
    const contractStatus = String(order.contract_status || "").toLowerCase();
    const excludedStatuses = ["declined", "rejected", "cancelled", "contract_declined"];
    return !excludedStatuses.includes(status) && !excludedStatuses.includes(contractStatus);
  });
  const getTransactionTotal = (order) => getPaymentSummary(order).totalAmount;
  const getConfirmedPayment = (order) => getPaymentSummary(order).paidAmount;

  const hasVerifiedContractAcceptance = (order) => {
    if (String(order.contract_status || "").toLowerCase() !== "accepted") return false;

    if (order.order_type === "walk_in_customer") {
      return order.acceptance_method === "walk_in_signed_contract" && Boolean(order.signed_contract_url);
    }

    return order.acceptedByCustomer === true && order.acceptance_method === "online";
  };

  // Warranty helpers
  const getCompletionDate = (order) => {
    // prefer an explicit completed timestamp, fallback to updatedAt when status === completed
    if (!order) return null;
    if (order.completed_at) return new Date(order.completed_at);
    if (order.completedAt) return new Date(order.completedAt);
    if ((order.status || "").toString().toLowerCase() === "completed") {
      return order.updatedAt ? new Date(order.updatedAt) : (order.createdAt ? new Date(order.createdAt) : null);
    }
    return null;
  };

  const getInstallationCompletionDate = (order, item = null) => {
    const stages = item?.progress_stages?.length
      ? item.progress_stages
      : order?.progress_stages || order?.stages || [];
    const installationStage = stages.find((stage) => {
      const stageKey = String(stage.key || "").toLowerCase();
      const stageName = String(stage.name || "").toLowerCase();
      const isInstallation = (stageKey.includes("installation") || stageName.includes("installation"))
        && !stageKey.includes("schedul")
        && !stageName.includes("schedul");
      const isComplete = stage.completed === true || ["done", "completed"].includes(String(stage.status || "").toLowerCase());
      return isInstallation && isComplete;
    });
    const stageDate = installationStage?.date || installationStage?.completedAt;
    if (stageDate) {
      const parsedStageDate = new Date(stageDate);
      if (!Number.isNaN(parsedStageDate.getTime()) && parsedStageDate <= new Date()) return parsedStageDate;
    }

    const completedDate = getCompletionDate(order);
    return completedDate && completedDate <= new Date() ? completedDate : null;
  };

  const parseWarrantyPeriod = (value) => {
    // Accepts strings like '1 year', '12 months', or numeric days
    if (!value) return null;
    if (typeof value === "number") return { days: value };
    const v = value.toString().toLowerCase();
    const yearMatch = v.match(/(\d+)\s*year/);
    if (yearMatch) return { days: Number(yearMatch[1]) * 365 };
    const monthMatch = v.match(/(\d+)\s*month/);
    if (monthMatch) return { days: Number(monthMatch[1]) * 30 };
    const daysMatch = v.match(/(\d+)\s*day/);
    if (daysMatch) return { days: Number(daysMatch[1]) };
    const n = Number(v);
    if (!isNaN(n)) return { days: n };
    return null;
  };

  const getWarrantyExpiry = (order) => {
    // Prefer explicit expiry field
    if (!order) return null;
    if (order.warranty_expiry_date) return new Date(order.warranty_expiry_date);
    if (order.warrantyExpiryDate) return new Date(order.warrantyExpiryDate);

    const completed = getCompletionDate(order);
    if (!completed) return null;

    // Check for warranty_period on order or items
    const period = order.warranty_period || order.warranty || order.warrantyPeriod || (order.items && order.items[0] && (order.items[0].warranty_period || order.items[0].warranty));
    const parsed = parseWarrantyPeriod(period);
    if (parsed && parsed.days) {
      const expiry = new Date(completed);
      expiry.setDate(expiry.getDate() + parsed.days);
      return expiry;
    }

    return null;
  };

  const getWarrantyRecords = (order) => {
    const itemRecords = (order?.items || [])
      .filter((item) => item?.warranty_start_date || item?.warranty_expiry_date || item?.warranty_status)
      .map((item) => ({
        status: String(item.warranty_status || "").toLowerCase(),
        start: item.warranty_start_date ? new Date(item.warranty_start_date) : null,
        expiry: item.warranty_expiry_date ? new Date(item.warranty_expiry_date) : null,
      }));
    if (itemRecords.length) return itemRecords;
    return order?.warranty_start_date || order?.warranty_expiry_date || order?.warranty_status
      ? [{
          status: String(order.warranty_status || "").toLowerCase(),
          start: order.warranty_start_date ? new Date(order.warranty_start_date) : null,
          expiry: getWarrantyExpiry(order),
        }]
      : [];
  };

  const activeWarrantyCount = transactionOrders.reduce((count, order) => (
    count + getWarrantyRecords(order).filter(({ status, start, expiry }) => (
      (!start || start <= new Date()) && (status === "active" || (!status && expiry && new Date() <= expiry))
    )).length
  ), 0);

  const hasWarrantyData = (order) => {
    if (!order) return false;
    return Boolean(
      order.warranty_expiry_date ||
      order.warrantyExpiryDate ||
      order.warranty_start_date ||
      order.warranty_status ||
      (order.items || []).some((item) => {
        const status = String(item.warranty_status || "").toLowerCase();
        return ["active", "expired", "no_warranty"].includes(status) || (!status && (item.warranty_start_date || item.warranty_expiry_date));
      })
    );
  };

  const canCreateWarranty = (order) => isCompletedProject(order) && !hasWarrantyData(order);

  const computeWarrantyExpiryDate = (start, periodValue) => {
    const startDate = start ? new Date(start) : new Date();
    const parsed = parseWarrantyPeriod(periodValue) || { days: 365 };
    const expiry = new Date(startDate);
    expiry.setDate(expiry.getDate() + parsed.days);
    return expiry;
  };

  const openWarrantyModal = (order) => {
    const completionDate = getInstallationCompletionDate(order);
    if (!completionDate) {
      toast.error("Complete project installation before creating a warranty.");
      return;
    }
    const defaultExpiry = order.warranty_expiry_date
      ? new Date(order.warranty_expiry_date)
      : computeWarrantyExpiryDate(completionDate, "1 year");

    setWarrantyOrder(order);
    setWarrantyTerms(order.warranty_terms || "Standard parts and workmanship warranty for one year.");
    setWarrantyStartDate(completionDate.toISOString().slice(0, 10));
    setWarrantyExpiryDate(defaultExpiry.toISOString().slice(0, 10));
    setShowWarrantyModal(true);
  };

  const closeWarrantyModal = () => {
    setShowWarrantyModal(false);
    setWarrantyOrder(null);
    setWarrantySaving(false);
    setWarrantyTerms("Standard parts and workmanship warranty for one year.");
    setWarrantyStartDate("");
    setWarrantyExpiryDate("");
  };

  const handleWarrantyExpiryDateChange = (value) => {
    setWarrantyExpiryDate(value);
  };

  const formatWarrantyPeriodFromDates = (start, expiry) => {
    const startDate = start ? new Date(start) : null;
    const expiryDate = expiry ? new Date(expiry) : null;
    if (!startDate || !expiryDate || expiryDate <= startDate) return "";
    const diffDays = Math.ceil((expiryDate - startDate) / (1000 * 60 * 60 * 24));
    if (diffDays % 365 === 0) return `${diffDays / 365} year${diffDays / 365 === 1 ? "" : "s"}`;
    if (diffDays % 30 === 0) return `${diffDays / 30} month${diffDays / 30 === 1 ? "" : "s"}`;
    return `${diffDays} day${diffDays === 1 ? "" : "s"}`;
  };

  const handleCreateWarranty = async () => {
    if (!warrantyOrder) return;
    setWarrantySaving(true);
    const orderId = warrantyOrder._id || warrantyOrder.id;
    try {
      const start = getInstallationCompletionDate(warrantyOrder);
      if (!start || start > new Date()) {
        toast.error("Complete project installation before activating its warranty.");
        setWarrantySaving(false);
        return;
      }
      const expiry = warrantyExpiryDate ? new Date(warrantyExpiryDate) : computeWarrantyExpiryDate(start, "1 year");
      if (!isSameOrAfter(expiry, start) || expiry.getTime() === start.getTime()) {
        toast.error("Warranty End Date must be later than the Warranty Start Date.");
        setWarrantySaving(false);
        return;
      }
      const isPerProductWarranty = warrantyOrder.warranty_assignment_mode === "per_product";
      const items = (warrantyOrder.items || []).map((item) => {
        const itemStart = isPerProductWarranty
          ? getInstallationCompletionDate(warrantyOrder, item) || start
          : start;
        const periodValue = isPerProductWarranty
          ? item.warranty_period || warrantyOrder.warranty_period || 90
          : warrantyOrder.warranty_period || 90;
        const parsedPeriodDays = parseWarrantyPeriod(periodValue)?.days || Number(periodValue);
        const customDays = isPerProductWarranty
          ? Number(item.custom_warranty_days) || parsedPeriodDays || 90
          : Number(warrantyOrder.custom_warranty_days) || parsedPeriodDays || 90;
        const itemExpiry = periodValue === "No Warranty"
          ? null
          : isPerProductWarranty
            ? computeWarrantyExpiryDate(itemStart, periodValue === "Custom" ? customDays : periodValue)
            : expiry;
        return {
          ...item,
          warranty_period: periodValue === "No Warranty"
            ? "No Warranty"
            : formatWarrantyPeriodFromDates(start, itemExpiry),
          custom_warranty_days: periodValue === "No Warranty" ? null : customDays,
          warranty_start_date: periodValue === "No Warranty" ? null : itemStart.toISOString(),
          warranty_expiry_date: itemExpiry ? itemExpiry.toISOString() : null,
          warranty_status: periodValue === "No Warranty"
            ? "no_warranty"
            : itemExpiry > new Date() ? "active" : "expired",
        };
      });
      const activeExpiries = items
        .filter((item) => item.warranty_expiry_date)
        .map((item) => new Date(item.warranty_expiry_date));
      const hasActiveCoverage = items.some((item) => item.warranty_status === "active");
      const orderExpiry = !hasActiveCoverage
        ? null
        : isPerProductWarranty && activeExpiries.length
        ? new Date(Math.max(...activeExpiries.map((date) => date.getTime())))
        : expiry;
      const payload = {
        warranty_period: isPerProductWarranty
          ? "Per product"
          : hasActiveCoverage ? formatWarrantyPeriodFromDates(start, expiry) : "No Warranty",
        warranty_start_date: hasActiveCoverage ? start.toISOString() : null,
        warranty_expiry_date: orderExpiry?.toISOString() || null,
        warranty_status: hasActiveCoverage ? "active" : "no_warranty",
        warranty_terms: warrantyTerms,
        items,
      };

      const response = await updateOrderStatus(orderId, payload);
      recordActivity(user, `Created warranty for order ${orderId}.`, "Transactions");
      const updated = response?.order || {};
      updateOrderLocally(orderId, {
        ...updated,
        ...payload,
      });
      toast.success("Warranty created successfully.");
      closeWarrantyModal();
    } catch (error) {
      console.error("Create warranty failed", error);
      toast.error(error?.data?.message || error?.message || "Unable to create warranty.");
    } finally {
      setWarrantySaving(false);
    }
  };

  const updateOrderLocally = (orderId, patch) => {
    setOrders((prev) =>
      prev.map((order) =>
        order._id === orderId || order.id === orderId
          ? { ...order, ...patch }
          : order
      )
    );
  };

  const handleDeleteCustomerFeedback = async () => {
    if (!feedbackDeleteOrder) return;
    const orderId = feedbackDeleteOrder._id || feedbackDeleteOrder.id;
    if (!orderId) return;

    setFeedbackDeleting(true);
    try {
      const response = await deleteOrderReview(orderId, feedbackDeleteOrder.reviewItemIndex);
      setOrders((previous) => previous.map((order) =>
        order._id === orderId || order.id === orderId
          ? response.order || (
            Number.isInteger(feedbackDeleteOrder.reviewItemIndex)
              ? {
                  ...order,
                  items: order.items.map((item, itemIndex) => itemIndex === feedbackDeleteOrder.reviewItemIndex
                    ? { ...item, review: null }
                    : item),
                }
              : { ...order, review: null }
          )
          : order
      ));
      recordActivity(
        user,
        `Deleted customer feedback for ${feedbackDeleteOrder.reviewProductName || "order"} ${feedbackDeleteOrder.tracking || orderId}.`,
        "Transactions",
      );
      setFeedbackPreviewOrder((previous) =>
        previous && (previous._id === orderId || previous.id === orderId) ? null : previous
      );
      setFeedbackDeleteOrder(null);
      toast.success("Customer feedback deleted.");
    } catch (error) {
      toast.error(error?.data?.message || error?.message || "Unable to delete customer feedback.");
    } finally {
      setFeedbackDeleting(false);
    }
  };

  const buildContractDataFromOrder = (order) => {
    if (!order) return null;

    const amount = Number(order.contract_amount || order.total_amount || 0);
    const downPayment = getPaymentSummary(order).requiredAmount;
    const items = (order.items || []).map((item) => ({
      name: item.name || "Item",
      category: item.category || item.product_type || "General",
      quantity: item.quantity || 0,
      width: item.width || "—",
      height: item.height || "—",
      area: item.area || 0,
      unitPrice: Number(item.unit_price || 0),
      amount: Number(item.line_total || (item.is_estimate ? item.estimated_price : 0) || (item.quantity || 0) * Number(item.unit_price || 0)),
      warrantyPeriod: item.warranty_period,
      warrantyCustomDays: item.custom_warranty_days,
      warrantyStartDate: item.warranty_start_date,
      warrantyExpiryDate: item.warranty_expiry_date,
    }));

    const contractStatus = order.contract_status?.replace(/_/g, " ") || order.status?.replace(/_/g, " ") || "Pending";
    const accepted = (order.contract_status || order.status || "").toString().toLowerCase() === "accepted" || order.status === "contract_accepted";

    return {
      orderNumber: order.tracking || order._id || "N/A",
      contractDate: order.updatedAt ? formatDateToMMDDYYYY(order.updatedAt) : formatDateToMMDDYYYY(order.createdAt),
      orderDate: order.createdAt ? formatDateToMMDDYYYY(order.createdAt) : "N/A",
      status: order.status?.replace(/_/g, " ") || "Pending",
      contractStatus,
      customerName: order.customer?.first_name || order.customer_name || "Customer",
      customerEmail: order.customer?.email || order.customer_email || "N/A",
      customerPhone: order.customer?.phone || order.customer_phone || "N/A",
      projectLocation: order.shipping_address || "N/A",
      siteInspectionDate: order.inspection_date ? formatDateToMMDDYYYY(order.inspection_date) : "TBD",
      paymentTerms: order.payment_terms || "Standard payment terms apply.",
      contractTerms: order.contract_terms || "",
      subtotal: amount,
      totalProjectCost: amount,
      downPayment,
      items,
      accepted,
      acceptanceMethod: accepted ? "Online Acceptance" : null,
      acceptanceDate: accepted && order.updatedAt ? formatDateTimeToMMDDYYYY(order.updatedAt) : null,
      acceptedBy: order.customer?.first_name || order.customer_name || "Customer",
      contractId: order.tracking || order._id || "N/A",
      customerAccountId: order.customer?._id || order.customer || "N/A",
    };
  };

  const openContractModal = (order) => {
    if (!order) return;
    const data = buildContractDataFromOrder(order);
    setContractPreviewOrder(order);
    setContractPreviewData(data);
    setShowContractModal(true);
  };

  const openReadOnlyContract = (order) => {
    if (!order) return;
    setContractPreviewOrder(order);
    setContractPreviewData(buildContractDataFromOrder(order));
    setShowContractModal(false);
    setShowFullContractModal(true);
  };

  const openEditPaymentModal = (order) => {
    if (!order) return;
    const proof = getCustomerPaymentProof(order);
    const method = proof.paymentMethod || order.payment_method || (order.acceptance_method === "online" ? "Online" : "Cash");
    const hasUnconfirmedProof = Boolean(
      order.payment_proof_submitted_at && !isPaymentProofConfirmed(order),
    );

    setEditPaymentOrder(order);
    setEditPaymentMethod(method);
    setEditPaymentAmount(hasUnconfirmedProof && proof.amount > 0 ? String(proof.amount) : "");
    setEditPaymentTransactionNumber(proof.transactionNumber || order.transaction_number || order.transactionNumber || "");
    setShowEditPaymentModal(true);
  };

  const closeContractModal = () => {
    setShowContractModal(false);
    setShowFullContractModal(false);
    setContractPreviewOrder(null);
    setContractPreviewData(null);
  };

  const closeEditPaymentModal = () => {
    setShowEditPaymentModal(false);
    setEditPaymentOrder(null);
    setEditPaymentMethod("Cash");
    setEditPaymentAmount("0.00");
    setEditPaymentTransactionNumber("");
  };

  const handleSavePaymentEdit = async () => {
    if (!editPaymentOrder) return;
    const nextAmount = Number(editPaymentAmount || 0);
    if (Number.isNaN(nextAmount) || nextAmount < 0) {
      toast.error("Please enter a valid payment amount.");
      return;
    }

    const orderId = editPaymentOrder._id || editPaymentOrder.id;
    if (nextAmount <= 0) {
      toast.error("Enter an amount greater than zero.");
      return;
    }

    const existingSummary = getPaymentSummary(editPaymentOrder);
    const totalAmount = existingSummary.totalAmount;
    const existingPaid = existingSummary.paidAmount;
    if (Math.round(nextAmount * 100) > Math.round(existingSummary.remainingAmount * 100)) {
      toast.error("Payment cannot exceed the remaining balance.");
      return;
    }
    const updatedPaid = existingPaid + nextAmount;
    const remainingAfter = Math.max(totalAmount - updatedPaid, 0);
    const updatedSummary = getPaymentSummary({ ...editPaymentOrder, amount_paid: updatedPaid });
    const isFullyPaid = updatedSummary.status.key === "paid";

    try {
      const payload = {
        amount_paid: updatedPaid,
        payment_status: updatedSummary.status.key,
        payment_method: editPaymentMethod,
        transaction_number: editPaymentTransactionNumber || editPaymentOrder.transaction_number || "",
        ...(editPaymentOrder.payment_proof_submitted_at && !isPaymentProofConfirmed(editPaymentOrder)
          ? { payment_proof_confirmed_at: new Date().toISOString() }
          : {}),
      };

      const response = await updateOrderStatus(orderId, payload);
      const updated = response?.order || {};
      updateOrderLocally(orderId, {
        ...updated,
        ...payload,
        payment_proof_amount: updated.payment_proof_amount ?? editPaymentOrder.payment_proof_amount ?? 0,
        payment_method: editPaymentMethod,
      });

      toast.success(
        isFullyPaid
          ? "Payment confirmed. Customer is now marked as Fully Paid."
          : `Payment saved. Status: ${updatedSummary.status.label}. Remaining balance: ₱${remainingAfter.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      );
    } catch (error) {
      console.error("Save payment edit failed", error);
      toast.error(error?.data?.message || error?.message || "Unable to save payment update.");
      return;
    }

    closeEditPaymentModal();
  };

  const openFullContractModal = () => {
    if (!contractPreviewOrder) return;
    setShowContractModal(false);
    setShowFullContractModal(true);
  };

  const createPrintClone = (el) => {
    const clone = el.cloneNode(true);
    clone.style.width = `${el.scrollWidth}px`;
    clone.style.height = "auto";
    clone.style.overflow = "visible";
    clone.style.position = "relative";
    clone.style.maxHeight = "none";
    clone.style.maxWidth = "none";

    const wrapper = document.createElement("div");
    wrapper.style.position = "fixed";
    wrapper.style.left = "-9999px";
    wrapper.style.top = "0";
    wrapper.style.opacity = "0";
    wrapper.style.pointerEvents = "none";
    wrapper.style.zIndex = "-1";
    wrapper.appendChild(clone);

    document.body.appendChild(wrapper);
    return { wrapper, clone };
  };

  const printContract = async () => {
    const el = document.getElementById("contract-content");
    if (!el) {
      toast.error("Unable to locate contract content for printing.");
      return;
    }

    const { wrapper, clone } = createPrintClone(el);
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const dataUrl = await toPng(clone, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: "#ffffff",
      });

      const printWindow = window.open("", "_blank");
      if (!printWindow) {
        toast.error("Please allow popups to print the contract.");
        return;
      }

      printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Contract Print</title><style>html,body{margin:0;padding:0;background:#fff;}body{padding:12mm;}img{width:100%;height:auto;display:block;}@media print{body{padding:0;}.no-print{display:none !important;}}</style></head><body><img src="${dataUrl}" alt="Contract" /></body></html>`);
      printWindow.document.close();
      printWindow.focus();

      printWindow.onload = () => {
        printWindow.print();
      };
    } catch (err) {
      console.error("Failed to prepare contract for printing", err);
      toast.error("Failed to print contract.");
    } finally {
      if (wrapper?.parentNode) document.body.removeChild(wrapper);
    }
  };

  const downloadContractPDF = async () => {
    const el = document.getElementById("contract-content");
    if (!el) {
      toast.error("Unable to locate contract content for PDF export.");
      return;
    }

    const { wrapper, clone } = createPrintClone(el);
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const dataUrl = await toPng(clone, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: "#ffffff",
      });

      const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const imgProps = pdf.getImageProperties(dataUrl);
      const imgWidth = pdfWidth;
      const imgHeight = (imgProps.height * pdfWidth) / imgProps.width;

      let heightLeft = imgHeight;
      let position = 0;
      pdf.addImage(dataUrl, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pdfHeight;

      while (heightLeft > 0) {
        position -= pdfHeight;
        pdf.addPage();
        pdf.addImage(dataUrl, "PNG", 0, position, imgWidth, imgHeight);
        heightLeft -= pdfHeight;
      }

      pdf.save(`contract-${contractPreviewOrder?.tracking || contractPreviewOrder?._id || "export"}.pdf`);
    } catch (err) {
      console.error("Failed to export contract PDF", err);
      toast.error("Failed to download contract as PDF.");
    } finally {
      if (wrapper.parentNode) document.body.removeChild(wrapper);
    }
  };

  const downloadContractPNG = async () => {
    const el = document.getElementById("contract-content");
    if (!el) {
      toast.error("Unable to locate contract content for PNG export.");
      return;
    }

    const clone = el.cloneNode(true);
    clone.style.width = `${el.scrollWidth}px`;
    clone.style.height = "auto";
    clone.style.overflow = "visible";
    clone.style.position = "relative";
    clone.style.maxHeight = "none";

    const wrapper = document.createElement("div");
    wrapper.style.position = "fixed";
    wrapper.style.left = "-9999px";
    wrapper.style.top = "0";
    wrapper.style.opacity = "0";
    wrapper.style.pointerEvents = "none";
    wrapper.appendChild(clone);

    document.body.appendChild(wrapper);

    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const dataUrl = await toPng(clone, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: "#ffffff",
      });
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `contract-${contractPreviewOrder?.tracking || contractPreviewOrder?._id || "export"}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("Failed to export contract PNG", err);
      toast.error("Failed to download contract as PNG.");
    } finally {
      document.body.removeChild(wrapper);
    }
  };

  useEffect(() => {
    const fetchOrders = async () => {
      setLoading(true);
      try {
        const res = await getAdminOrders({ module: "transactions" });
        if (res && res.orders) {
          setOrders(res.orders);
        }
      } catch (err) {
        console.error("Failed to fetch orders", err);
      } finally {
        setLoading(false);
      }
    };

    fetchOrders();
  }, []);

  // Receipts & Contracts: orders that have a contract and are not cancelled/declined
  const receipts = transactionOrders.filter((o) => {
    const status = (o.contract_status || "").toString().toLowerCase();
    const orderStatus = (o.status || "").toString().toLowerCase();
    const blockedStatuses = [
      "pending",
      "sent",
      "contract_sent",
      "declined",
      "rejected",
      "cancelled",
      "contract_declined",
    ];

    return (
      hasVerifiedContractAcceptance(o) &&
      !blockedStatuses.includes(status) &&
      !blockedStatuses.includes(orderStatus)
    );
  });

  const filteredReceipts = receipts.filter((o) => {
    if (!tableSearch) return true;
    const q = tableSearch.toLowerCase();
    const customer = (o.customer_name || o.customer?.first_name || "").toString().toLowerCase();
    const project = (o.items?.[0]?.name || "").toString().toLowerCase();
    const tracking = (o.tracking || "").toString().toLowerCase();
    return tracking.includes(q) || customer.includes(q) || project.includes(q);
  });

  const cancelledTransactions = transactionOrders.filter((o) => {
    const contractStatus = (o.contract_status || "").toString().toLowerCase();
    const status = (o.status || "").toString().toLowerCase();
    return ["declined", "rejected", "cancelled", "contract_declined"].includes(contractStatus) || status === "cancelled";
  });

  // Completed projects: orders that are completed by status or progress
  const completedProjects = transactionOrders.filter((o) => isCompletedProject(o));
  const feedbackOrders = transactionOrders.flatMap(getFeedbackEntries);
  const financialTotals = financialOrders.reduce((totals, order) => {
    const total = getTransactionTotal(order);
    const collected = getConfirmedPayment(order);
    totals.revenue += total;
    totals.collected += collected;
    totals.pending += Math.max(total - collected, 0);
    return totals;
  }, { revenue: 0, collected: 0, pending: 0 });
  const validRatings = feedbackOrders
    .map((order) => Number(order.review?.rating))
    .filter((rating) => Number.isFinite(rating) && rating >= 1 && rating <= 5);
  const averageRating = validRatings.length
    ? validRatings.reduce((total, rating) => total + rating, 0) / validRatings.length
    : 0;
  const formatCurrency = (amount) => `₱${amount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const summaryMetrics = [
    { label: "Total Revenue", value: formatCurrency(financialTotals.revenue), color: "text-rose-300" },
    { label: "Total Collected", value: formatCurrency(financialTotals.collected), color: "text-emerald-300" },
    { label: "Pending Balance", value: formatCurrency(financialTotals.pending), color: "text-amber-200" },
    { label: "Completed Projects", value: completedProjects.length.toLocaleString(), color: "text-indigo-300" },
    { label: "Average Customer Rating", value: `${averageRating.toFixed(1)} / 5 (${validRatings.length})`, color: "text-orange-300" },
  ];
  const filteredFeedbackOrders = feedbackOrders.filter((order) => {
    if (!tableSearch) return true;
    const query = tableSearch.toLowerCase();
    const customer = (order.customer_name || order.customer?.first_name || "").toString().toLowerCase();
    const products = (order.reviewProductName || "").toLowerCase();
    const tracking = (order.tracking || "").toString().toLowerCase();
    const title = (order.review?.title || "").toLowerCase();
    const comment = (order.review?.comment || "").toLowerCase();
    return [customer, products, tracking, title, comment].some((value) => value.includes(query));
  });
  const filteredAllOrders = transactionOrders.filter((o) => {
    if (!tableSearch) return true;
    const q = tableSearch.toLowerCase();
    const customer = (o.customer_name || o.customer?.first_name || "").toString().toLowerCase();
    const project = (o.items?.[0]?.name || "").toString().toLowerCase();
    const tracking = (o.tracking || "").toString().toLowerCase();
    return tracking.includes(q) || customer.includes(q) || project.includes(q);
  });

  useEffect(() => {
    if (!highlightedNotificationRecordId) return;
    const targetIndex = transactionOrders.findIndex((order) => String(order._id || order.id) === highlightedNotificationRecordId);
    setActiveTable("all");
    setTableSearch("");
    if (targetIndex >= 0) setAllPage(Math.floor(targetIndex / rowsPerPage) + 1);
  }, [highlightedNotificationRecordId, orders]);

  const receiptLastIndex =
    receiptPage * rowsPerPage;

  const receiptFirstIndex =
    receiptLastIndex - rowsPerPage;

  const currentReceipts = filteredReceipts.slice(
    receiptFirstIndex,
    receiptLastIndex
  );
  const allTotalPages = Math.max(1, Math.ceil(filteredAllOrders.length / rowsPerPage));
  const currentAll = filteredAllOrders.slice((allPage - 1) * rowsPerPage, allPage * rowsPerPage);
  const feedbackTotalPages = Math.max(1, Math.ceil(filteredFeedbackOrders.length / rowsPerPage));
  const currentFeedback = filteredFeedbackOrders.slice((feedbackPage - 1) * rowsPerPage, feedbackPage * rowsPerPage);

  const receiptTotalPages = Math.max(1, Math.ceil(
    filteredReceipts.length / rowsPerPage
  ));

  const projectLastIndex =
    projectPage * rowsPerPage;

  const projectFirstIndex =
    projectLastIndex - rowsPerPage;

  const currentProjects =
    completedProjects.slice(
      projectFirstIndex,
      projectLastIndex
    );

  const projectTotalPages = Math.max(1, Math.ceil(
    completedProjects.length / rowsPerPage
  ));

  const filteredCompleted = completedProjects.filter((o) => {
    if (!tableSearch) return true;
    const q = tableSearch.toLowerCase();
    const customer = (o.customer_name || o.customer?.first_name || "").toString().toLowerCase();
    const project = (o.items?.[0]?.name || "").toString().toLowerCase();
    const tracking = (o.tracking || "").toString().toLowerCase();
    return tracking.includes(q) || customer.includes(q) || project.includes(q);
  });

  const currentProjectsFiltered = filteredCompleted.slice(projectFirstIndex, projectLastIndex);

  const projectTotalPagesFiltered = Math.max(1, Math.ceil(filteredCompleted.length / rowsPerPage));

  const cancelledLastIndex =
    cancelledPage * rowsPerPage;

  const cancelledFirstIndex =
    cancelledLastIndex - rowsPerPage;

  const currentCancelled =
    cancelledTransactions.slice(
      cancelledFirstIndex,
      cancelledLastIndex
    );

  const cancelledTotalPages = Math.max(1, Math.ceil(
    cancelledTransactions.length / rowsPerPage
  ));

  const filteredCancelled = cancelledTransactions.filter((o) => {
    if (!tableSearch) return true;
    const q = tableSearch.toLowerCase();
    const customer = (o.customer_name || o.customer?.first_name || "").toString().toLowerCase();
    const project = (o.items?.[0]?.name || "").toString().toLowerCase();
    const tracking = (o.tracking || "").toString().toLowerCase();
    return tracking.includes(q) || customer.includes(q) || project.includes(q);
  });

  const currentCancelledFiltered = filteredCancelled.slice(cancelledFirstIndex, cancelledLastIndex);

  const cancelledTotalPagesFiltered = Math.max(1, Math.ceil(filteredCancelled.length / rowsPerPage));

  const currentData = isMobile
    ? activeTable === "all"
      ? filteredAllOrders
      : activeTable === "receipts"
        ? filteredReceipts
        : activeTable === "projects"
          ? filteredCompleted
          : activeTable === "feedback"
            ? filteredFeedbackOrders
            : filteredCancelled
    : activeTable === "all"
      ? currentAll
      : activeTable === "receipts"
      ? currentReceipts
      : activeTable === "projects"
      ? currentProjectsFiltered
      : activeTable === "feedback"
      ? currentFeedback
      : currentCancelledFiltered;

  const activePage = activeTable === "all"
    ? allPage
    : activeTable === "receipts"
    ? receiptPage
    : activeTable === "projects"
    ? projectPage
    : activeTable === "feedback"
    ? feedbackPage
    : cancelledPage;
  const activeTotalPages = activeTable === "all"
    ? allTotalPages
    : activeTable === "receipts"
    ? receiptTotalPages
    : activeTable === "projects"
    ? projectTotalPagesFiltered
    : activeTable === "feedback"
    ? feedbackTotalPages
    : cancelledTotalPagesFiltered;
  const setActivePage = (page) => {
    if (activeTable === "all") setAllPage(page);
    else if (activeTable === "receipts") setReceiptPage(page);
    else if (activeTable === "projects") setProjectPage(page);
    else if (activeTable === "feedback") setFeedbackPage(page);
    else setCancelledPage(page);
  };

  const renderClientCell = (order, customerName) => (
    <ProfileAvatar name={customerName} email={order.customer?.email || order.customer_email || ""} />
  );

  const editPaymentModalContent = showEditPaymentModal && editPaymentOrder ? (() => {
    const shellClass = darkMode
      ? "fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      : "fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/30 p-4";
    const modalClass = darkMode
      ? "flex max-h-[90vh] w-full max-w-[520px] flex-col overflow-hidden rounded-2xl border border-slate-700 bg-[#17283d] shadow-[0_18px_60px_rgba(2,6,23,0.45)] ring-1 ring-slate-700"
      : "flex max-h-[90vh] w-full max-w-[520px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_60px_rgba(15,23,42,0.12)] ring-1 ring-slate-200";
    const titleClass = darkMode ? "text-red-400" : "text-red-500";
    const nameClass = darkMode ? "text-slate-100" : "text-slate-900";
    const subtitleClass = darkMode ? "text-slate-400" : "text-slate-500";
    const closeButtonClass = darkMode
      ? "rounded-md p-1.5 text-slate-400 transition hover:bg-slate-700 hover:text-slate-100"
      : "rounded-md p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900";
    const headerPanelClass = darkMode ? "border-t border-slate-700 bg-[#1d2f45]" : "border-t border-slate-200 bg-slate-50";
    const alertClass = darkMode
      ? "flex items-start gap-3 rounded-xl border border-red-500/40 bg-[#2b1d1d] px-3 py-3 text-sm text-red-200"
      : "flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700";
    const alertIconClass = darkMode ? "text-red-400" : "text-red-500";
    const bodyClass = darkMode ? "flex-1 space-y-4 overflow-y-auto px-5 py-4 text-slate-200" : "flex-1 space-y-4 overflow-y-auto px-5 py-4 text-slate-700";
    const labelClass = darkMode ? "text-slate-400" : "text-slate-500";
    const inputClass = darkMode
      ? "w-full rounded-xl border border-slate-600 bg-[#1d2f45] px-3 py-2.5 text-base text-slate-100 outline-none transition placeholder:text-slate-400 focus:border-red-400 focus:ring-2 focus:ring-red-500/30"
      : "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-red-400 focus:ring-2 focus:ring-red-100";
    const panelClass = darkMode ? "rounded-xl border border-slate-700 bg-[#1d2f45]" : "rounded-xl border border-slate-200 bg-slate-50";
    const optionWrapClass = darkMode ? "grid grid-cols-2 gap-2 rounded-xl border border-slate-700 bg-[#1d2f45] p-1" : "grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-1";
    const optionBaseClass = darkMode ? "bg-[#132238] text-slate-300" : "bg-white text-slate-600";
    const onlineSelectedClass = darkMode ? "border border-red-500/50 bg-[#2d1d1d] text-red-200" : "border border-red-200 bg-red-50 text-red-700";
    const cashSelectedClass = darkMode ? "border border-emerald-500/50 bg-emerald-500/15 text-emerald-200" : "border border-emerald-200 bg-emerald-50 text-emerald-700";
    const linkClass = darkMode
      ? "flex w-full items-center justify-between rounded-xl border border-slate-600 bg-[#1d2f45] px-3 py-2.5 text-left text-sm text-slate-200 transition hover:bg-slate-700"
      : "flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left text-sm text-slate-700 transition hover:bg-slate-100";
    const previewCardClass = darkMode ? "rounded-xl border border-slate-700 bg-[#132238] p-3 shadow-sm" : "rounded-xl border border-slate-200 bg-white p-3 shadow-sm";
    const secondaryTextClass = darkMode ? "text-slate-300" : "text-slate-600";
    const tertiaryTextClass = darkMode ? "text-slate-400" : "text-slate-500";
    const strongTextClass = darkMode ? "text-slate-100" : "text-slate-900";
    const footerClass = darkMode ? "flex justify-end gap-3 border-t border-slate-700 bg-[#1d2f45] px-5 py-4" : "flex justify-end gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4";
    const footerCancelClass = darkMode ? "rounded-xl border border-slate-600 bg-[#15263f] px-5 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-slate-700" : "rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100";
    const footerSaveClass = darkMode ? "rounded-xl border border-red-500/50 bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-500" : "rounded-xl border border-red-200 bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-500";
    const proofIconBoxClass = darkMode ? "inline-flex h-5 w-5 items-center justify-center rounded bg-slate-700 text-slate-200" : "inline-flex h-5 w-5 items-center justify-center rounded bg-slate-200 text-slate-700";
    const proofLinkClass = darkMode
      ? "flex items-center gap-2 rounded-lg border border-slate-700 bg-[#1d2f45] px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-700 hover:text-white"
      : "flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100 hover:text-slate-900";

    return (
      <div className={shellClass}>
        <div className={modalClass}>
          <div className="flex items-center justify-between px-5 py-4">
            <div>
              <div className={`text-[11px] font-extrabold uppercase tracking-[0.18em] ${titleClass}`}>EDIT PAYMENT</div>
              <div className={`mt-1 text-[15px] font-bold ${nameClass}`}>{editPaymentOrder.customer_name || `${editPaymentOrder.customer?.first_name || ""} ${editPaymentOrder.customer?.last_name || ""}`.trim() || "Customer"}</div>
              <div className={`text-[12px] ${subtitleClass}`}>{editPaymentOrder.items?.[0]?.name || "Sliding Window"}</div>
            </div>
            <button type="button" onClick={closeEditPaymentModal} className={closeButtonClass} aria-label="Close edit payment modal">
              <X size={16} />
            </button>
          </div>

          <div className={headerPanelClass}>
            <div className={alertClass}>
              <Info size={18} className={`mt-0.5 shrink-0 ${alertIconClass}`} />
              <span>You may update the amount paid, payment method, and transaction number.</span>
            </div>
          </div>

          <div className={bodyClass}>
            {(() => {
              const proof = getCustomerPaymentProof(editPaymentOrder);
              if (proof.submitted) {
                return (
                  <div className="space-y-3">
                    <div className={darkMode ? "rounded-xl border border-amber-400/30 bg-[#2f2a18] px-3 py-2.5 text-sm text-amber-100 shadow-sm" : "rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 shadow-sm"}>
                      <p className="font-medium leading-6">
                        Customer says they paid <span className={darkMode ? "font-bold text-white" : "font-bold text-slate-900"}>₱{Number(proof.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>. Confirm it matches what you received.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          const nextValue = Number(proof.amount || 0).toFixed(2);
                          setEditPaymentAmount(nextValue);
                          setTimeout(() => {
                            document.getElementById("edit-payment-amount-field")?.scrollIntoView({
                              behavior: "smooth",
                              block: "center",
                            });
                          }, 50);
                        }}
                        className={darkMode
                          ? "mt-2 inline-flex items-center justify-center rounded-xl border border-amber-400/50 bg-gradient-to-r from-amber-500 to-yellow-500 px-3.5 py-2 text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-950 shadow-sm transition hover:brightness-110"
                          : "mt-2 inline-flex items-center justify-center rounded-xl border border-amber-300 bg-gradient-to-r from-amber-400 to-yellow-400 px-3.5 py-2 text-[10px] font-extrabold uppercase tracking-[0.16em] text-amber-950 shadow-sm transition hover:brightness-105"}
                      >
                        Use this amount
                      </button>
                    </div>

                    <div>
                      <div className={`mb-2 text-[11px] font-extrabold uppercase tracking-[0.18em] ${labelClass}`}>PROOF OF PAYMENT</div>
                      <a
                        href={proof.fileUrl || "#"}
                        target={proof.fileUrl ? "_blank" : undefined}
                        rel={proof.fileUrl ? "noreferrer" : undefined}
                        onClick={(event) => {
                          if (!proof.fileUrl) {
                            event.preventDefault();
                          }
                        }}
                        className={linkClass}
                      >
                        <span className="flex items-center gap-2">
                          <span className={proofIconBoxClass}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                              <path d="M10.5 13.5l6.1-6.1a3.2 3.2 0 1 1 4.5 4.5l-8.8 8.8a4.8 4.8 0 1 1-6.8-6.8l8.5-8.5" />
                            </svg>
                          </span>
                          <span className="font-medium">View Proof of Payment</span>
                        </span>
                        <span className={tertiaryTextClass}>↗</span>
                      </a>

                      {proof.fileUrl ? (
                        <div className={`mt-3 overflow-hidden rounded-xl border p-3 ${panelClass}`}>
                          <a href={proof.fileUrl} target="_blank" rel="noreferrer" className={darkMode ? "block overflow-hidden rounded-lg border border-slate-700 bg-white" : "block overflow-hidden rounded-lg border border-slate-200 bg-white"}>
                            <img
                              src={proof.fileUrl}
                              alt="Proof of payment"
                              className="max-h-[420px] w-full object-contain"
                            />
                          </a>
                        </div>
                      ) : null}

                      <div className={`mt-3 overflow-hidden rounded-xl border p-3 ${panelClass}`}>
                        <div className={`mb-2 text-[11px] font-extrabold uppercase tracking-[0.16em] ${labelClass}`}>Customer Payment Submissions (1)</div>

                        <div className={previewCardClass}>
                          <div className={`mb-3 flex items-center justify-between gap-3 text-sm ${secondaryTextClass}`}>
                            <span className={darkMode ? "font-semibold text-slate-100" : "font-semibold text-slate-700"}>Payment #1</span>
                            <span className={tertiaryTextClass}>{formatDateToMMMDDYYYY(new Date())}</span>
                          </div>

                          <div className={`grid gap-2 text-sm sm:grid-cols-[1fr_auto] sm:items-end ${secondaryTextClass}`}>
                            <div>
                              <div className={`text-[11px] font-medium ${tertiaryTextClass}`}>Customer declared</div>
                              <div className={`mt-1 text-[15px] font-semibold ${strongTextClass}`}>
                                ₱{Number(proof.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </div>
                            </div>

                            <div className={darkMode ? "inline-flex items-center rounded-full border border-amber-400/40 bg-[#2f2a18] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-300" : "inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-700"}>
                              Awaiting confirmation
                            </div>
                          </div>

                          <div className={`mt-4 space-y-2 border-t pt-3 text-sm ${secondaryTextClass} ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium">Submitted amount</span>
                              <span className={darkMode ? "font-semibold text-red-400" : "font-semibold text-red-600"}>₱{Number(proof.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                            {proof.transactionNumber && (
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium">Transaction</span>
                                <span className={darkMode ? "font-semibold text-slate-100" : "font-semibold text-slate-800"}>{proof.transactionNumber}</span>
                              </div>
                            )}
                            {proof.fileName && (
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium">Attachment</span>
                                <span className={`max-w-[150px] truncate text-right font-semibold ${darkMode ? "text-slate-100" : "text-slate-800"}`} title={proof.fileName}>{proof.fileName}</span>
                              </div>
                            )}
                          </div>

                          <div className="mt-3">
                            <div className={`mb-2 text-[11px] font-extrabold uppercase tracking-[0.14em] ${labelClass}`}>View proof</div>
                            <a
                              href={proof.fileUrl || "#"}
                              target={proof.fileUrl ? "_blank" : undefined}
                              rel={proof.fileUrl ? "noreferrer" : undefined}
                              onClick={(event) => {
                                if (!proof.fileUrl) {
                                  event.preventDefault();
                                }
                              }}
                              className={proofLinkClass}
                            >
                              <span className={proofIconBoxClass}>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                                  <path d="M10.5 13.5l6.1-6.1a3.2 3.2 0 1 1 4.5 4.5l-8.8 8.8a4.8 4.8 0 1 1-6.8-6.8l8.5-8.5" />
                                </svg>
                              </span>
                              <span className="truncate">{proof.fileName || "Proof of payment"}</span>
                            </a>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <div>
                  <div className={`mb-2 text-[11px] font-extrabold uppercase tracking-[0.18em] ${labelClass}`}>PROOF OF PAYMENT</div>
                  <p className={tertiaryTextClass}>Customer has not submitted proof of payment yet.</p>
                </div>
              );
            })()}

            <div>
              <label className={`mb-2 block text-[11px] font-extrabold uppercase tracking-[0.18em] ${labelClass}`}>AMOUNT CONFIRMED (P)</label>
              <input
                id="edit-payment-amount-field"
                type="number"
                min="0"
                max={getPaymentSummary(editPaymentOrder).remainingAmount}
                step="0.01"
                value={editPaymentAmount}
                onChange={(e) => setEditPaymentAmount(e.target.value)}
                className={inputClass}
              />
              <div className={`mt-2 text-xs ${tertiaryTextClass}`}>
                Already paid: ₱{getPaymentSummary(editPaymentOrder).paidAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · Required downpayment: ₱{getPaymentSummary(editPaymentOrder).requiredAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              {editPaymentOrder.payment_proof_submitted_at && !isPaymentProofConfirmed(editPaymentOrder) && (
                <div className={`mt-1 text-xs ${tertiaryTextClass}`}>
                  The submitted amount is prefilled. Adjust it only if the amount actually received differs.
                </div>
              )}
            </div>

            <div>
              <div className={`mb-2 text-[11px] font-extrabold uppercase tracking-[0.18em] ${labelClass}`}>PAYMENT METHOD</div>
              <div className={optionWrapClass}>
                <button
                  type="button"
                  onClick={() => setEditPaymentMethod("Cash")}
                  className={`flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-bold transition ${editPaymentMethod === "Cash" ? cashSelectedClass : optionBaseClass}`}
                >
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full ${editPaymentMethod === "Cash" ? (darkMode ? "bg-emerald-400/20 text-emerald-300" : "bg-emerald-100 text-emerald-700") : darkMode ? "bg-slate-700 text-slate-300" : "bg-slate-100 text-slate-500"}`}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                      <path d="M3 8.5h12.5a3 3 0 0 1 0 6H3V8.5zm0 0V6.5a2 2 0 0 1 2-2h12.5" />
                      <path d="M18 9.5h3v5h-3" />
                    </svg>
                  </span>
                  Cash
                </button>
                <button
                  type="button"
                  onClick={() => setEditPaymentMethod("Online")}
                  className={`flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-bold transition ${editPaymentMethod === "Online" ? onlineSelectedClass : optionBaseClass}`}
                >
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full ${editPaymentMethod === "Online" ? (darkMode ? "bg-red-400/20 text-red-300" : "bg-red-100 text-red-700") : darkMode ? "bg-slate-700 text-slate-300" : "bg-slate-100 text-slate-500"}`}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                      <rect x="2.5" y="5" width="15" height="14" rx="2.5" />
                      <path d="M8 19h9.5a2.5 2.5 0 0 0 2.5-2.5V9.5" />
                      <path d="M14 12h5" />
                    </svg>
                  </span>
                  Online
                </button>
              </div>
            </div>

            {editPaymentMethod === "Online" && (
              <div>
                <div className={`mb-2 flex items-center justify-between gap-2 text-[11px] font-extrabold uppercase tracking-[0.18em] ${labelClass}`}>
                  <span>TRANSACTION NUMBER</span>
                  <span className={darkMode ? "text-slate-500" : "text-slate-400"}>Optional</span>
                </div>
                <input
                  type="text"
                  value={editPaymentTransactionNumber}
                  onChange={(e) => setEditPaymentTransactionNumber(e.target.value)}
                  placeholder="e.g. TXN-20240101-0001"
                  className={inputClass}
                />
              </div>
            )}

            <div className={panelClass + " px-3 py-2"}>
              {(() => {
                const paymentSummary = getPaymentSummary(editPaymentOrder);
                const preview = getPaymentSummary({
                  ...editPaymentOrder,
                  amount_paid: paymentSummary.paidAmount + (Number(editPaymentAmount) || 0),
                });
                return (
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className={darkMode ? "font-medium text-slate-300" : "font-medium text-slate-600"}>Payment Status Preview</span>
                <span className={darkMode ? "inline-flex items-center rounded-full border border-amber-400/40 bg-[#2f2a18] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-300" : "inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-700"}>{preview.status.label}</span>
              </div>
                );
              })()}
            </div>

            <div className={panelClass + " px-3 py-3"}>
              <div className="flex items-center justify-between gap-3">
                <span className={darkMode ? "text-sm text-slate-300" : "text-sm text-slate-600"}>Remaining Balance After This Payment</span>
                <span className={darkMode ? "text-sm font-bold text-red-400" : "text-sm font-bold text-red-600"}>
                  ₱{Math.max(getPaymentSummary(editPaymentOrder).remainingAmount - (Number(editPaymentAmount || 0)), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>

          <div className={footerClass}>
            <button type="button" onClick={closeEditPaymentModal} className={footerCancelClass}>Cancel</button>
            <button type="button" onClick={handleSavePaymentEdit} className={footerSaveClass}>Save Changes</button>
          </div>
        </div>
      </div>
    );
  })() : null;

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100">
      <Sidebar isOpen={isSidebarOpen} onToggle={() => setIsSidebarOpen((open) => !open)} />

      <div className="flex-1 min-h-0 flex flex-col">
        <Navbar />

        <main className="flex-1 min-h-0 overflow-y-auto p-6">

          <AdminPageHeader
            title="Transactions"
            description="Manage receipts, contracts and completed projects."
            compactStats
            statsClassName="grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-5"
            stats={[
              ...summaryMetrics,
            ]}
          />

          <div className="mt-6 md:hidden">
            <select
              aria-label="Transaction category"
              value={activeTable}
              onChange={(event) => setActiveTable(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100"
            >
              <option value="all">All</option>
              <option value="projects">Completed Projects</option>
              <option value="receipts">Contract &amp; Warranties</option>
              <option value="feedback">Customer Feedbacks</option>
            </select>
          </div>

          <div className="mt-6 hidden flex-wrap gap-4 md:flex">

            <button
              onClick={() => setActiveTable("all")}
              className={`px-5 py-3 rounded-xl font-medium ${
                activeTable === "all" ? "bg-red-600 text-white" : "bg-white border"
              }`}
            >
              All
            </button>

            <button
              onClick={() => setActiveTable("projects")}
              className={`px-5 py-3 rounded-xl font-medium ${
                activeTable === "projects" ? "bg-red-600 text-white" : "bg-white border"
              }`}
            >
              <CheckCircle className="inline mr-2" size={18} />
              Completed Projects
            </button>

            <button
              onClick={() => setActiveTable("receipts")}
              className={`px-5 py-3 rounded-xl font-medium ${
                activeTable === "receipts" ? "bg-red-600 text-white" : "bg-white border"
              }`}
            >
              Contract &amp; Warranties
            </button>

            <button
              onClick={() => setActiveTable("feedback")}
              className={`px-5 py-3 rounded-xl font-medium ${
                activeTable === "feedback" ? "bg-red-600 text-white" : "bg-white border"
              }`}
            >
              Customer Feedbacks
            </button>

          </div>

          <div className="mt-4">
            <input
              type="text"
              placeholder={activeTable === "feedback" ? "Search customer, product, tracking, review..." : "Search tracking, customer, project..."}
              value={tableSearch}
              onChange={(e) => {
                setTableSearch(e.target.value);
                if (activeTable === "feedback") setFeedbackPage(1);
              }}
              className="w-full md:w-1/3 pl-3 pr-3 py-2 border rounded-lg"
            />
          </div>

          <div className="bg-white rounded-3xl shadow mt-6 overflow-hidden">
            <div className="hidden md:block">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    {activeTable === "feedback" ? (
                      <tr>
                        <th className="p-4 text-left">Customer</th>
                        <th className="p-4 text-left">Product / Order</th>
                        <th className="p-4 text-left">Rating</th>
                        <th className="p-4 text-left">Photos</th>
                        <th className="p-4 text-left">Submitted</th>
                        <th className="p-4 text-center">Actions</th>
                      </tr>
                    ) : (
                      <tr>
                        <th className="p-4 text-left">Client</th>
                        <th className="p-4 text-left">Product / Project</th>
                        <th className="p-4 text-left">Paid / Total</th>
                        <th className="p-4 text-left">Method</th>
                        <th className="p-4 text-left">Customer Type</th>
                        <th className="p-4 text-left">Install Date</th>
                        <th className="p-4 text-left">Project Progress</th>
                        <th className="p-4 text-left">Status</th>
                        <th className="p-4 text-center">Actions</th>
                      </tr>
                    )}
                  </thead>
                  <tbody>
                    {currentData.map((order, index) => {
                      const customerName = order.customer_name || (order.customer ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim() : "N/A");
                      const productLabel = Array.isArray(order.items) && order.items.length > 0
                        ? (order.items.length > 1 ? "Batch Order" : (order.items[0].name || order.items[0].product_name || "Project"))
                        : "N/A";
                      const paymentSummary = getPaymentSummary(order);
                      const amountVal = paymentSummary.totalAmount;
                      const paidAmount = paymentSummary.paidAmount;
                      const amount = `₱${Number(amountVal || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                      const inspectionLabel = productLabel;
                      const orderType = order.order_type === "walk_in_customer" ? "Walk-in" : "Website Order";
                      const paymentMethod = order.payment_method || (order.acceptance_method === "online" ? "Online" : "Cash");
                      const installDate = order.estimated_installation_date ? formatDateToMMDDYYYY(order.estimated_installation_date) : "—";
                      const projectCategory = isCompletedProject(order) ? "Completed" : "In Progress";
                      const statusLabel = paymentSummary.status.label;
                      const isFullyPaid = paymentSummary.status.key === "paid";
                      const showNeedsConfirmation = Boolean(order.payment_proof_submitted_at && !isPaymentProofConfirmed(order));

                      return (
                        <tr
                          key={activeTable === "feedback" ? `${order._id || order.id || index}-${Number.isInteger(order.reviewItemIndex) ? `item-${order.reviewItemIndex}` : "order-review"}` : order._id || index}
                          data-notification-record-id={order._id || order.id ? String(order._id || order.id) : undefined}
                          className={`border-t transition-colors ${highlightedNotificationRecordId === String(order._id || order.id || "") ? "bg-amber-100 ring-2 ring-inset ring-amber-500" : "hover:bg-gray-50"}`}
                        >
                          {activeTable === "feedback" ? (
                            <>
                              <td className="p-4">{renderClientCell(order, customerName)}</td>
                              <td className="p-4">
                                <div className="space-y-1">
                                  <div className="font-semibold text-slate-900">{order.reviewProductName || "Order feedback"}</div>
                                  <div className="text-xs text-slate-500">{Number.isInteger(order.reviewItemIndex) ? "Product review" : "Order review"}</div>
                                  <div className="text-xs text-slate-500">Order ID: {order.tracking || order._id || order.id || "—"}</div>
                                </div>
                              </td>
                              <td className="p-4">
                                <div className="flex items-center gap-1" aria-label={`${Number(order.review?.rating || 0)} out of 5 stars`}>
                                  {Array.from({ length: 5 }, (_, starIndex) => (
                                    <Star key={starIndex} size={15} className={starIndex < Number(order.review?.rating || 0) ? "fill-amber-400 text-amber-400" : "text-slate-300"} />
                                  ))}
                                  <span className="ml-1 text-sm font-semibold text-slate-700">{Number(order.review?.rating || 0)}/5</span>
                                </div>
                              </td>
                              <td className="p-4">
                                <div className="flex flex-wrap gap-2">
                                  {(order.review?.photos || []).map((photo, photoIndex) => (
                                    <a key={`${photo}-${photoIndex}`} href={photo} target="_blank" rel="noreferrer" aria-label={`Open review photo ${photoIndex + 1}`}>
                                      <img src={photo} alt={`Review attachment ${photoIndex + 1}`} className="h-12 w-12 rounded-md border border-slate-200 object-cover" />
                                    </a>
                                  ))}
                                  {!(order.review?.photos || []).length && <span className="text-sm text-slate-400">None</span>}
                                </div>
                              </td>
                              <td className="whitespace-nowrap p-4 text-sm text-slate-600">
                                {order.review?.submittedAt ? formatDateToMMMDDYYYY(order.review.submittedAt) : "—"}
                              </td>
                              <td className="p-4 text-center">
                                <div className="flex justify-center gap-2">
                                  <button type="button" onClick={() => setFeedbackPreviewOrder(order)} className={`inline-flex h-9 w-9 items-center justify-center rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${darkMode ? "bg-blue-500/15 text-blue-300 hover:bg-blue-500/25" : "bg-blue-100 text-blue-600 hover:bg-blue-200"}`} aria-label={`View feedback for ${order.reviewProductName || "order"} from ${customerName}`} title="View feedback">
                                    <Eye size={17} aria-hidden="true" />
                                  </button>
                                  <button type="button" onClick={() => setFeedbackDeleteOrder(order)} className={`inline-flex h-9 w-9 items-center justify-center rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${darkMode ? "bg-red-500/15 text-red-300 hover:bg-red-500/25" : "bg-red-100 text-red-600 hover:bg-red-200"}`} aria-label={`Delete feedback for ${order.reviewProductName || "order"} from ${customerName}`} title="Delete Customer Feedback">
                                    <Trash2 size={17} aria-hidden="true" />
                                  </button>
                                </div>
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="p-4">{renderClientCell(order, customerName)}</td>
                              <td className="p-4"><div className="font-semibold text-slate-900">{inspectionLabel}</div><div className="text-xs text-slate-500">Order ID: {order.tracking || order._id || order.id || "—"}</div></td>
                              <td className="p-4"><div className="font-bold text-emerald-600">₱{paidAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div><div className="text-xs text-slate-500">of {amount}</div></td>
                              <td className="p-4"><span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${paymentMethod === "Online" ? (darkMode ? "border border-rose-400/40 bg-rose-500/15 text-rose-300" : "bg-rose-50 text-rose-700") : (darkMode ? "border border-emerald-400/40 bg-emerald-500/15 text-emerald-300" : "bg-emerald-50 text-emerald-700")}`}>{paymentMethod}</span></td>
                              <td className="p-4"><span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">{orderType}</span></td>
                              <td className="p-4 text-sm text-slate-600">{installDate}</td>
                              <td className="p-4"><span className={`inline-flex rounded-md px-3 py-1 text-xs font-semibold ${projectCategory === "Completed" ? "bg-rose-50 text-rose-700" : "bg-violet-50 text-violet-700"}`}>{projectCategory}</span></td>
                              <td className="p-4"><div className="flex flex-col items-start gap-1.5"><span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${isFullyPaid ? (darkMode ? "border border-emerald-400/40 bg-emerald-500/15 text-emerald-300" : "bg-emerald-100 text-emerald-700") : (darkMode ? "border border-amber-400/40 bg-amber-500/15 text-amber-300" : "bg-amber-50 text-amber-700")}`}>{statusLabel}</span>{showNeedsConfirmation && (<span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${darkMode ? "border border-rose-400/40 bg-rose-500/15 text-rose-300" : "bg-rose-100 text-rose-700"}`}><span aria-hidden="true">🔔</span>Needs Confirmation</span>)}</div></td>
                              <td className="p-4"><div className="flex flex-wrap justify-center gap-2">{activeTable === "projects" && canCreateWarranty(order) && (<button title="Create Warranty" onClick={() => openWarrantyModal(order)} className="p-2 rounded-lg bg-green-100 text-green-700 hover:bg-green-200 transition"><ShieldCheck size={20} /></button>)}<button title="View Transaction" onClick={() => openContractModal(order)} className="p-2 rounded-lg bg-blue-100 text-blue-600 hover:bg-blue-200 transition"><Eye size={18} /></button>{isFullyPaid ? (<button type="button" title="Fully paid" aria-label="Fully paid. Payment editing is locked." disabled className={`cursor-not-allowed rounded-lg p-2 ${darkMode ? "bg-slate-700 text-slate-400" : "bg-slate-100 text-slate-500"}`}><Lock size={18} aria-hidden="true" /></button>) : (<button type="button" title="Add Payment" aria-label="Add Payment" onClick={() => openEditPaymentModal(order)} className="p-2 rounded-lg bg-violet-100 text-violet-700 hover:bg-violet-200 transition"><Pencil size={18} /></button>)}<button type="button" title="View Contract" aria-label="View Contract" onClick={() => openReadOnlyContract(order)} className="p-2 rounded-lg bg-amber-100 text-amber-700 hover:bg-amber-200 transition"><FileText size={18} /></button></div></td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-3 p-3 md:hidden">
              {currentData.map((order, index) => {
                const customerName = order.customer_name || (order.customer ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim() : "N/A");
                if (activeTable === "feedback") {
                  const feedbackRowKey = `${order._id || order.id || index}-${Number.isInteger(order.reviewItemIndex) ? `item-${order.reviewItemIndex}` : "order-review"}`;
                  return (
                    <article key={feedbackRowKey} className={`rounded-xl border p-3 ${darkMode ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{order.reviewProductName || "Order feedback"}</p>
                          <p className={`mt-1 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{customerName} · {order.tracking || order._id || order.id || "—"}</p>
                        </div>
                        <span className="shrink-0 text-xs font-semibold text-slate-500">{order.review?.submittedAt ? formatDateToMMMDDYYYY(order.review.submittedAt) : "—"}</span>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-1" aria-label={`${Number(order.review?.rating || 0)} out of 5 stars`}>
                          {Array.from({ length: 5 }, (_, starIndex) => (
                            <Star key={starIndex} size={14} className={starIndex < Number(order.review?.rating || 0) ? "fill-amber-400 text-amber-400" : "text-slate-300"} />
                          ))}
                          <span className="ml-1 text-xs font-semibold">{Number(order.review?.rating || 0)}/5</span>
                        </div>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => setFeedbackPreviewOrder(order)} aria-label={`View feedback for ${order.reviewProductName || "order"}`} className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${darkMode ? "bg-blue-500/15 text-blue-300" : "bg-blue-100 text-blue-600"}`}>
                            <Eye size={17} aria-hidden="true" />
                          </button>
                          <button type="button" onClick={() => setFeedbackDeleteOrder(order)} aria-label={`Delete feedback for ${order.reviewProductName || "order"}`} className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${darkMode ? "bg-red-500/15 text-red-300" : "bg-red-100 text-red-600"}`}>
                            <Trash2 size={17} aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                      {order.review?.comment && <p className={`mt-2 line-clamp-2 text-xs ${darkMode ? "text-slate-300" : "text-slate-600"}`}>{order.review.comment}</p>}
                    </article>
                  );
                }
                const productLabel = Array.isArray(order.items) && order.items.length > 0 ? (order.items.length > 1 ? "Batch Order" : (order.items[0].name || order.items[0].product_name || "Project")) : "N/A";
                const paymentSummary = getPaymentSummary(order);
                const amountVal = paymentSummary.totalAmount;
                const paymentMethod = order.payment_method || (order.acceptance_method === "online" ? "Online" : "Cash");
                const isFullyPaid = paymentSummary.status.key === "paid";

                return (
                  <div
                    key={order._id || index}
                    data-notification-record-id={order._id || order.id ? String(order._id || order.id) : undefined}
                    className={`rounded-2xl border p-3 transition-colors ${highlightedNotificationRecordId === String(order._id || order.id || "") ? "border-amber-500 bg-amber-100 ring-2 ring-amber-400" : "border-gray-200 bg-gray-50"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-slate-900">{productLabel}</p>
                        <p className="mt-1 text-xs text-slate-500">{customerName}</p>
                        <p className="mt-1 break-all text-[10px] text-slate-500">Order ID: {order.tracking || order._id || order.id || "—"}</p>
                      </div>
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ${isFullyPaid ? "bg-emerald-100 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                        {paymentSummary.status.label}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-slate-400">Method</p>
                        <p className="mt-1 font-medium text-slate-700">{paymentMethod}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-slate-400">Amount</p>
                        <p className="mt-1 font-semibold text-slate-900">₱{Number(amountVal || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex justify-end gap-2">
                      <button title="View Transaction" onClick={() => openContractModal(order)} className="p-2 rounded-lg bg-blue-100 text-blue-600 hover:bg-blue-200 transition"><Eye size={18} /></button>
                      {isFullyPaid ? (
                        <button type="button" title="Fully paid" aria-label="Fully paid. Payment editing is locked." disabled className="cursor-not-allowed rounded-lg bg-slate-100 p-2 text-slate-500">
                          <Lock size={18} aria-hidden="true" />
                        </button>
                      ) : (
                        <button type="button" title="Add Payment" aria-label="Add Payment" onClick={() => openEditPaymentModal(order)} className="p-2 rounded-lg bg-violet-100 text-violet-700 hover:bg-violet-200 transition"><Pencil size={18} /></button>
                      )}
                      {activeTable === "projects" && canCreateWarranty(order) && (<button title="Create Warranty" onClick={() => openWarrantyModal(order)} className="p-2 rounded-lg bg-green-100 text-green-700 hover:bg-green-200 transition"><ShieldCheck size={20} /></button>)}
                      <button type="button" title="View Contract" aria-label="View Contract" onClick={() => openReadOnlyContract(order)} className="p-2 rounded-lg bg-amber-100 text-amber-700 hover:bg-amber-200 transition"><FileText size={18} /></button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pagination */}

            <div className="hidden justify-center items-center p-4 border-t bg-gray-50 gap-4 md:flex">

              <span className="text-sm text-gray-600">
                Page {" "}
                {activePage}
                {" "}of{" "}
                {activeTotalPages}
              </span>

              <div className="flex gap-2">

                <button
                  disabled={activePage === 1}
                  onClick={() => setActivePage(activePage - 1)}
                  className="px-4 py-2 border rounded-lg"
                >
                  Previous
                </button>

                {[...Array(activeTotalPages)].map((_, index) => (
                  <button
                    key={index}
                    onClick={() => setActivePage(index + 1)}
                    className={`w-10 h-10 rounded-lg ${
                      activePage === index + 1
                        ? "bg-red-600 text-white"
                        : "bg-white border"
                    }`}
                  >
                    {index + 1}
                  </button>
                ))}

                <button
                  disabled={activePage === activeTotalPages}
                  onClick={() => setActivePage(activePage + 1)}
                  className="px-4 py-2 border rounded-lg"
                >
                  Next
                </button>

              </div>

            </div>

          </div>

          <Toaster position="bottom-right" />

          {showContractModal && contractPreviewOrder && (() => {
            const savedWarrantyStart = contractPreviewOrder.warranty_start_date
              || contractPreviewOrder.warrantyStartDate
              || contractPreviewOrder.warranty_start
              || getInstallationCompletionDate(contractPreviewOrder)
              || contractPreviewOrder.estimated_installation_date
              || null;
            const warrantyDays = Number(contractPreviewOrder.warranty_period || contractPreviewOrder.warranty_period_value || contractPreviewOrder.warranty_days || 90) || 90;
            const derivedWarrantyExpiry = savedWarrantyStart ? new Date(savedWarrantyStart) : null;
            if (derivedWarrantyExpiry) derivedWarrantyExpiry.setDate(derivedWarrantyExpiry.getDate() + warrantyDays);
            const previewWarrantyExpiry = contractPreviewOrder.warranty_expiry_date || contractPreviewOrder.warrantyExpiryDate || contractPreviewOrder.warranty_end_date || contractPreviewOrder.warranty_end || getWarrantyExpiry(contractPreviewOrder) || derivedWarrantyExpiry;
            const warrantyPeriodText = contractPreviewOrder.warranty_period || (contractPreviewOrder.warranty_period_value ? `${contractPreviewOrder.warranty_period_value}-day warranty` : `${warrantyDays}-day warranty`);
            const remainingWarrantyDays = previewWarrantyExpiry
              ? Math.max(0, Math.ceil((new Date(previewWarrantyExpiry) - new Date()) / (1000 * 60 * 60 * 24)))
              : 0;
            const formattedStart = formatDateToMMMDDYYYY(savedWarrantyStart) || "TBD";
            const formattedExpiry = formatDateToMMMDDYYYY(previewWarrantyExpiry) || "TBD";
            const contractNo = contractPreviewOrder.contract_number || contractPreviewOrder.contractId || contractPreviewOrder.tracking || contractPreviewOrder._id || "N/A";
            const createdDate = contractPreviewOrder.createdAt || contractPreviewOrder.updatedAt || contractPreviewOrder.contract_date || new Date();
            const inspectionDate = formatDateToMMMDDYYYY(contractPreviewOrder.inspection_date) || "TBD";
            const paymentTermsText = contractPreviewOrder.payment_terms || "50% downpayment, 50% upon completion";
            const previewItems = Array.isArray(contractPreviewOrder.items) ? contractPreviewOrder.items : [];
            const hasBatchItems = previewItems.length > 1;
            const perProductWarranty = contractPreviewOrder.warranty_assignment_mode === "per_product";
            const getPreviewItemWarranty = (item) => {
              const itemStatus = String(item.warranty_status || contractPreviewOrder.warranty_status || "").toLowerCase();
              const period = item.warranty_period || (perProductWarranty ? "" : contractPreviewOrder.warranty_period);
              const isNoWarranty = period === "No Warranty" || itemStatus === "no_warranty";
              const customDays = Number(item.custom_warranty_days || contractPreviewOrder.custom_warranty_days) || 0;
              const durationDays = period === "Custom"
                ? customDays || 90
                : parseWarrantyPeriod(period)?.days || Number(period) || null;
              const installationDate = getInstallationCompletionDate(contractPreviewOrder, item);
              const isInstalled = Boolean(installationDate && installationDate <= new Date());
              const storedStart = item.warranty_status === "pending" ? null : item.warranty_start_date;
              const startDate = isNoWarranty
                ? null
                : storedStart ? new Date(storedStart) : installationDate;
              const storedExpiry = item.warranty_status === "pending" ? null : item.warranty_expiry_date;
              const expiryDate = isNoWarranty || !startDate || !durationDays
                ? null
                : storedExpiry
                  ? new Date(storedExpiry)
                  : computeWarrantyExpiryDate(startDate, durationDays);
              const startsInFuture = Boolean(startDate && startDate > new Date());
              const isActive = itemStatus === "active" && !startsInFuture && (!expiryDate || expiryDate > new Date());
              const statusLabel = isNoWarranty
                ? "No warranty"
                : isActive
                  ? "Active"
                  : itemStatus === "expired" || (expiryDate && expiryDate <= new Date())
                    ? "Expired"
                    : isInstalled ? "Pending activation" : "Pending installation";

              return {
                periodLabel: isNoWarranty ? "No Warranty" : durationDays ? `${durationDays} days` : "Not assigned",
                startLabel: isNoWarranty ? "—" : startDate ? formatDateToMMMDDYYYY(startDate) || "TBD" : "Pending installation",
                expiryLabel: isNoWarranty ? "—" : expiryDate ? formatDateToMMMDDYYYY(expiryDate) || "TBD" : isInstalled ? "Pending activation" : "Pending installation",
                statusLabel,
              };
            };
            const paymentSummary = getPaymentSummary(contractPreviewOrder);
            const orderIdentifier = contractPreviewOrder.tracking || contractPreviewOrder._id || contractPreviewOrder.id || "—";

            return (
              <div className="mobile-fullscreen-overlay fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/40 px-3 py-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:items-center sm:p-5">
                <div className="mobile-fullscreen-dialog relative flex max-h-[calc(100dvh-1.5rem)] min-h-0 w-full max-w-[620px] flex-col overflow-hidden rounded-lg border border-slate-200 bg-slate-100 shadow-[0_18px_50px_rgba(15,23,42,0.22)] sm:max-h-[90dvh]">
                  <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-500">TRANSACTION DETAILS</div>
                    <div className="mt-1 text-[17px] font-bold leading-tight text-slate-800">
                      {contractPreviewOrder.customer_name || `${contractPreviewOrder.customer?.first_name || ""} ${contractPreviewOrder.customer?.last_name || ""}`.trim() || "Customer"}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Order ID: {orderIdentifier}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={closeContractModal}
                    className="rounded-md p-1.5 text-slate-500 transition hover:bg-slate-200 hover:text-slate-800"
                    aria-label="Close transaction details"
                  >
                    <XCircle size={16} />
                  </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-slate-100 p-3">
                  <div className="mb-3 flex flex-wrap gap-2">
                    <span className={`rounded-md border px-2 py-1 text-[10px] font-semibold ${paymentSummary.status.key === "paid" ? "border-emerald-200 bg-emerald-100 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
                      {paymentSummary.status.label}
                    </span>
                    <span className="rounded-md border border-blue-200 bg-blue-100 px-2 py-1 text-[10px] font-semibold text-blue-700">
                      Completed Project
                    </span>
                    <span className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-700">
                      Website Order
                    </span>
                  </div>

                  <section className="rounded-md border border-slate-200 bg-white p-3">
                    <h3 className="mb-3 border-b border-slate-200 pb-2 text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-500">
                      CLIENT INFORMATION
                    </h3>

                    <div className="grid gap-2 md:grid-cols-2">
                      <div className="space-y-1">
                        <div className="text-[10px] font-semibold text-slate-500">Full Name</div>
                        <div className="text-[13px] font-semibold text-slate-800">
                          {contractPreviewOrder.customer_name || `${contractPreviewOrder.customer?.first_name || ""} ${contractPreviewOrder.customer?.last_name || ""}`.trim() || "N/A"}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-[10px] font-semibold text-slate-500">Order ID</div>
                        <div className="break-all text-[13px] font-semibold text-slate-800">{orderIdentifier}</div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-[10px] font-semibold text-slate-500">Email</div>
                        <div className="text-[13px] text-slate-700">{contractPreviewOrder.customer?.email || contractPreviewOrder.customer_email || "N/A"}</div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-[10px] font-semibold text-slate-500">Phone</div>
                        <div className="text-[13px] text-slate-700">{contractPreviewOrder.customer?.phone || contractPreviewOrder.customer_phone || "N/A"}</div>
                      </div>
                      <div className="space-y-1 md:col-span-2">
                        <div className="text-[10px] font-semibold text-slate-500">Address</div>
                        <div className="text-[13px] text-slate-700">
                          {contractPreviewOrder.shipping_address || contractPreviewOrder.address || "N/A"}
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="mt-3 rounded-md border border-slate-200 bg-white p-3">
                    <h3 className="mb-3 border-b border-slate-200 pb-2 text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-500">
                      MEASUREMENTS &amp; PROGRESS MATRIX
                    </h3>

                    {previewItems.length > 0 ? (
                      <div className="space-y-2">
                        {previewItems.map((item, index) => {
                          const itemName = item.name || item.product_name || `Item ${index + 1}`;
                          const warranty = getPreviewItemWarranty(item);
                          return (
                            <div key={`${itemName}-${index}`} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[13px]">
                              <div className="font-semibold text-slate-800">{itemName}</div>
                              <div className="mt-1 text-slate-600">
                                Size: {item.width || "—"}W x {item.height || "—"}H | Qty: {item.quantity || 1} | Base Rate: ₱{Number(item.unit_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/sqft
                              </div>
                              {hasBatchItems && (
                                <div className="mt-2 border-t border-slate-200 pt-2 text-xs text-slate-600">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="font-semibold">Warranty: {warranty.periodLabel}</span>
                                    <span className={`rounded-full px-2 py-0.5 font-semibold ${warranty.statusLabel === "Active" ? "bg-emerald-100 text-emerald-700" : warranty.statusLabel === "Expired" ? "bg-slate-200 text-slate-700" : "bg-amber-100 text-amber-700"}`}>
                                      {warranty.statusLabel}
                                    </span>
                                  </div>
                                  <div className="mt-1 grid grid-cols-2 gap-2">
                                    <span>Start: {warranty.startLabel}</span>
                                    <span>End: {warranty.expiryLabel}</span>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-600">
                        No item measurements available.
                      </div>
                    )}
                  </section>

                  <section className="mt-3 rounded-md border border-slate-200 bg-white p-3">
                    <h3 className="mb-3 border-b border-slate-200 pb-2 text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-500">
                      PAYMENT BREAKDOWN
                    </h3>

                    <div className="space-y-2 text-[13px]">
                      <div className="flex items-center justify-between gap-4 border-b border-slate-200 pb-2">
                        <span className="text-slate-600">Total Project Amount</span>
                        <span className="font-semibold text-slate-800">₱{paymentSummary.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                      <div className="flex items-center justify-between gap-4 border-b border-slate-200 pb-2">
                        <span className="text-slate-600">Amount Paid</span>
                        <span className="font-semibold text-slate-800">₱{paymentSummary.paidAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-slate-600">Remaining Balance</span>
                        <span className="font-bold text-red-600">
                          ₱{paymentSummary.remainingAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-emerald-100">
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${paymentSummary.totalAmount > 0 ? Math.min((paymentSummary.paidAmount / paymentSummary.totalAmount) * 100, 100) : 0}%` }} />
                      </div>
                    </div>
                  </section>

                  <section className="mt-3 rounded-md border border-slate-200 bg-white p-3">
                    <h3 className="mb-3 border-b border-slate-200 pb-2 text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-500">
                      PAYMENT INFORMATION
                    </h3>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-1">
                        <div className="text-[10px] font-semibold text-slate-500">Payment Terms</div>
                        <div className="text-[13px] text-slate-700">{paymentTermsText}</div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-[10px] font-semibold text-slate-500">Payment Date</div>
                        <div className="text-[13px] text-slate-700">—</div>
                      </div>
                    </div>

                    <div className="mt-4 space-y-3">
                      <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                        <h4 className="mb-3 border-b border-slate-200 pb-2 text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-500">
                          CONTRACT INFORMATION
                        </h4>

                        <div className="space-y-2 text-[13px] text-slate-700">
                          <div className="flex items-center justify-between gap-4 border-b border-slate-200 pb-2">
                            <span className="text-slate-600">Contract No.</span>
                            <span className="font-semibold text-slate-800">{contractNo}</span>
                          </div>
                          <div className="flex items-center justify-between gap-4 border-b border-slate-200 pb-2">
                            <span className="text-slate-600">Date Created</span>
                            <span className="font-semibold text-slate-800">{formatDateToMMMDDYYYY(createdDate)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-4 border-b border-slate-200 pb-2">
                            <span className="text-slate-600">Inspection Date</span>
                            <span className="font-semibold text-slate-800">{inspectionDate}</span>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                        <h4 className="mb-3 border-b border-slate-200 pb-2 text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-500">
                          WARRANTY INFORMATION
                        </h4>

                        <div className={hasBatchItems ? "space-y-3" : "space-y-2 text-[13px] text-slate-700"}>
                          {hasBatchItems ? previewItems.map((item, index) => {
                            const itemName = item.name || item.product_name || `Product ${index + 1}`;
                            const warranty = getPreviewItemWarranty(item);
                            const statusClass = warranty.statusLabel === "Active"
                              ? "bg-emerald-50 text-emerald-700"
                              : warranty.statusLabel === "Expired"
                                ? "bg-slate-100 text-slate-600"
                                : warranty.statusLabel === "No warranty"
                                  ? "bg-slate-100 text-slate-600"
                                  : "bg-amber-50 text-amber-700";
                            return (
                              <div key={`${itemName}-warranty-${index}`} className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <h5 className="break-words text-sm font-semibold text-slate-900">{itemName}</h5>
                                    <p className="mt-1 text-xs text-slate-500">{warranty.periodLabel}</p>
                                  </div>
                                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${statusClass}`}>
                                    {warranty.statusLabel}
                                  </span>
                                </div>
                                <div className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2">
                                  <div className="min-w-0 rounded-md bg-slate-50 px-3 py-2">
                                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Warranty Start</p>
                                    <p className="mt-1 break-words text-sm font-medium text-slate-800">{warranty.startLabel}</p>
                                  </div>
                                  <div className="min-w-0 rounded-md bg-slate-50 px-3 py-2">
                                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Warranty End</p>
                                    <p className="mt-1 break-words text-sm font-medium text-slate-800">{warranty.expiryLabel}</p>
                                  </div>
                                </div>
                              </div>
                            );
                          }) : (
                            <>
                              <div className="flex items-center justify-between gap-4 border-b border-slate-200 pb-2">
                                <span className="text-slate-600">Warranty Start</span>
                                <span className="font-semibold text-slate-800">{formattedStart}</span>
                              </div>
                              <div className="flex items-center justify-between gap-4 border-b border-slate-200 pb-2">
                                <span className="text-slate-600">Warranty End</span>
                                <span className="font-semibold text-slate-800">{formattedExpiry}</span>
                              </div>
                              <div className="flex items-center justify-between gap-4">
                                <span className="text-slate-600">Remaining Warranty Days ({warrantyPeriodText})</span>
                                <span className="inline-flex rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-700">{remainingWarrantyDays} days remaining</span>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </section>
                </div>

                  <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200 bg-white px-4 py-3 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      onClick={closeContractModal}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 sm:w-auto sm:py-1.5"
                    >
                      Close
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        openFullContractModal();
                        setShowWarrantyModal(false);
                      }}
                      className="w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-100 sm:w-auto sm:py-1.5"
                    >
                      View Contract
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}

          {editPaymentModalContent}

          {showFullContractModal && contractPreviewOrder && contractPreviewData && (
            <ContractModal
              isOpen={showFullContractModal}
              onClose={closeContractModal}
              inspection={contractPreviewOrder}
              contractData={contractPreviewData}
            />
          )}

          {showWarrantyModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              <div className="absolute inset-0 bg-black/40" onClick={closeWarrantyModal} />
              <div className="relative w-full max-w-2xl rounded-3xl bg-white p-6 shadow-xl">
                <h2 className="text-2xl font-bold text-slate-900 mb-3">Create Warranty</h2>
                <p className="text-sm text-slate-600 mb-6">
                  Warranty coverage starts when project installation is completed.
                </p>

                <div className="grid gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Customer</label>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-800">
                      {warrantyOrder?.customer_name || `${warrantyOrder?.customer?.first_name || ''} ${warrantyOrder?.customer?.last_name || ''}`.trim() || "N/A"}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">{warrantyOrder?.items?.length > 1 ? "Products & Warranty" : "Project"}</label>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-800">
                      {warrantyOrder?.items?.length > 1 ? (
                        <div className="space-y-2">
                          {warrantyOrder.items.map((item, index) => {
                            const perProduct = warrantyOrder.warranty_assignment_mode === "per_product";
                            const period = perProduct
                              ? item.warranty_period || warrantyOrder.warranty_period || 90
                              : warrantyOrder.warranty_period || 90;
                            const customDays = perProduct
                              ? Number(item.custom_warranty_days) || Number(period) || 90
                              : Number(warrantyOrder.custom_warranty_days) || Number(period) || 90;
                            const periodDays = period === "Custom"
                              ? customDays
                              : parseWarrantyPeriod(period)?.days || Number(period) || customDays;
                            const itemStart = perProduct
                              ? getInstallationCompletionDate(warrantyOrder, item) || getInstallationCompletionDate(warrantyOrder)
                              : warrantyStartDate ? new Date(warrantyStartDate) : getInstallationCompletionDate(warrantyOrder);
                            const expiry = period === "No Warranty"
                              ? null
                              : perProduct
                                ? computeWarrantyExpiryDate(itemStart, period === "Custom" ? customDays : period)
                                : warrantyExpiryDate ? new Date(warrantyExpiryDate) : computeWarrantyExpiryDate(warrantyStartDate, period);
                            return (
                              <div key={`${item.product_id || item.name || "product"}-${index}`} className="flex flex-col gap-1 border-b border-slate-200 pb-2 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                                <span className="font-medium">{item.name || item.product_id?.name || `Product ${index + 1}`}</span>
                                <span className="text-sm text-slate-600">
                                  {period === "No Warranty" ? "No Warranty" : `${periodDays} days`}
                                  {period !== "No Warranty" && itemStart ? ` · Starts ${formatDateToMMMDDYYYY(itemStart)}` : ""}
                                  {expiry ? ` · Ends ${formatDateToMMMDDYYYY(expiry)}` : ""}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        warrantyOrder?.items?.[0]?.name || "N/A"
                      )}
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Warranty Start</label>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-slate-800">
                        {formatDateToMMMDDYYYY(warrantyStartDate) || "Installation completion date required"}
                      </div>
                    </div>

                    {warrantyOrder?.warranty_assignment_mode !== "per_product" && (
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">Warranty Expiry</label>
                        <input
                          type="date"
                          min={warrantyStartDate || today}
                          value={warrantyExpiryDate}
                          onChange={(e) => handleWarrantyExpiryDateChange(e.target.value)}
                          className="w-full rounded-xl border border-slate-300 px-4 py-2"
                        />
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Terms</label>
                    <textarea
                      rows={4}
                      value={warrantyTerms}
                      onChange={(e) => setWarrantyTerms(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-4 py-3"
                    />
                  </div>
                </div>

                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={closeWarrantyModal}
                    className="rounded-2xl px-5 py-3 bg-gray-100 text-slate-700 hover:bg-gray-200 transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleCreateWarranty}
                    disabled={warrantySaving}
                    className={`rounded-2xl px-5 py-3 text-white transition ${warrantySaving ? "bg-amber-300" : "bg-amber-600 hover:bg-amber-700"}`}
                  >
                    {warrantySaving ? "Saving..." : "Create Warranty"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {feedbackPreviewOrder && (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
              role="presentation"
              onClick={(event) => event.target === event.currentTarget && setFeedbackPreviewOrder(null)}
            >
              <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="feedback-preview-title"
                className={`flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border ${darkMode ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}
              >
                <header className={`flex items-start justify-between gap-4 border-b px-5 py-4 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                  <div className="min-w-0">
                    <h2 id="feedback-preview-title" className="text-lg font-semibold">Customer feedback</h2>
                    <p className={`mt-1 truncate text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                      {feedbackPreviewOrder.customer_name || `${feedbackPreviewOrder.customer?.first_name || ""} ${feedbackPreviewOrder.customer?.last_name || ""}`.trim() || "Customer"}
                      {feedbackPreviewOrder.tracking ? ` · ${feedbackPreviewOrder.tracking}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFeedbackPreviewOrder(null)}
                    aria-label="Close feedback"
                    className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${darkMode ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                  >
                    <X size={17} aria-hidden="true" />
                  </button>
                </header>

                <div className="flex-1 space-y-4 overflow-y-auto p-5">
                  <section className={`rounded-xl border p-4 ${darkMode ? "border-slate-700 bg-slate-800/70" : "border-slate-200 bg-slate-50"}`}>
                    <h3 className={`border-b pb-2 text-[11px] font-semibold uppercase tracking-wide ${darkMode ? "border-slate-700 text-slate-400" : "border-slate-200 text-slate-500"}`}>Customer Info</h3>
                    <dl className="mt-3 space-y-2 text-sm">
                      <div className="flex items-start justify-between gap-4">
                        <dt className={`shrink-0 ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Full Name</dt>
                        <dd className="min-w-0 break-words text-right font-medium">
                          {feedbackPreviewOrder.customer_name || `${feedbackPreviewOrder.customer?.first_name || ""} ${feedbackPreviewOrder.customer?.last_name || ""}`.trim() || "N/A"}
                        </dd>
                      </div>
                      <div className="flex items-start justify-between gap-4">
                        <dt className={`shrink-0 ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Email / Contact</dt>
                        <dd className="min-w-0 break-all text-right font-medium">
                          {feedbackPreviewOrder.customer?.email || feedbackPreviewOrder.customer_email || feedbackPreviewOrder.customer?.phone || feedbackPreviewOrder.customer_phone || "N/A"}
                        </dd>
                      </div>
                    </dl>
                  </section>

                  <section className={`rounded-xl border p-4 ${darkMode ? "border-slate-700 bg-slate-800/70" : "border-slate-200 bg-slate-50"}`}>
                    <h3 className={`border-b pb-2 text-[11px] font-semibold uppercase tracking-wide ${darkMode ? "border-slate-700 text-slate-400" : "border-slate-200 text-slate-500"}`}>Project Summary</h3>
                    <dl className="mt-3 space-y-2 text-sm">
                      <div className="flex items-start justify-between gap-4">
                        <dt className={`shrink-0 ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Product / Project</dt>
                        <dd className="min-w-0 text-right font-medium">
                          {feedbackPreviewOrder.reviewProductName || (feedbackPreviewOrder.items || []).map((item) => item.name || item.product_name).filter(Boolean).join(", ") || "N/A"}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <dt className={darkMode ? "text-slate-400" : "text-slate-500"}>Category</dt>
                        <dd className="text-right font-medium">{isCompletedProject(feedbackPreviewOrder) ? "Completed Project" : "In Progress"}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <dt className={darkMode ? "text-slate-400" : "text-slate-500"}>Total Amount</dt>
                        <dd className="text-right font-semibold">₱{Number(feedbackPreviewOrder.contract_amount || feedbackPreviewOrder.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</dd>
                      </div>
                    </dl>
                  </section>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-1" aria-label={`${Number(feedbackPreviewOrder.review?.rating || 0)} out of 5 stars`}>
                      {Array.from({ length: 5 }, (_, index) => (
                        <Star
                          key={index}
                          size={18}
                          className={index < Number(feedbackPreviewOrder.review?.rating || 0) ? "fill-amber-400 text-amber-400" : darkMode ? "text-slate-600" : "text-slate-300"}
                          aria-hidden="true"
                        />
                      ))}
                      <span className={`ml-1 text-sm font-medium ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                        {Number(feedbackPreviewOrder.review?.rating || 0)}/5
                      </span>
                    </div>
                    <span className={`text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                      {feedbackPreviewOrder.review?.submittedAt ? formatDateToMMMDDYYYY(feedbackPreviewOrder.review.submittedAt) : "—"}
                    </span>
                  </div>

                  {feedbackPreviewOrder.review?.title && (
                    <h3 className="text-base font-semibold">{feedbackPreviewOrder.review.title}</h3>
                  )}
                  <p className={`whitespace-pre-line break-words text-sm leading-6 ${darkMode ? "text-slate-300" : "text-slate-700"}`}>
                    {feedbackPreviewOrder.review?.comment || "No written feedback."}
                  </p>

                  <div>
                    <h3 className={`mb-2 text-sm font-medium ${darkMode ? "text-slate-200" : "text-slate-800"}`}>Photos</h3>
                    {(feedbackPreviewOrder.review?.photos || []).length > 0 ? (
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {feedbackPreviewOrder.review.photos.map((photo, index) => (
                          <a
                            key={`${photo}-${index}`}
                            href={photo}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Open review photo ${index + 1}`}
                            className={`aspect-square overflow-hidden rounded-lg border ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-slate-50"}`}
                          >
                            <img src={photo} alt={`Review photo ${index + 1}`} className="h-full w-full object-cover" />
                          </a>
                        ))}
                      </div>
                    ) : (
                      <p className={`text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>No photos submitted.</p>
                    )}
                  </div>
                </div>

                <footer className={`flex justify-end border-t px-5 py-3 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-slate-50"}`}>
                  <button
                    type="button"
                    onClick={() => setFeedbackPreviewOrder(null)}
                    className={`rounded-lg border px-4 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${darkMode ? "border-slate-600 text-slate-200 hover:bg-slate-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}`}
                  >
                    Close
                  </button>
                </footer>
              </section>
            </div>
          )}

          {feedbackDeleteOrder && (
            <div
              className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-4"
              role="presentation"
              onClick={(event) => event.target === event.currentTarget && !feedbackDeleting && setFeedbackDeleteOrder(null)}
            >
              <section
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="delete-feedback-title"
                aria-describedby="delete-feedback-description"
                className={`w-full max-w-md rounded-2xl border p-5 ${darkMode ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}
              >
                <h2 id="delete-feedback-title" className="text-lg font-semibold">
                  Delete {Number.isInteger(feedbackDeleteOrder.reviewItemIndex) ? "Product" : "Customer"} Feedback?
                </h2>
                <p id="delete-feedback-description" className={`mt-2 text-sm leading-6 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                  This will permanently remove feedback from {feedbackDeleteOrder.customer_name || `${feedbackDeleteOrder.customer?.first_name || ""} ${feedbackDeleteOrder.customer?.last_name || ""}`.trim() || "Customer"} for {feedbackDeleteOrder.reviewProductName || "this order"}. This action cannot be undone.
                </p>
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    disabled={feedbackDeleting}
                    onClick={() => setFeedbackDeleteOrder(null)}
                    className={`rounded-lg border px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${darkMode ? "border-slate-600 text-slate-200 hover:bg-slate-800" : "border-slate-300 text-slate-700 hover:bg-slate-50"}`}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={feedbackDeleting}
                    onClick={handleDeleteCustomerFeedback}
                    className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-wait disabled:opacity-60"
                  >
                    <Trash2 size={15} aria-hidden="true" />
                    {feedbackDeleting ? "Deleting..." : "Delete Customer Feedback"}
                  </button>
                </div>
              </section>
            </div>
          )}

        </main>
      </div>
    </div>
  );
}

export default Transactions;
