import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Search,
  Plus,
  Eye,
  Pencil,
  FileText,
  ShieldCheck,
  Ban,
  RotateCcw,
  ClipboardList,
  X,
} from "lucide-react";
import toast, { Toaster } from 'react-hot-toast';
import { toJpeg } from "html-to-image";
import jsPDF from "jspdf";

import { getAdminOrders, getAdminOrder, generateContract, updateOrderInspection, updateOrderStatus, createInspection, sendWalkInApprovalEmail } from "@/api/orders";
import { buildContractSnapshot, hasContractSnapshotChanged } from "./contractState";
import { getCustomerPaymentProof, getPaymentSummary } from "@/pages/Transactions/paymentProofUtils";
import { getProducts } from "@/api/products";
import { searchCustomers } from "@/api/users";
import { uploadFiles } from "@/api/uploads";
import Sidebar from "../../components/layout/Sidebar";
import Navbar from "../../components/layout/Navbar";
import AdminPageHeader from "../../components/layout/AdminPageHeader";
import ContractModal from "../../components/ContractModal";
import { formatDateToMMDDYYYY, formatDateTimeToMMDDYYYY, formatDateToMMMDDYYYY } from "@/lib/dateUtils";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminTheme } from "@/contexts/AdminThemeContext";
import { recordActivity } from "@/lib/activityLog";
import ProfileAvatar from "../../components/ui/ProfileAvatar";
import { useIsMobile } from "@/hooks/useIsMobile";
import useNotificationHighlight from "@/hooks/useNotificationHighlight";

const getDefaultInspection = () => ({
  customerId: null,
  customerName: "",
  customerEmail: "",
  phone: "",
  productName: "",
  order_type: "online_order",
  siteAddress: "",
  inspection_date: "",
  estimated_installation_date: "",
  notes: "",
  site_notes: "",
  warranty_period: 90,
  custom_warranty_days: 90,
  warranty_assignment_mode: "same",
  has_account_on_website: false,
  downpayment_received: false,
  required_downpayment_amount: "",
  manual_override: "",
  items: [
    { id: Date.now() + Math.random(), product_id: "", name: "", width: 1, height: 1, qty: 1, unit_price: 0, area: 0, unit: "sqft", estimation_mode: "auto" },
  ],
  payment_terms: "50%_down_payment",
  agreed_payment_date: "",
  estimation_mode: "auto",
  customerType: "walk-in",
});

const generateTrackingId = () => {
  const year = new Date().getFullYear();
  const random = Math.floor(1000 + Math.random() * 9000);
  return `ACGC-TRK-${year}-${random}`;
};

const SITE_INSPECTION_STATUS = "site_inspection";
const SITE_INSPECTION_CONTRACT_STATUSES = new Set(["", "pending", "sent", "declined"]);
const CONTRACT_STAGE_STATUSES = new Set([
  "contract_created",
  "contract_sent",
  "contract_accepted",
  "contract_declined",
  "in_transaction",
  "processing",
  "cutting",
  "fabrication",
  "installation_scheduling",
  "installation",
  "completed",
  "cancelled",
]);

const normalizeWorkflowValue = (value) =>
  (value || "").toString().trim().toLowerCase();

const normalizePhoneInput = (value) => String(value ?? "").replace(/\D/g, "");

export const normalizeWarrantyPeriodValue = (value, fallback = 90) => {
  if (value === "Custom" || value === "No Warranty") return value;

  const periodText = String(value).trim().toLowerCase();
  const durationMatch = periodText.match(/^(\d+)\s*(?:days?)?$/);
  const numericValue = durationMatch ? Number(durationMatch[1]) : Number(value);
  if (Number.isFinite(numericValue) && numericValue > 0) {
    if (numericValue === 30 || numericValue === 90) {
      return numericValue;
    }

    return "Custom";
  }

  return fallback;
};

export const buildWarrantyPayload = (warrantyPeriod, customWarrantyDays) => {
  if (warrantyPeriod === "No Warranty") {
    return { warranty_period: "No Warranty", custom_warranty_days: null };
  }

  const warrantyDays = warrantyPeriod === "Custom"
    ? Number(customWarrantyDays) || 90
    : Number(warrantyPeriod) || 90;

  return {
    warranty_period: warrantyDays,
    custom_warranty_days: warrantyPeriod === "Custom"
      ? warrantyDays
      : Number(customWarrantyDays) || Number(warrantyPeriod) || 90,
  };
};

const normalizeProductId = (productId) => {
  if (typeof productId === "object" && productId !== null) {
    return String(productId._id || productId.id || productId);
  }
  return productId ? String(productId) : "";
};

export const getEstimatedInstallationDate = (inspection) => (
  inspection?.estimated_installation_date ||
  inspection?.estimated_install_date ||
  inspection?.estimatedInstallationDate ||
  inspection?.installation_date ||
  inspection?.installationDate ||
  inspection?.estimatedInstallDate ||
  inspection?.est_install_date ||
  inspection?.estInstallDate ||
  ""
);

const toApiDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date
    ? new Date(value)
    : new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export const getWarrantyPeriodDays = (period) => {
  const numericPeriod = Number(period);
  if (Number.isFinite(numericPeriod) && numericPeriod > 0) return numericPeriod;

  const match = String(period ?? "").trim().toLowerCase().match(/^(\d+)\s*(days?|months?|years?)$/);
  if (!match) return null;
  const count = Number(match[1]);
  if (match[2].startsWith("year")) return count * 365;
  if (match[2].startsWith("month")) return count * 30;
  return count;
};

export const calculateWarrantyExpiry = (startDate, period, customDays) => {
  if (!startDate || period === "No Warranty") return null;
  const days = period === "Custom"
    ? Number(customDays)
    : getWarrantyPeriodDays(period) || Number(customDays);
  if (!Number.isFinite(days) || days <= 0) return null;
  const expiry = startDate instanceof Date
    ? new Date(startDate)
    : new Date(`${String(startDate).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(expiry.getTime())) return null;
  expiry.setUTCDate(expiry.getUTCDate() + days);
  return expiry.toISOString();
};

export const calculateMeasurementArea = (width, height, quantity = 1) => {
  const area = ((Number(width) || 0) * (Number(height) || 0) * (Number(quantity) || 1)) / 144;
  return Math.round(area * 100) / 100;
};

export const calculateMeasurementSubtotal = (item, product = null) => {
  const quantity = Number(item.quantity ?? item.qty ?? 1) || 1;
  const area = Number(item.area) || calculateMeasurementArea(item.width, item.height, quantity);
  const unitPrice = Number(product?.unit_price) || Number(item.unit_price ?? item.price) || 0;
  const customizationFee = Number(product?.customization_fee) || 0;

  if (!product) return Math.round(area * unitPrice * 100) / 100;

  let subtotal = 0;
  switch (product.pricing_method || "") {
    case "sqft":
      subtotal = area * (Number(product.price_per_sqft) || 0) + customizationFee;
      break;
    case "blade":
      subtotal = quantity * (Number(product.price_per_blade) || 0) + customizationFee;
      break;
    case "fixed":
      subtotal = (Number(product.base_price) || 0) + customizationFee;
      break;
    case "per_piece":
      subtotal = quantity * unitPrice + customizationFee;
      break;
    default:
      subtotal = (area > 0 ? area * unitPrice : quantity * unitPrice) + customizationFee;
  }

  return Math.round(subtotal * 100) / 100;
};

const createContractPrintClone = (element) => {
  const clone = element.cloneNode(true);
  clone.style.width = "794px";
  clone.style.maxWidth = "794px";
  clone.style.boxSizing = "border-box";
  clone.style.height = "auto";
  clone.style.overflow = "visible";
  clone.style.position = "relative";
  clone.style.maxHeight = "none";
  clone.style.backgroundColor = "#ffffff";
  clone.style.color = "#1f2937";
  const wrapper = document.createElement("div");
  wrapper.style.position = "fixed";
  wrapper.style.left = "-9999px";
  wrapper.style.top = "0";
  wrapper.style.opacity = "0";
  wrapper.style.pointerEvents = "none";
  wrapper.style.zIndex = "-1";
  wrapper.appendChild(clone);
  document.body.appendChild(wrapper);
  clone.querySelectorAll("*").forEach((child) => {
    const fontSize = Number.parseFloat(window.getComputedStyle(child).fontSize);
    if (fontSize >= 8 && fontSize < 11) {
      child.style.fontSize = "11px";
    }
  });

  return { wrapper, clone };
};

export const validateInspectionPayload = (payload = {}) => {
  const nextErrors = {};

  if (!payload.customerName?.trim()) nextErrors.customerName = "Client name is required.";
  if (!payload.phone?.trim()) nextErrors.phone = "Phone number is required.";
  if (!payload.siteAddress?.trim()) nextErrors.siteAddress = "Site address is required.";
  if (!payload.inspection_date) nextErrors.inspection_date = "Inspection date is required.";
  if (!payload.estimated_installation_date) nextErrors.estimated_installation_date = "Estimated installation date is required.";
  if (!payload.items || payload.items.length === 0) nextErrors.items = "Add at least one measurement row.";
  if (
    payload.order_type === "walk_in_customer" &&
    payload.has_account_on_website === true &&
    !getRegisteredCustomerId(payload)
  ) {
    nextErrors.customerId = "Select the matching registered customer account before creating this inspection.";
  }

  const itemErrors = payload.items?.map((item) => {
    const rowErrors = {};
    const normalizedProductId = normalizeProductId(item.product_id);
    if (!normalizedProductId) rowErrors.product_id = "Select a product.";
    if (!item.name?.trim()) rowErrors.name = "Description is required.";
    if (Number(item.width) <= 0) rowErrors.width = "Width must be greater than zero.";
    if (Number(item.height) <= 0) rowErrors.height = "Height must be greater than zero.";
    if (Number(item.qty) <= 0) rowErrors.qty = "Quantity must be at least 1.";
    return rowErrors;
  }) || [];

  if (itemErrors.some((row) => Object.keys(row).length > 0)) {
    nextErrors.itemErrors = itemErrors;
  }

  return nextErrors;
};

export const normalizeWalkInWebsiteAccountState = (payload = {}) => {
  const rawOrderType = String(payload.order_type || payload.customerType || payload.customer_type || "").trim().toLowerCase();
  const isWalkInCustomer = [
    "walk_in_customer",
    "walk-in_customer",
    "walk_in",
    "walk-in",
    "walkin",
    "walk in customer",
    "walk-in customer",
  ].includes(rawOrderType);

  if (isWalkInCustomer) {
    return false;
  }

  return Boolean(payload.has_account_on_website);
};

export const resolveInspectionProductPrice = (product = null, fallbackItem = {}) => {
  const pricingMethod = String(product?.pricing_method || fallbackItem?.pricing_method || "").toLowerCase();
  const basePrice = Number(product?.base_price ?? fallbackItem?.base_price ?? 0) || 0;
  const pricePerSqft = Number(product?.price_per_sqft ?? fallbackItem?.price_per_sqft ?? 0) || 0;
  const pricePerBlade = Number(product?.price_per_blade ?? fallbackItem?.price_per_blade ?? 0) || 0;
  const unitPrice = Number(product?.unit_price ?? fallbackItem?.unit_price ?? 0) || 0;
  const estimatedPrice = Number(product?.estimated_price ?? fallbackItem?.estimated_price ?? 0) || 0;
  const customizationFee = Number(product?.customization_fee ?? fallbackItem?.customization_fee ?? 0) || 0;
  const widthValue = Number(product?.width ?? fallbackItem?.width ?? 0) || 0;
  const heightValue = Number(product?.height ?? fallbackItem?.height ?? 0) || 0;
  const width = widthValue || Number(fallbackItem?.width ?? 0) || 1;
  const height = heightValue || Number(fallbackItem?.height ?? 0) || 1;
  const fallbackUnitPrice = unitPrice || basePrice || estimatedPrice || pricePerSqft || pricePerBlade || 0;

  switch (pricingMethod) {
    case "sqft":
      return {
        pricing_method: "sqft",
        unit_price: pricePerSqft || fallbackUnitPrice,
        price_per_sqft: pricePerSqft,
        price_per_blade: 0,
        base_price: basePrice,
        customization_fee: customizationFee,
        width,
        height,
      };
    case "blade":
      return {
        pricing_method: "blade",
        unit_price: pricePerBlade || fallbackUnitPrice,
        price_per_sqft: 0,
        price_per_blade: pricePerBlade,
        base_price: basePrice,
        customization_fee: customizationFee,
        width,
        height,
      };
    case "fixed":
      return {
        pricing_method: "fixed",
        unit_price: basePrice || estimatedPrice || fallbackUnitPrice,
        price_per_sqft: pricePerSqft,
        price_per_blade: pricePerBlade,
        base_price: basePrice,
        customization_fee: customizationFee,
        width,
        height,
      };
    case "per_piece":
      return {
        pricing_method: "per_piece",
        unit_price: unitPrice || basePrice || estimatedPrice || fallbackUnitPrice,
        price_per_sqft: pricePerSqft,
        price_per_blade: pricePerBlade,
        base_price: basePrice,
        customization_fee: customizationFee,
        width,
        height,
      };
    default:
      if (pricePerSqft > 0) {
        return {
          pricing_method: "sqft",
          unit_price: pricePerSqft,
          price_per_sqft: pricePerSqft,
          price_per_blade: 0,
          base_price: basePrice,
          customization_fee: customizationFee,
          width,
          height,
        };
      }
      if (pricePerBlade > 0) {
        return {
          pricing_method: "blade",
          unit_price: pricePerBlade,
          price_per_sqft: 0,
          price_per_blade: pricePerBlade,
          base_price: basePrice,
          customization_fee: customizationFee,
          width,
          height,
        };
      }
      return {
        pricing_method: pricingMethod || "fixed",
        unit_price: basePrice || estimatedPrice || fallbackUnitPrice,
        price_per_sqft: pricePerSqft,
        price_per_blade: pricePerBlade,
        base_price: basePrice,
        customization_fee: customizationFee,
        width,
        height,
      };
  }
};

const getRegisteredCustomerId = (inspection = {}) => {
  const candidateIds = [
    inspection.customer,
    inspection.customer_id,
    inspection.customerId,
    inspection.userId,
    inspection.accountId,
  ].map((value) => (
    value && typeof value === "object" ? value._id || value.id : value
  ));
  const customerId = candidateIds.find(Boolean);
  return customerId ? String(customerId).trim() : "";
};

export const isOnlineCustomerInspection = (inspection = {}) => {
  if (getRegisteredCustomerId(inspection)) return true;

  const customerType = String(inspection.customerType || inspection.customer_type || "").trim().toLowerCase();
  return ["online", "online_customer", "online customer"].includes(customerType);
};

export const getInspectionDisplayTotal = (inspection = {}, itemTotal = 0) => {
  const manualOverride = Number(inspection.manual_override);
  if (Number.isFinite(manualOverride) && manualOverride > 0) return manualOverride;

  const savedTotal = Number(inspection.total_amount) || Number(inspection.contract_amount) || 0;
  return savedTotal > 0 ? savedTotal : Number(itemTotal) || 0;
};

export const isSiteInspectionVisible = (order) => {
  if (!order) return false;

  const status = normalizeWorkflowValue(order.status);
  const contractStatus = normalizeWorkflowValue(order.contract_status);

  if (status !== SITE_INSPECTION_STATUS) return false;
  if (CONTRACT_STAGE_STATUSES.has(status)) return false;
  if (!SITE_INSPECTION_CONTRACT_STATUSES.has(contractStatus)) return false;

  return true;
};

function SiteInspection() {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const { darkMode } = useAdminTheme();
  const location = useLocation();
  const highlightedNotificationRecordId = useNotificationHighlight(location);
  const navigate = useNavigate();
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem("sidebarOpen");
    return stored !== null ? JSON.parse(stored) : true;
  });
  const [showModal, setShowModal] = useState(false);
  const [inspections, setInspections] = useState([]);
  const [inspectionsLoading, setInspectionsLoading] = useState(false);
  const [generatingId, setGeneratingId] = useState(null);
  const [cancelledInspections, setCancelledInspections] = useState([]);
  const [cancellingId, setCancellingId] = useState(null);
  const [restoringId, setRestoringId] = useState(null);
  const [viewInspection, setViewInspection] = useState(null);
  const [editInspection, setEditInspection] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [activeTab, setActiveTab] = useState("site");
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [newInspection, setNewInspection] = useState(getDefaultInspection());
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerSuggestions, setCustomerSuggestions] = useState([]);
  const [customerSearchLoading, setCustomerSearchLoading] = useState(false);
  const [customerSearchError, setCustomerSearchError] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [showContractModal, setShowContractModal] = useState(false);
  const [contractData, setContractData] = useState(null);
  const [contractInspection, setContractInspection] = useState(null);
  const [contractNeedsRegeneration, setContractNeedsRegeneration] = useState(false);
  const [sendingCustomerEmail, setSendingCustomerEmail] = useState(false);
  const [manualApprovalModal, setManualApprovalModal] = useState({
    open: false,
    orderId: null,
    tracking: "",
    uploadedUrl: "",
    fileName: "",
    uploading: false,
    error: "",
  });
  const manualApprovalFileInputRef = useRef(null);

  const today = new Date().toISOString().split("T")[0];
  const pageSize = 8;
  const formatCurrency = (value) =>
    new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(value || 0));
  const getDimensionInputValue = (value) => value === 0 ? "" : value ?? "";
  const clearDefaultDimensionZero = (id, field, value, onChange) => {
    if (value !== "" && value !== null && value !== undefined && Number(value) === 0) {
      onChange(id, field, "");
    }
  };
  const getItemWarrantySelectValue = (item) => {
    if (item.warranty_period === "No Warranty") return "No Warranty";
    if (item.warranty_period === "Custom") return "Custom";
    const days = getWarrantyPeriodDays(item.warranty_period ?? 90);
    return [30, 60, 90].includes(days) ? String(days) : "Custom";
  };
  const getItemWarrantyCustomDays = (item) => (
    Number(item.custom_warranty_days) || getWarrantyPeriodDays(item.warranty_period) || ""
  );

  const modalShellClass = darkMode
    ? "border border-slate-700/80 bg-[#071d2d] text-slate-100 shadow-[0_28px_100px_rgba(0,0,0,0.55)] ring-1 ring-white/5"
    : "border border-slate-200 bg-white text-slate-900 shadow-[0_28px_80px_rgba(15,23,42,0.18)] ring-1 ring-slate-950/5";
  const modalHeaderClass = darkMode ? "border-b border-slate-700 bg-[#0b2338]" : "border-b border-slate-200 bg-slate-50";
  const modalSectionClass = darkMode ? "border border-slate-700 bg-[#0f2438] shadow-sm shadow-black/10" : "border border-slate-200 bg-white shadow-sm";
  const modalSectionTitleClass = `mb-4 border-b pb-3 text-xs font-bold uppercase tracking-[0.14em] ${darkMode ? "border-slate-700 text-red-300" : "border-slate-200 text-red-700"}`;
  const fieldClass = darkMode
    ? "min-h-11 w-full rounded-lg border border-slate-600 bg-[#122d42] px-3 py-2.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-400 focus:border-red-400 focus:ring-2 focus:ring-red-500/20"
    : "min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-500 focus:border-red-500 focus:ring-2 focus:ring-red-100";
  const lockedFieldClass = darkMode
    ? "w-full cursor-not-allowed rounded-xl border border-slate-600 bg-slate-800 px-3 py-3 text-sm text-slate-300 shadow-inner outline-none placeholder:text-slate-500"
    : "w-full cursor-not-allowed rounded-xl border border-slate-300 bg-slate-200 px-3 py-3 text-sm text-slate-600 shadow-inner outline-none placeholder:text-slate-400";
  const labelClass = darkMode ? "text-slate-200" : "text-slate-700";
  const mutedTextClass = darkMode ? "text-slate-400" : "text-slate-500";
  const statusBadgeClass = darkMode
    ? "flex h-[48px] items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 text-sm font-bold text-amber-200"
    : "flex h-[48px] items-center justify-center rounded-xl border border-amber-200 bg-amber-50 px-3 text-sm font-bold text-amber-700";
  const inspectionStatus = newInspection.inspection_date ? {
    label: "Scheduled",
    icon: "✓",
    className: darkMode
      ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
      : "border border-emerald-200 bg-emerald-50 text-emerald-700",
  } : {
    label: "Needs to be Called",
    icon: "📞",
    className: statusBadgeClass,
  };
  const inputGridClass = darkMode ? "bg-[#122d42]" : "bg-slate-50";
  const footerClass = darkMode ? "border-t border-slate-700 bg-[#0b2338]" : "border-t border-slate-200 bg-slate-50";
  const secondaryButtonClass = darkMode
    ? "rounded-xl border border-slate-600 bg-slate-800 px-5 py-3 text-sm font-bold text-slate-200 transition hover:bg-slate-700"
    : "rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-100";
  const primaryButtonClass = darkMode
    ? "rounded-xl bg-red-600 px-6 py-3 text-sm font-black text-white shadow-sm transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-70"
    : "rounded-xl bg-red-600 px-6 py-3 text-sm font-black text-white shadow-sm transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-70";
  const paymentTermsWithAgreedDate = new Set(["full_payment", "installment_3_months", "installment_6_months", "custom_arrangement"]);
  const shouldShowAgreedPaymentDate = (value = "") => paymentTermsWithAgreedDate.has(String(value).trim());
  const isFullPaymentPlan = (value = "") => String(value).trim() === "full_payment";
  const resolveRequiredPaymentAmount = (terms, total, configuredAmount) => {
    const safeTotal = Math.max(Number(total) || 0, 0);
    if (isFullPaymentPlan(terms)) return safeTotal;

    const enteredAmount = Number(configuredAmount);
    const amount = configuredAmount !== undefined && configuredAmount !== null && configuredAmount !== "" && Number.isFinite(enteredAmount)
      ? enteredAmount
      : safeTotal * 0.5;
    return Math.min(safeTotal, Math.max(Math.round(amount * 100) / 100, 0));
  };
  const getPaymentTermsLabel = (value = "") => {
    switch (String(value).trim()) {
      case "50%_down_payment":
        return "50% downpayment, 50% upon completion";
      case "full_payment":
        return "Full Payment";
      case "installment_3_months":
        return "Installment (3 months)";
      case "installment_6_months":
        return "Installment (6 months)";
      case "custom_arrangement":
        return "Custom Arrangement";
      default:
        return "50% downpayment, 50% upon completion";
    }
  };
  const getPaymentReceivedQuestion = (value = "") => (isFullPaymentPlan(value) ? "Payment Received?" : "Downpayment Received?");
  const getPaymentStatusLabel = (value = "") => (isFullPaymentPlan(value) ? "Payment Status" : "Downpayment Status");
  const isPastDateValue = (value) => {
    if (!value) return false;
    const inputDate = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Number.isNaN(inputDate.getTime()) ? false : inputDate < today;
  };
  const actionButtonClass = "inline-flex h-9 w-9 items-center justify-center rounded-lg transition focus-visible:outline-none focus-visible:ring-2";

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchQuery, statusFilter, cancelledInspections.length, inspections.length]);

  const fetchSiteInspections = async () => {
    setInspectionsLoading(true);
    try {
      const [siteResp, cancelledResp] = await Promise.all([
        getAdminOrders({ status: "site_inspection", module: "site_inspection" }),
        getAdminOrders({ status: "cancelled", module: "site_inspection" }),
      ]);
      setInspections((siteResp.orders || []).filter(isSiteInspectionVisible));
      setCancelledInspections(cancelledResp.orders || []);
    } catch (error) {
      console.error("Failed to load site inspection records:", error);
      setInspections([]);
      setCancelledInspections([]);
    } finally {
      setInspectionsLoading(false);
    }
  };


  const resetNewInspectionForm = () => {
    setNewInspection(getDefaultInspection());
    setErrors({});
    setCustomerSearch("");
    setCustomerSuggestions([]);
    setCustomerSearchError("");
    setSelectedCustomer(null);
  };

  const closeNewInspectionModal = () => {
    setShowModal(false);
    resetNewInspectionForm();
  };

  const formatCustomerAddress = (customer) => {
    if (!customer) return "";
    return [customer.street_address, customer.city, customer.province, customer.zip_code]
      .filter(Boolean)
      .join(", ");
  };

  const handleClientNameInput = (value) => {
    setCustomerSearch(value);
    setSelectedCustomer(null);
    setCustomerSearchError("");
    setCustomerSuggestions([]);
    setNewInspection((prev) => {
      const isClearingSelectedCustomer = Boolean(prev.customerId);
      const isClientNameEmpty = !value.trim();

      return {
        ...prev,
        customerName: value,
        customerEmail: "",
        phone: isClearingSelectedCustomer || isClientNameEmpty ? "" : prev.phone,
        siteAddress: isClearingSelectedCustomer || isClientNameEmpty ? "" : prev.siteAddress,
        order_type: value.trim() ? "walk_in_customer" : "online_order",
        customerId: null,
        customerType: "walk-in",
        has_account_on_website: isClearingSelectedCustomer || isClientNameEmpty ? false : prev.has_account_on_website,
      };
    });
  };

  const handleCustomerSelect = (customer) => {
    const fullName = `${customer.first_name || ""} ${customer.last_name || ""}`.trim() || customer.email || "";
    setSelectedCustomer(customer);
    setCustomerSearch(fullName);
    setCustomerSuggestions([]);
    setCustomerSearchError("");
    setNewInspection((prev) => {
      const isWalkInAccountLink = prev.order_type === "walk_in_customer" && prev.has_account_on_website;
      return {
        ...prev,
        customerId: customer._id,
        customerName: fullName,
        customerEmail: customer.email || "",
        phone: customer.phone || "",
        siteAddress: formatCustomerAddress(customer),
        order_type: isWalkInAccountLink ? "walk_in_customer" : "online_order",
        customerType: isWalkInAccountLink ? "walk-in" : "online",
        has_account_on_website: true,
      };
    });
  };

  const clearSelectedCustomer = () => {
    setSelectedCustomer(null);
    setCustomerSearch("");
    setCustomerSuggestions([]);
    setNewInspection((prev) => ({
      ...prev,
      customerId: null,
      customerName: "",
      customerEmail: "",
      phone: "",
      siteAddress: "",
      order_type: "walk_in_customer",
      customerType: "walk-in",
      has_account_on_website: false,
    }));
  };

  const filterInspections = (list) => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return list;
    return (list || []).filter((inspection) => {
      const clientName = `${inspection.customer?.first_name || ""} ${inspection.customer?.last_name || ""}`.trim()
        || inspection.customer_name
        || inspection.customer?.email
        || inspection.customer_email
        || "";
      const trackingId = inspection.tracking
        || inspection.order_number
        || inspection.orderId
        || `SI-${String(inspection._id || inspection.id || "").slice(-8).toUpperCase()}`;
      const itemNames = (inspection.items || []).flatMap((item) => [
        item.name,
        item.product_name,
        item.product_id?.name,
      ]);
      const displayStatus = activeTab === "cancelled"
        ? "Cancelled"
        : hasValidInspectionDate(inspection)
          ? "Scheduled"
          : "Needs to be Called";
      const searchableValues = [
        clientName,
        inspection.customer?.email,
        inspection.customer_email,
        inspection.customer?.phone,
        inspection.customer_phone,
        trackingId,
        ...itemNames,
        inspection.shipping_address,
        inspection.siteAddress,
        inspection.customer?.street_address,
        inspection.status,
        inspection.inspection_status,
        displayStatus,
        inspection.order_type,
        inspection.customerType,
        inspection.createdAt,
        formatDateToMMMDDYYYY(inspection.createdAt),
        inspection.inspection_date,
        formatDateToMMMDDYYYY(inspection.inspection_date),
        getEstimatedInstallationDate(inspection),
        formatDateToMMMDDYYYY(getEstimatedInstallationDate(inspection)),
      ];
      return searchableValues
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  };

  const handleSearchChange = (value) => {
    setSearchQuery(value);
  };


  const normalizeProductId = (productId) => {
    if (typeof productId === "object" && productId !== null) {
      return String(productId._id || productId.id || productId);
    }
    return productId ? String(productId) : "";
  };

  const getEditItemFromOrderItem = (item) => {
    const normalizedProductId = normalizeProductId(item.product_id || item._id);
    const selectedProduct = products.find((p) => String(p._id || p.id) === normalizedProductId) || null;
    const quantity = item.quantity !== undefined && item.quantity !== null
      ? Number(item.quantity)
      : item.qty !== undefined && item.qty !== null
        ? Number(item.qty)
        : 1;
    const providedWidth = item.width !== undefined && item.width !== null ? Number(item.width) : 0;
    const providedHeight = item.height !== undefined && item.height !== null ? Number(item.height) : 0;
    const widthValue = providedWidth > 0 ? providedWidth : Number(selectedProduct?.width || 0);
    const heightValue = providedHeight > 0 ? providedHeight : Number(selectedProduct?.height || 0);
    const areaValue = item.area !== undefined && item.area !== null && Number(item.area) > 0
      ? Number(item.area)
      : Math.round(((widthValue * heightValue * quantity) / 144) * 100) / 100;
    const productUnitPrice = deriveUnitPriceForPayload({
      ...item,
      product_id: normalizedProductId,
      unit_price: item.unit_price,
    });
    const unitPriceValue = item.unit_price !== undefined && item.unit_price !== null && Number(item.unit_price) > 0
      ? Number(item.unit_price)
      : productUnitPrice;
    const estimationMode = item.is_estimate ? (item.estimation_mode || "auto") : "auto";

    return {
      ...item,
      id: item.id || item._id || `${Date.now()}-${Math.random()}`,
      product_id: normalizedProductId,
      name: item.name || selectedProduct?.name || "",
      qty: quantity,
      quantity,
      width: widthValue ? String(widthValue) : "",
      height: heightValue ? String(heightValue) : "",
      area: areaValue,
      unit_price: unitPriceValue,
      unit: item.unit || selectedProduct?.unit || "sqft",
      estimation_mode: estimationMode,
      manual_estimated_total: item.manual_estimated_total ?? (estimationMode === "manual" ? String(item.estimated_price || "") : ""),
      category: selectedProduct?.category || item.category || item.product_type || "",
      product_type: selectedProduct?.product_type || item.product_type || "",
      base_price: selectedProduct?.base_price || item.base_price || 0,
      price_per_sqft: selectedProduct?.price_per_sqft || item.price_per_sqft || 0,
      price_per_blade: selectedProduct?.price_per_blade || item.price_per_blade || 0,
      customization_fee: selectedProduct?.customization_fee || item.customization_fee || 0,
      variant: selectedProduct?.variant || item.variant || "",
    };
  };

  const calculateItemArea = (item) => {
    return calculateMeasurementArea(item.width, item.height, item.quantity ?? item.qty ?? 1);
  };

  const getInspectionItemTotal = (item) => {
    const explicitTotal = Number(item.estimated_price ?? item.total_price ?? item.amount ?? item.line_total ?? 0);
    if (Number.isFinite(explicitTotal) && explicitTotal > 0) return explicitTotal;

    const manualTotal = Number(item.manual_estimated_total ?? 0);
    if (Number.isFinite(manualTotal) && manualTotal > 0) return manualTotal;

    const subtotal = calculateRowSubtotal(item);
    if (subtotal > 0) return subtotal;

    const qty = Number(item.quantity ?? item.qty ?? 1) || 1;
    const unitPrice = Number(item.unit_price ?? item.price ?? 0) || 0;
    return qty * unitPrice;
  };

  const calculateRowSubtotal = (item) => {
    const normalizedProductId = normalizeProductId(item.product_id);
    const product = products.find((p) => String(p._id || p.id) === normalizedProductId) || null;
    return calculateMeasurementSubtotal(item, product);
  };

  const deriveUnitPriceForPayload = (item) => {
    const normalizedProductId = normalizeProductId(item.product_id);
    const product = products.find((p) => String(p._id || p.id) === normalizedProductId) || null;
    return resolveInspectionProductPrice(product, item).unit_price;
  };

  const formatRateLabel = (item) => {
    const normalizedProductId = normalizeProductId(item.product_id);
    const product = products.find((p) => String(p._id || p.id) === normalizedProductId) || null;
    if (!product) return `₱${(Number(item.unit_price) || 0).toLocaleString()}`;
    const pricingMethod = product.pricing_method || "";
    const perSqft = Number(product.price_per_sqft) || 0;
    const perBlade = Number(product.price_per_blade) || 0;
    const base = Number(product.base_price) || 0;
    const unitPrice = Number(product.unit_price) || 0;
    switch (pricingMethod) {
      case "sqft":
        return `₱${perSqft.toLocaleString()} / sq.ft`;
      case "blade":
        return `₱${perBlade.toLocaleString()} / blade`;
      case "fixed":
        return `Base ₱${base.toLocaleString()}`;
      case "per_piece":
        return `₱${unitPrice.toLocaleString()} / pc`;
      default:
        return `₱${unitPrice.toLocaleString()}`;
    }
  };

  const buildInspectionPayload = async (payload) => {
    const computedTotal = Number(payload.manual_override) || computeTotals().totalEstimate;
    const requiredDownpaymentAmount = resolveRequiredPaymentAmount(
      payload.payment_terms,
      computedTotal,
      payload.required_downpayment_amount,
    );
    const basePayload = {
      customer_id: payload.customerId || null,
      customer_email: payload.customerEmail || "",
      items: (payload.items || []).map((item) => {
        const hasMultipleItems = (payload.items || []).length > 1;
        const itemWarrantyPeriod = hasMultipleItems && payload.warranty_assignment_mode === "per_product"
          ? item.warranty_period ?? 90
          : payload.warranty_period;
        const itemCustomWarrantyDays = hasMultipleItems && payload.warranty_assignment_mode === "per_product"
          ? item.custom_warranty_days ?? 90
          : payload.custom_warranty_days;
        const warrantyPeriod = itemWarrantyPeriod === "Custom"
          ? Number(itemCustomWarrantyDays) || 90
          : itemWarrantyPeriod;
        const warrantyStartDate = payload.estimated_installation_date || "";

        return {
          _id: null,
          product_id: item.product_id || null,
          name: item.name || payload.productName || "Inspection Item",
          quantity: Number(item.qty) || 1,
          unit_price: deriveUnitPriceForPayload(item),
          width: Number(item.width) || 0,
          height: Number(item.height) || 0,
          area: Number(item.area) || 0,
          estimation_mode: item.estimation_mode || 'auto',
          is_estimate: true,
          estimated_price: getInspectionItemTotal(item),
          ...(hasMultipleItems ? {
            warranty_period: String(warrantyPeriod),
            custom_warranty_days: itemWarrantyPeriod === "Custom" ? Number(itemCustomWarrantyDays) || 90 : null,
            warranty_start_date: toApiDate(warrantyStartDate),
            warranty_expiry_date: calculateWarrantyExpiry(warrantyStartDate, itemWarrantyPeriod, itemCustomWarrantyDays),
            warranty_status: "pending",
          } : {}),
        };
      }),
      shipping_address: payload.siteAddress,
      order_type: payload.order_type === "walk_in_customer" ? "walk_in_customer" : "online_order",
      inspection_notes: payload.notes || payload.site_notes || "",
      site_notes: payload.site_notes || payload.notes || "",
      payment_terms: payload.payment_terms,
      agreed_payment_date: toApiDate(payload.agreed_payment_date),
      customer_name: payload.customerName,
      customer_phone: payload.phone,
      estimation_mode: "auto",
      inspection_date: toApiDate(payload.inspection_date),
      estimated_installation_date: toApiDate(payload.estimated_installation_date),
      ...buildWarrantyPayload(payload.warranty_period, payload.custom_warranty_days),
      warranty_assignment_mode: (payload.items || []).length > 1 && payload.warranty_assignment_mode === "per_product"
        ? "per_product"
        : "same",
      has_account_on_website: Boolean(payload.has_account_on_website),
      manual_override: payload.manual_override || "",
      total_amount: computedTotal,
      contract_amount: computedTotal,
      required_downpayment_amount: requiredDownpaymentAmount,
      downpayment_received: Boolean(payload.downpayment_received),
    };

    return basePayload;
  };

  const fetchProducts = async () => {
    setProductsLoading(true);
    try {
      const productResp = await getProducts();
      setProducts(productResp.products || []);
    } catch (error) {
      console.error("Failed to load admin products:", error);
      setProducts([]);
    } finally {
      setProductsLoading(false);
    }
  };

  const handleInspectionFieldChange = (field, value) => {
    setNewInspection((prev) => {
      if (field === "order_type") {
        if (value === "walk_in_customer") {
          return {
            ...prev,
            order_type: value,
            has_account_on_website: false,
            contract_number: prev.contract_number || generateTrackingId(),
          };
        }

        return {
          ...prev,
          order_type: value,
          has_account_on_website: true,
          contract_number: "",
        };
      }

      return { ...prev, [field]: field === "phone" ? normalizePhoneInput(value) : value };
    });
  };

  const handleItemFieldChange = (id, field, value) => {
    setNewInspection((prev) => ({
      ...prev,
      items: prev.items.map((item) => {
        if (item.id !== id) return item;
        const updated = { ...item, [field]: value };
        return {
          ...updated,
          area: calculateMeasurementArea(updated.width, updated.height, updated.qty),
        };
      }),
    }));
  };

  const handleToggleEstimationMode = (id, mode) => {
    setNewInspection((prev) => ({
      ...prev,
      items: prev.items.map((item) => {
        if (item.id !== id) return item;
        if (mode === "manual") {
          // switch to manual mode with empty field
          return { ...item, estimation_mode: "manual", manual_estimated_total: undefined };
        }
        // auto
        return { ...item, estimation_mode: "auto", manual_estimated_total: undefined };
      }),
    }));
  };

  const handleManualTotalChange = (id, value) => {
    // Store raw string value, don't convert to number yet
    setNewInspection((prev) => ({
      ...prev,
      items: prev.items.map((item) => (item.id === id ? { ...item, manual_estimated_total: value } : item)),
    }));
  };

  const handleItemProductChange = (id, productId) => {
    const normalizedProductId = normalizeProductId(productId);
    const selectedProduct = products.find((product) => String(product._id || product.id) === normalizedProductId);
    setNewInspection((prev) => ({
      ...prev,
      items: prev.items.map((item) => {
        if (item.id !== id) return item;
        const productSnapshot = resolveInspectionProductPrice(selectedProduct, item);
        const updated = {
          ...item,
          product_id: normalizedProductId,
          name: selectedProduct?.name || item.name || "",
          pricing_method: productSnapshot.pricing_method,
          unit_price: productSnapshot.unit_price,
          base_price: productSnapshot.base_price,
          price_per_sqft: productSnapshot.price_per_sqft,
          price_per_blade: productSnapshot.price_per_blade,
          customization_fee: productSnapshot.customization_fee,
          width: productSnapshot.width || item.width || 1,
          height: productSnapshot.height || item.height || 1,
          unit: selectedProduct?.unit || item.unit || "sqft",
        };
        return {
          ...updated,
          area: calculateMeasurementArea(updated.width, updated.height, updated.qty),
          estimation_mode: item.estimation_mode || "auto",
        };
      }),
    }));
  };

  const handleEditItemFieldChange = (id, field, value) => {
    setEditInspection((prev) => ({
      ...prev,
      items: (prev.items || []).map((item) => {
        if (item.id !== id) return item;
        const updated = { ...item, [field]: value };
        return {
          ...updated,
          area: calculateMeasurementArea(updated.width, updated.height, updated.qty ?? updated.quantity),
        };
      }),
    }));
  };

  const handleEditToggleEstimationMode = (id, mode) => {
    setEditInspection((prev) => ({
      ...prev,
      items: (prev.items || []).map((item) => {
        if (item.id !== id) return item;
        return { ...item, estimation_mode: mode === "manual" ? "manual" : "auto", manual_estimated_total: mode === "manual" ? item.manual_estimated_total : "" };
      }),
    }));
  };

  const handleEditManualTotalChange = (id, value) => {
    setEditInspection((prev) => ({
      ...prev,
      items: (prev.items || []).map((item) => (item.id === id ? { ...item, manual_estimated_total: value } : item)),
    }));
  };

  const handleEditItemProductChange = (id, productId) => {
    const normalizedProductId = normalizeProductId(productId);
    const selectedProduct = products.find((product) => String(product._id || product.id) === normalizedProductId);
    setEditInspection((prev) => ({
      ...prev,
      items: (prev.items || []).map((item) => {
        if (item.id !== id) return item;
        const productSnapshot = resolveInspectionProductPrice(selectedProduct, item);
        const updated = {
          ...item,
          product_id: normalizedProductId,
          name: selectedProduct?.name || item.name || "",
          pricing_method: productSnapshot.pricing_method,
          unit_price: productSnapshot.unit_price,
          base_price: productSnapshot.base_price,
          price_per_sqft: productSnapshot.price_per_sqft,
          price_per_blade: productSnapshot.price_per_blade,
          customization_fee: productSnapshot.customization_fee,
          width: productSnapshot.width || item.width || 1,
          height: productSnapshot.height || item.height || 1,
          unit: selectedProduct?.unit || item.unit || "sqft",
        };
        return {
          ...updated,
          area: calculateMeasurementArea(updated.width, updated.height, updated.qty ?? updated.quantity),
          estimation_mode: item.estimation_mode || "auto",
        };
      }),
    }));
  };

  const addItemRow = () => {
    setNewInspection((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        { id: Date.now() + Math.random(), product_id: "", name: "", width: 1, height: 1, qty: 1, area: 0, unit: "sqft", unit_price: 0, estimation_mode: "auto" },
      ],
    }));
  };

  const addEditItemRow = () => {
    setEditInspection((prev) => ({
      ...prev,
      items: [
        ...(prev.items || []),
        { id: Date.now() + Math.random(), product_id: "", name: "", width: 1, height: 1, qty: 1, area: 0, unit: "sqft", unit_price: 0, estimation_mode: "auto", manual_estimated_total: "" },
      ],
    }));
  };

  const removeItemRow = (id) => {
    setNewInspection((prev) => ({ ...prev, items: prev.items.filter((it) => it.id !== id) }));
  };

  const removeEditItemRow = (id) => {
    setEditInspection((prev) => ({ ...prev, items: (prev.items || []).filter((it) => it.id !== id) }));
  };

  const computeTotals = () => {
    const totalArea = (newInspection.items || []).reduce((sum, item) => sum + (Number(item.area) || 0), 0);
    const totalEstimate = Math.round(
      (newInspection.items || []).reduce((sum, item) => {
        if (item.estimation_mode === "manual") return sum + (Number(item.manual_estimated_total) || calculateRowSubtotal(item));
        return sum + calculateRowSubtotal(item);
      }, 0) * 100
    ) / 100;
    return { totalArea, totalEstimate };
  };

  const computeEditTotals = () => {
    if (!editInspection?.items) {
      return { totalArea: 0, totalEstimate: 0 };
    }
    const totalArea = (editInspection.items || []).reduce((sum, item) => sum + (Number(item.area) || 0), 0);
    const totalEstimate = Math.round(
      (editInspection.items || []).reduce((sum, item) => {
        if (item.estimation_mode === "manual") return sum + (Number(item.manual_estimated_total) || calculateRowSubtotal(item));
        return sum + calculateRowSubtotal(item);
      }, 0) * 100
    ) / 100;
    return { totalArea, totalEstimate };
  };

  useEffect(() => {
    fetchSiteInspections();
    fetchProducts();
    // If navigated with ?view=orderId, open that inspection
    const params = new URLSearchParams(window.location.search || "");
    const viewId = params.get("view");
    if (viewId) {
      (async () => {
        try {
          const res = await getAdminOrder(viewId, "site_inspection");
          if (res && res.order) setViewInspection(res.order);
        } catch (err) {
          console.error("Failed to load order for view param", err);
        }
      })();
    }
  }, []);

  useEffect(() => {
    if (selectedCustomer) {
      setCustomerSuggestions([]);
      return;
    }

    const query = customerSearch.trim();
    if (!query) {
      setCustomerSuggestions([]);
      return;
    }

    setCustomerSearchLoading(true);
    const timer = setTimeout(async () => {
      try {
        const result = await searchCustomers(query);
        setCustomerSuggestions(result.customers || []);
      } catch (error) {
        console.error("Customer search failed", error);
        setCustomerSearchError(error?.message || "Unable to search customers");
      } finally {
        setCustomerSearchLoading(false);
      }
    }, 300);

    return () => {
      clearTimeout(timer);
    };
  }, [customerSearch, selectedCustomer]);

  // Ensure form is reset whenever the New Inspection modal opens
  useEffect(() => {
    if (showModal) {
      resetNewInspectionForm();
    }
    // only run when showModal changes
  }, [showModal]);

  const submitNewInspection = async () => {
    const validationErrors = validateInspectionPayload(newInspection);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      const firstKey = Object.keys(validationErrors)[0];
      const firstError = validationErrors[firstKey];
      if (Array.isArray(firstError)) {
        const rowError = firstError.find((err) => err && Object.values(err).length > 0);
        toast.error(rowError ? Object.values(rowError)[0] : "Please fix the form errors.");
      } else {
        toast.error(firstError);
      }
      return;
    }

    setSubmitting(true);
    try {
      const payload = await buildInspectionPayload(newInspection);
      const createResp = await createInspection(payload);
      recordActivity(user, `Created site inspection for ${newInspection.customerName || "customer"}.`, "Site Inspection");
      toast.success("Site inspection created successfully.");

      closeNewInspectionModal();
      await fetchSiteInspections();
    } catch (err) {
      console.error("Create inspection failed", err);
      const errorDetail = err?.data?.error || err?.data?.message || err?.message;
      toast.error(errorDetail ? `Unable to create order: ${errorDetail}` : "Unable to create order.");
    } finally {
      setSubmitting(false);
    }
  };

  // Action handlers for inspection table
  const handleView = (inspection) => {
    // Open view modal with inspection details
    setViewInspection(inspection);
  };

  const validateContractOrder = (order) => {
    const errors = [];
    const customerName = order.customer_name || `${order.customer?.first_name || ""} ${order.customer?.last_name || ""}`.trim();
    const isWalkInCustomer = String(order.order_type || order.customerType || "").toLowerCase() === "walk_in_customer"
      || String(order.order_type || order.customerType || "").toLowerCase() === "walk-in"
      || String(order.order_type || order.customerType || "").toLowerCase() === "walkin";

    if (!customerName) errors.push("Customer name is required.");
    if (!isWalkInCustomer && !order.customer_email && !order.customer?.email) {
      errors.push("Customer email is required.");
    }
    if (!order.customer_phone && !order.customer?.phone) errors.push("Customer contact number is required.");
    if (!order.shipping_address) errors.push("Order shipping address is required.");
    if (!Array.isArray(order.items) || order.items.length === 0) errors.push("Order must contain at least one product.");

    if (Array.isArray(order.items)) {
      order.items.forEach((item, index) => {
        if (!item.name && !item.product_id?.name) {
          errors.push(`Product at row ${index + 1} must have a name.`);
        }
        if (!item.unit_price && item.unit_price !== 0) {
          errors.push(`Product at row ${index + 1} must have a unit price.`);
        }
        if (!item.quantity || item.quantity < 1) {
          errors.push(`Product at row ${index + 1} must have a quantity of at least 1.`);
        }
      });
    }

    const calculatedTotal = (order.items || []).reduce((sum, item) => {
      const unitPrice = Number(item.unit_price) || 0;
      const quantity = Number(item.quantity) || 1;
      return sum + unitPrice * quantity;
    }, 0);

    if (calculatedTotal <= 0) {
      errors.push("Calculated product total must be greater than zero.");
    }

    return errors;
  };

  const hasValidInspectionDate = (order) => {
    if (!order?.inspection_date) return false;
    const inspectionDate = new Date(order.inspection_date);
    return !Number.isNaN(inspectionDate.getTime());
  };

  const getCustomerTypeLabel = (inspection = {}) => {
    const explicitType = (inspection.customerType || inspection.customer_type || "").toString().trim().toLowerCase();
    if (explicitType === "online" || explicitType === "online_customer") return "Online Customer";
    if (explicitType === "walk-in" || explicitType === "walk_in" || explicitType === "walkin" || explicitType === "walk-in_customer" || explicitType === "walk_in_customer") return "Walk-in Customer";

    const hasRegisteredCustomer = Boolean(
      inspection.customerId ||
      inspection.customer_id ||
      inspection.customer?._id ||
      inspection.customer?.id ||
      inspection.customer
    );

    return hasRegisteredCustomer ? "Online Customer" : "Walk-in Customer";
  };

  const generateContractData = (order) => {
    if (!order) return null;

    const customerName = order.customer_name || `${order.customer?.first_name || ""} ${order.customer?.last_name || ""}`.trim() || "Customer";
    const customerEmail = order.customer_email || order.customer?.email || "N/A";
    const customerPhone = order.customer_phone || order.customer?.phone || "N/A";
    const customerType = order.order_type === "walk_in_customer" ? "Walk-in Customer" : "Online Customer";
    const orderNumber = order.tracking || `ORD-${String(order._id || "").slice(-8).toUpperCase()}`;
    const orderDate = order.createdAt ? formatDateToMMDDYYYY(order.createdAt) : "N/A";
    const siteInspectionDate = order.inspection_date ? formatDateToMMDDYYYY(order.inspection_date) : "TBD";
    const projectLocation = order.shipping_address || "N/A";
    const paymentTermsKey = String(order.payment_terms || "").trim();
    const agreedPaymentDate = order.agreed_payment_date ? formatDateToMMDDYYYY(order.agreed_payment_date) : null;
    const contractTerms = order.contract_terms || "The terms and conditions outlined by ACGC Glass & Aluminum Services apply to this agreement.";
    const totalProjectCost = Number(order.contract_amount || order.total_amount || 0);
    const downPayment = getPaymentSummary(order).requiredAmount;
    const paymentTerms = isFullPaymentPlan(paymentTermsKey)
      ? "Full payment is required before project commences."
      : !paymentTermsKey || paymentTermsKey === "50%_down_payment"
        ? `${formatCurrency(downPayment)} downpayment, balance upon completion`
        : getPaymentTermsLabel(paymentTermsKey);
    const contractNumber = `ACGC-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`;
    const trackingNumber = `TRK-${order.tracking || (order._id?.slice(-4).toUpperCase() || Math.random().toString(36).substring(2, 8).toUpperCase())}`;
    const contractDate = formatDateToMMDDYYYY(new Date());

    const items = (order.items || []).map((item, index) => {
      const itemName = item.name || item.product_id?.name || `Item ${index + 1}`;
      const quantity = Number(item.quantity) || 1;
      const unitPrice = Number(item.unit_price) || 0;
      const width = Number(item.width) || 0;
      const height = Number(item.height) || 0;
      const area = Number(item.area) || Math.round(((width * height) / 144) * 100) / 100;
      const amount = Number(item.line_total) || (item.is_estimate && Number(item.estimated_price) ? Number(item.estimated_price) : quantity * unitPrice);
      return {
        name: itemName,
        quantity,
        width,
        height,
        area,
        unitPrice,
        amount,
        category: item.product_id?.category || item.product_type || "N/A",
        warrantyPeriod: item.warranty_period,
        warrantyCustomDays: item.custom_warranty_days,
        warrantyStartDate: item.warranty_start_date,
        warrantyExpiryDate: item.warranty_expiry_date,
      };
    });

    const subtotal = items.reduce((sum, item) => sum + item.amount, 0);

    return {
      customerName,
      customerType,
      customerEmail,
      customerPhone,
      orderNumber,
      orderDate,
      siteInspectionDate,
      projectLocation,
      totalProjectCost,
      downPayment,
      paymentTerms,
      agreedPaymentDate,
      contractTerms,
      contractNumber,
      trackingNumber,
      contractDate,
      status: (order.contract_status || "pending").toUpperCase(),
      subtotal,
      items,
      orderStatus: order.status,
    };
  };

  const handleGenerateContract = async (orderId) => {
    if (!orderId) return;
    try {
      setGeneratingId(orderId);

      const { order } = await getAdminOrder(orderId, "site_inspection");
      if (!order) {
        toast.error("Order not found");
        return;
      }

      if (!hasValidInspectionDate(order)) {
        toast.error("A Site Inspection Date must be scheduled before a contract can be generated.");
        return;
      }

      const validationErrors = validateContractOrder(order);
      if (validationErrors.length > 0) {
        toast.error(validationErrors.join(" "));
        return;
      }

      const snapshot = buildContractSnapshot(order);
      const alreadyGenerated = Boolean(order.contractGenerated);
      const shouldRegenerate = alreadyGenerated && hasContractSnapshotChanged(order);

      if (alreadyGenerated && !shouldRegenerate) {
        setContractInspection(order);
        setContractData(generateContractData(order));
        setContractNeedsRegeneration(false);
        setShowContractModal(true);
        toast("Existing contract loaded. No duplicate contract was created.", { icon: "📄" });
        return;
      }

      if (alreadyGenerated && shouldRegenerate) {
        setContractInspection(order);
        setContractData({ ...generateContractData(order), contractNeedsRegeneration: true, contractSnapshot: snapshot });
        setContractNeedsRegeneration(true);
        setShowContractModal(true);
        toast("Contract details changed since the previous version. Regenerate to create a new contract version.", { icon: "⚠️" });
        return;
      }

      const contract = generateContractData(order);
      if (!contract) {
        toast.error("Unable to build contract data.");
        return;
      }

      const contractResponse = await generateContract(orderId, {
        contract_terms: order.contract_terms || contract.contractTerms,
        contract_amount: order.contract_amount || contract.totalProjectCost,
        snapshot,
        regenerate: false,
      });
      recordActivity(user, `Generated contract for order ${orderId}.`, "Site Inspection");

      const savedOrder = contractResponse?.order || {};
      const generatedOrder = {
        ...order,
        ...savedOrder,
        customer: typeof savedOrder.customer === "object" ? savedOrder.customer : order.customer,
        status: savedOrder.status || order.status || "site_inspection",
        contract_status: savedOrder.contract_status || "pending",
        contract_terms: savedOrder.contract_terms || order.contract_terms || contract.contractTerms,
        contract_amount: savedOrder.contract_amount || order.contract_amount || contract.totalProjectCost,
        contractGenerated: true,
        contractNeedsRegeneration: false,
        contractSnapshot: snapshot,
      };
      const generatedContract = generateContractData(generatedOrder) || contract;

      const contractEmail = generatedOrder.customer_email || generatedOrder.customer?.email || order.customer_email || order.customer?.email || "";
      if (!contractEmail.trim()) {
        toast("Contract generated, but no customer email was provided. You can still send it manually later.", { icon: "⚠️" });
      }

      setInspections((prev) => {
        const existingIndex = prev.findIndex((inspection) => (inspection._id || inspection.id) === orderId);
        if (existingIndex >= 0) {
          return prev.map((inspection) => ((inspection._id || inspection.id) === orderId ? { ...inspection, ...generatedOrder } : inspection));
        }
        return [generatedOrder, ...prev];
      });

      setViewInspection((prev) => ((prev?._id || prev?.id) === orderId ? null : prev));
      setEditInspection((prev) => (prev?.id === orderId ? null : prev));
      setContractInspection(generatedOrder);
      setContractData({ ...generatedContract, contractNeedsRegeneration: false });
      setContractNeedsRegeneration(false);
      setShowContractModal(true);
      toast.success("Contract generated successfully. Use Send to customer when ready.");
    } catch (err) {
      console.error("Generate contract failed", err);
      toast.error(err?.data?.message || err?.message || "Failed to generate contract.");
    } finally {
      setGeneratingId(null);
    }
  };

  const handleRegenerateContract = async () => {
    const orderId = contractInspection?._id || contractInspection?.id;
    if (!orderId) return;

    try {
      setGeneratingId(orderId);
      const { order } = await getAdminOrder(orderId, "site_inspection");
      if (!order) {
        toast.error("Order not found");
        return;
      }

      const snapshot = buildContractSnapshot(order);
      const contractResponse = await generateContract(orderId, {
        contract_terms: order.contract_terms || "",
        contract_amount: order.contract_amount || order.total_amount || 0,
        snapshot,
        regenerate: true,
      });

      const savedOrder = contractResponse?.order || {};
      const regeneratedOrder = { ...order, ...savedOrder, contractGenerated: true, contractNeedsRegeneration: false, contractSnapshot: snapshot };
      setContractInspection(regeneratedOrder);
      setContractData({ ...generateContractData(regeneratedOrder), contractNeedsRegeneration: false, contractSnapshot: snapshot });
      setContractNeedsRegeneration(false);
      setInspections((prev) => prev.map((inspection) => ((inspection._id || inspection.id) === orderId ? { ...inspection, ...regeneratedOrder } : inspection)));
      recordActivity(user, `Regenerated contract version for order ${orderId}.`, "Site Inspection");
      toast.success("New contract version generated successfully.");
    } catch (err) {
      console.error("Regenerate contract failed", err);
      toast.error(err?.data?.message || err?.message || "Failed to regenerate contract.");
    } finally {
      setGeneratingId(null);
    }
  };

  const createContractPdfDataUrl = async () => {
    const contractElement = document.getElementById("contract-content");
    if (!contractElement) throw new Error("Contract content is not available to export.");

    const { wrapper, clone } = createContractPrintClone(contractElement);
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const exportQualities = [
        { pixelRatio: 2.25, quality: 0.9 },
        { pixelRatio: 1.75, quality: 0.86 },
        { pixelRatio: 1.35, quality: 0.8 },
      ];

      for (const quality of exportQualities) {
        const contractImage = await toJpeg(clone, {
          ...quality,
          backgroundColor: "#ffffff",
        });
        const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();
        const imageProperties = pdf.getImageProperties(contractImage);
        const imageHeight = (imageProperties.height * pdfWidth) / imageProperties.width;
        let heightLeft = imageHeight;
        let position = 0;

        pdf.addImage(contractImage, "JPEG", 0, position, pdfWidth, imageHeight);
        heightLeft -= pdfHeight;
        while (heightLeft > 0) {
          position -= pdfHeight;
          pdf.addPage();
          pdf.addImage(contractImage, "JPEG", 0, position, pdfWidth, imageHeight);
          heightLeft -= pdfHeight;
        }

        const pdfDataUrl = pdf.output("datauristring");
        if (pdfDataUrl.length <= 12 * 1024 * 1024) return pdfDataUrl;
      }

      throw new Error("The contract PDF is too large to attach to an email.");
    } finally {
      wrapper.remove();
    }
  };

  const handleDownloadContract = async () => {
    try {
      const contractPdf = await createContractPdfDataUrl();
      const link = document.createElement("a");
      link.href = contractPdf;
      link.download = `ACGC-Contract-${contractInspection?.tracking || contractInspection?._id || "download"}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success("Contract PDF downloaded.");
    } catch (error) {
      console.error("Download contract failed:", error);
      toast.error("Unable to download the contract PDF.");
    }
  };

  const handleSendToCustomer = async () => {
    const orderId = contractInspection?._id || contractInspection?.id;
    if (!orderId) return;

    const customerName = contractInspection?.customer_name || contractInspection?.customer?.first_name
      ? `${contractInspection?.customer?.first_name || ""} ${contractInspection?.customer?.last_name || ""}`.trim() || contractInspection?.customer_name || "Customer"
      : contractInspection?.customer_name || "Customer";
    const customerEmail = (contractInspection?.customer_email || contractInspection?.customer?.email || contractData?.customerEmail || "").trim();

    if (!customerEmail) {
      toast.error("No customer email is available for this order.");
      return;
    }

    try {
      setSendingCustomerEmail(true);
      const contractAttachment = await createContractPdfDataUrl();

      const emailResponse = await sendWalkInApprovalEmail(orderId, {
        customerName,
        customerEmail,
        contractUrl: contractInspection?.signed_contract_url || "",
        contractAttachment,
      });

      const updatedOrder = {
        ...contractInspection,
        status: "site_inspection",
        contract_status: "sent",
        contractStatus: "Sent",
        contract_email_status: emailResponse.email_status || "queued",
      };

      setContractInspection(updatedOrder);
      setContractData((prev) => ({ ...(prev || {}), orderStatus: "site_inspection", status: "sent", rawContractStatus: "sent" }));
      setInspections((prev) => prev.map((inspection) => ((inspection._id || inspection.id) === orderId ? { ...inspection, status: "site_inspection", contract_status: "sent", contractStatus: "Sent" } : inspection)));

      recordActivity(user, `Sent contract to customer for order ${orderId}.`, "Site Inspection");
      toast.success(emailResponse.message || "Contract saved to the customer account; email queued.");
    } catch (emailError) {
      console.error("Contract send failed:", emailError);
      toast.error(emailError?.data?.message || "The contract could not be sent to the customer.");
    } finally {
      setSendingCustomerEmail(false);
    }
  };

  const normalizeDateInputValue = (value) => {
    if (!value) return "";
    if (value instanceof Date) {
      return value.toISOString().split("T")[0];
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return "";
      const date = new Date(trimmed);
      if (!Number.isNaN(date.getTime())) {
        return date.toISOString().split("T")[0];
      }
      return trimmed.split("T")[0];
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toISOString().split("T")[0];
  };

  const handleEdit = (orderId) => {
    const inspection = inspections.find((i) => (i._id || i.id) === orderId);
    if (inspection) {
      const registeredCustomerId = getRegisteredCustomerId(inspection);
      const isOnlineCustomer = isOnlineCustomerInspection(inspection);
      // Try to extract customer name from multiple sources
      let customerName = "";
      if (inspection.customer?.first_name || inspection.customer?.last_name) {
        customerName = `${inspection.customer.first_name || ""} ${inspection.customer.last_name || ""}`.trim();
      } else if (inspection.customer_name) {
        customerName = inspection.customer_name;
      } else if (inspection.customer?.email) {
        // Fallback: use email if no name available
        customerName = inspection.customer.email;
      } else if (inspection.customer_email) {
        customerName = inspection.customer_email;
      }
      
      const phone = inspection.customer?.phone || inspection.customer_phone || "";
      const customerEmail = inspection.customer?.email || inspection.customer_email || "";
      const siteAddress = inspection.shipping_address || inspection.customer?.street_address || formatCustomerAddress(inspection.customer) || "";
      const orderType = inspection.order_type || "online_order";
      const warrantyPeriodValue = inspection.warranty_period ?? 90;
      const normalizedWarrantyPeriod = normalizeWarrantyPeriodValue(warrantyPeriodValue);
      const paymentProof = getCustomerPaymentProof(inspection);

      setEditInspection({
        id: orderId,
        customerName,
        customerEmail,
        phone,
        siteAddress,
        order_type: orderType,
        payment_terms: inspection.payment_terms || "",
        agreed_payment_date: normalizeDateInputValue(inspection.agreed_payment_date),
        inspection_date: normalizeDateInputValue(inspection.inspection_date),
        estimated_installation_date: normalizeDateInputValue(getEstimatedInstallationDate(inspection)),
        warranty_period: normalizedWarrantyPeriod,
        warranty_assignment_mode: inspection.warranty_assignment_mode === "per_product" ? "per_product" : "same",
        warranty_status: inspection.warranty_status || "",
        warranty_start_date: inspection.warranty_start_date || null,
        warranty_expiry_date: inspection.warranty_expiry_date || null,
        custom_warranty_days:
          normalizedWarrantyPeriod === "Custom"
            ? Number(inspection.custom_warranty_days || inspection.warranty_period) > 0
              ? Number(inspection.custom_warranty_days || inspection.warranty_period)
              : 90
            : 90,
        has_account_on_website: normalizeWalkInWebsiteAccountState({
          order_type: orderType,
          customerType: inspection.customerType,
          customer_type: inspection.customer_type,
          has_account_on_website: inspection.has_account_on_website,
        }) || isOnlineCustomer,
        isOnlineCustomer,
        downpayment_received: Boolean(inspection.downpayment_received),
        required_downpayment_amount: inspection.required_downpayment_amount ?? inspection.downpayment_amount ?? "",
        manual_override: inspection.manual_override || "",
        inspection_notes: inspection.inspection_notes || "",
        issues_found: inspection.issues_found || "",
        inspection_status: inspection.inspection_status || "pending",
        items: (inspection.items || []).map((item) => getEditItemFromOrderItem(item)),
        customerId: registeredCustomerId || null,
        payment_proof_amount: paymentProof.amount,
        payment_proof_file_name: inspection.payment_proof_file_name || inspection.payment_proof_file_url || "",
        payment_method: paymentProof.paymentMethod,
        transaction_number: paymentProof.transactionNumber,
      });
    } else {
      // fallback: open an empty editor
      setEditInspection({ id: orderId, inspection_date: "", inspection_notes: "", issues_found: "", inspection_status: "pending" });
    }
  };

  const handleDelete = (orderId) => {
    // kept for backward compatibility; open confirmation modal
    requestCancel(orderId);
  };

  const handleManualApprovalFileUpload = async (files) => {
    if (!files || files.length === 0) {
      setManualApprovalModal((prev) => ({ ...prev, error: "Please select a signed contract or receipt file." }));
      return;
    }

    const file = files[0];
    const allowedExtensions = [".pdf", ".jpg", ".jpeg", ".png"];
    const fileExtension = "." + file.name.split(".").pop().toLowerCase();

    if (!allowedExtensions.includes(fileExtension)) {
      setManualApprovalModal((prev) => ({ ...prev, error: "Only PDF, JPG, and PNG files are allowed." }));
      return;
    }

    const maxFileSize = 50 * 1024 * 1024;
    if (file.size > maxFileSize) {
      setManualApprovalModal((prev) => ({ ...prev, error: "File size must be less than 50 MB." }));
      return;
    }

    setManualApprovalModal((prev) => ({ ...prev, uploading: true, error: "" }));

    try {
      const uploadResp = await uploadFiles([file], undefined, { purpose: "contracts" });
      const uploadedFileUrl = uploadResp?.success && uploadResp?.files?.length
        ? (typeof uploadResp.files[0] === "string" ? uploadResp.files[0] : uploadResp.files[0]?.url || "")
        : "";

      if (!uploadedFileUrl) {
        throw new Error("Upload failed");
      }

      setManualApprovalModal((prev) => ({
        ...prev,
        uploadedUrl: uploadedFileUrl,
        fileName: file.name,
        uploading: false,
        error: "",
      }));
      toast.success("Signed contract uploaded successfully.");
    } catch (error) {
      console.error("Manual approval upload error:", error);
      setManualApprovalModal((prev) => ({
        ...prev,
        uploadedUrl: "",
        uploading: false,
        error: error?.message || "Failed to upload the signed contract.",
      }));
    }
  };

  const openManualApprovalModal = (inspection) => {
    const orderId = inspection?._id || inspection?.id;
    const orderTracking = inspection?.tracking || inspection?.order_number || inspection?.orderId || `SI-${String((inspection?._id || inspection?.id || "")).slice(-8).toUpperCase()}`;
    if (!orderId) return;

    setManualApprovalModal({
      open: true,
      orderId,
      tracking: orderTracking,
      uploadedUrl: "",
      fileName: "",
      uploading: false,
      error: "",
    });
  };

  const closeManualApprovalModal = () => {
    setManualApprovalModal({
      open: false,
      orderId: null,
      tracking: "",
      uploadedUrl: "",
      fileName: "",
      uploading: false,
      error: "",
    });
  };

  const handleCompleteManualApproval = async () => {
    if (!manualApprovalModal.orderId) return;
    if (!manualApprovalModal.uploadedUrl) {
      setManualApprovalModal((prev) => ({ ...prev, error: "Please upload the signed contract or receipt before completing approval." }));
      return;
    }

    try {
      await updateOrderStatus(manualApprovalModal.orderId, {
        status: "contract_accepted",
        contract_status: "accepted",
        contractStatus: "Accepted",
        acceptance_method: "walk_in_signed_contract",
        acceptanceMethod: "Walk-in Signed Contract",
        acceptedByCustomer: false,
        signed_contract_url: manualApprovalModal.uploadedUrl,
        contract_signed_date: new Date().toISOString(),
        inspection_status: "completed",
        inspection_completed_at: new Date().toISOString(),
        transactionCreated: true,
        transactionCreatedAt: new Date().toISOString(),
      });

      recordActivity(user, `Approved walk-in contract for ${manualApprovalModal.tracking}.`, "Site Inspection");
      toast.success("Signed contract verified. Order moved to Transactions for admin approval.");
      closeManualApprovalModal();
      navigate("/transactions");
    } catch (error) {
      console.error("Complete manual approval failed:", error);
      setManualApprovalModal((prev) => ({
        ...prev,
        error: error?.data?.message || error?.message || "Unable to complete manual approval.",
      }));
    }
  };

  const openContractButtonHandler = async (inspection) => {
    const orderId = inspection?._id || inspection?.id;
    if (!orderId) return;

    try {
      const { order } = await getAdminOrder(orderId, "site_inspection");
      if (!order) {
        toast.error("Order not found");
        return;
      }

      if (!order.contractGenerated) {
        requestGenerateContract(orderId);
        return;
      }

      const shouldRegenerate = hasContractSnapshotChanged(order);
      const contractDataForModal = { ...generateContractData(order), contractNeedsRegeneration: shouldRegenerate };
      setContractInspection(order);
      setContractData(contractDataForModal);
      setContractNeedsRegeneration(shouldRegenerate);
      setShowContractModal(true);
    } catch (error) {
      console.error("Failed to open contract", error);
      toast.error("Unable to open contract details.");
    }
  };

  const handleCancel = async (orderId) => {
    if (!orderId) return;
    try {
      setCancellingId(orderId);
      const res = await updateOrderStatus(orderId, { status: "cancelled" });
      recordActivity(user, `Cancelled site inspection ${orderId}.`, "Site Inspection");
      if (res && res.order) {
        setInspections((prev) => prev.filter((i) => (i._id || i.id) !== orderId));
        setCancelledInspections((prev) => [res.order, ...prev]);
        // show undo toast with react-hot-toast
        toast((t) => (
          <div className="flex items-center justify-between gap-4">
            <div>Inspection cancelled</div>
            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  toast.dismiss(t.id);
                  await handleRestore(orderId);
                }}
                className="text-sm text-blue-600"
              >
                Undo
              </button>
            </div>
          </div>
        ), { duration: 6000 });
      } else {
        setInspections((prev) => prev.filter((i) => (i._id || i.id) !== orderId));
      }
    } catch (err) {
      console.error("Failed to cancel inspection", err);
      toast.error(err?.data?.message || err?.message || "Failed to cancel inspection.");
    } finally {
      setCancellingId(null);
    }
  };

  const [cancelConfirm, setCancelConfirm] = useState({ open: false, id: null });

  const requestCancel = (orderId) => {
    setCancelConfirm({ open: true, id: orderId });
  };

  const handleConfirmCancel = async () => {
    const orderId = cancelConfirm.id;
    setCancelConfirm({ open: false, id: null });
    await handleCancel(orderId);
  };

  const closeCancelModal = () => setCancelConfirm({ open: false, id: null });

  const [restoreConfirm, setRestoreConfirm] = useState({ open: false, id: null });
  const [contractConfirm, setContractConfirm] = useState({ open: false, id: null });

  const requestRestore = (orderId) => {
    setRestoreConfirm({ open: true, id: orderId });
  };

  const requestGenerateContract = (orderId) => {
    setContractConfirm({ open: true, id: orderId });
  };

  const closeRestoreModal = () => setRestoreConfirm({ open: false, id: null });
  const closeContractModal = () => setContractConfirm({ open: false, id: null });

  const handleConfirmRestore = async () => {
    const orderId = restoreConfirm.id;
    setRestoreConfirm({ open: false, id: null });
    await handleRestore(orderId);
  };

  const handleConfirmGenerateContract = async () => {
    const orderId = contractConfirm.id;
    setContractConfirm({ open: false, id: null });
    await handleGenerateContract(orderId);
  };

  const handleRestore = async (orderId) => {
    if (!orderId) return;
    try {
      setRestoringId(orderId);
      const res = await updateOrderStatus(orderId, { status: "site_inspection" });
      recordActivity(user, `Restored site inspection ${orderId}.`, "Site Inspection");
      if (res && res.order) {
        setCancelledInspections((prev) => prev.filter((i) => (i._id || i.id) !== orderId));
        if (isSiteInspectionVisible(res.order)) {
          setInspections((prev) => [res.order, ...prev]);
        }
        toast.success("Inspection restored");
      }
    } catch (err) {
      console.error("Restore failed", err);
      toast.error(err?.data?.message || err?.message || "Failed to restore inspection.");
    } finally {
      setRestoringId(null);
    }
  };

  const handleEditChange = (name, value) => {
    setEditInspection((prev) => {
      if (prev.isOnlineCustomer && ["customerName", "phone", "siteAddress", "customerEmail", "has_account_on_website", "order_type"].includes(name)) {
        return prev;
      }

      if (name === "order_type") {
        return {
          ...prev,
          order_type: value,
          has_account_on_website: value === "walk_in_customer" ? false : true,
        };
      }

      return { ...prev, [name]: name === "phone" ? normalizePhoneInput(value) : value };
    });
  };

  const saveEdit = async () => {
    if (!editInspection || !editInspection.id) return;
    const validationErrors = validateInspectionPayload(editInspection);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      const firstKey = Object.keys(validationErrors)[0];
      const firstError = validationErrors[firstKey];
      if (Array.isArray(firstError)) {
        const rowError = firstError.find((err) => err && Object.values(err).length > 0);
        toast.error(rowError ? Object.values(rowError)[0] : "Please fix the form errors.");
      } else {
        toast.error(firstError);
      }
      return;
    }

    setSavingEdit(true);
    try {
      const payload = {
        ...(!editInspection.isOnlineCustomer ? {
          customer_name: editInspection.customerName || undefined,
          customer_email: editInspection.customerEmail || undefined,
          customer_phone: editInspection.phone || undefined,
          shipping_address: editInspection.siteAddress || undefined,
          has_account_on_website: Boolean(editInspection.has_account_on_website),
        } : {
          has_account_on_website: true,
        }),
        manual_override: editInspection.manual_override || "",
        inspection_date: toApiDate(editInspection.inspection_date),
        inspection_notes: editInspection.inspection_notes || undefined,
        issues_found: editInspection.issues_found || undefined,
        inspection_status: editInspection.inspection_date ? "scheduled" : editInspection.inspection_status || undefined,
        estimated_installation_date: toApiDate(editInspection.estimated_installation_date),
        payment_terms: editInspection.payment_terms || undefined,
        required_downpayment_amount: resolveRequiredPaymentAmount(
          editInspection.payment_terms,
          Number(editInspection.manual_override) || computeEditTotals().totalEstimate,
          editInspection.required_downpayment_amount,
        ),
        agreed_payment_date: toApiDate(editInspection.agreed_payment_date),
        ...buildWarrantyPayload(editInspection.warranty_period, editInspection.custom_warranty_days),
        warranty_assignment_mode: (editInspection.items || []).length > 1 && editInspection.warranty_assignment_mode === "per_product"
          ? "per_product"
          : "same",
        downpayment_received: Boolean(editInspection.downpayment_received),
        items: (editInspection.items || []).map((item) => {
          const normalizedProductId = normalizeProductId(item.product_id);
          // Preserve original product_id if normalization fails; only use null as last resort
          const finalProductId = normalizedProductId || item.product_id || item._id || null;
          const hasMultipleItems = (editInspection.items || []).length > 1;
          const usesItemWarranty = hasMultipleItems && editInspection.warranty_assignment_mode === "per_product";
          const hasStoredItemWarranty = Boolean(
            item.warranty_period || item.warranty_start_date || item.warranty_expiry_date || item.warranty_status
          );
          const isCustomItemWarranty = usesItemWarranty && getItemWarrantySelectValue(item) === "Custom";
          const itemWarrantyPeriod = usesItemWarranty
            ? isCustomItemWarranty ? "Custom" : item.warranty_period || 90
            : editInspection.warranty_period;
          const itemCustomWarrantyDays = usesItemWarranty
            ? Number(item.custom_warranty_days) || getWarrantyPeriodDays(item.warranty_period) || 90
            : Number(editInspection.custom_warranty_days) || 90;
          const warrantyPeriod = itemWarrantyPeriod === "Custom"
            ? itemCustomWarrantyDays
            : itemWarrantyPeriod;
          const warrantyStartDate = item.warranty_start_date || editInspection.warranty_start_date || editInspection.estimated_installation_date;
          return {
            product_id: finalProductId,
            name: item.name || "",
            quantity: Number(item.qty) || Number(item.quantity) || 1,
            unit_price: deriveUnitPriceForPayload(item),
            width: Number(item.width) || 0,
            height: Number(item.height) || 0,
            area: Number(item.area) || 0,
            estimated_price: item.estimation_mode === "manual"
              ? Number(item.manual_estimated_total) || calculateRowSubtotal(item)
              : calculateRowSubtotal(item),
            is_estimate: true,
            unit: item.unit || "sqft",
            ...(hasMultipleItems || hasStoredItemWarranty ? {
              warranty_period: String(warrantyPeriod),
              custom_warranty_days: itemWarrantyPeriod === "Custom" || isCustomItemWarranty ? itemCustomWarrantyDays : null,
              warranty_start_date: toApiDate(warrantyStartDate),
              warranty_expiry_date: calculateWarrantyExpiry(warrantyStartDate, itemWarrantyPeriod, itemCustomWarrantyDays),
              warranty_status: item.warranty_status || editInspection.warranty_status || "pending",
            } : {}),
          };
        }),
        total_amount: Number(editInspection.manual_override) || computeEditTotals().totalEstimate,
      };

      // Validate that all items have product_id before sending
      const itemsWithoutProductId = payload.items.filter((item) => !item.product_id || !item.name);
      if (itemsWithoutProductId.length > 0) {
        const errorMsg = itemsWithoutProductId
          .map((item, idx) => `Row ${idx + 1}: ${!item.product_id ? "Missing product" : "Missing name"}`)
          .join("; ");
        toast.error(`Cannot save inspection: ${errorMsg}`);
        setSavingEdit(false);
        return;
      }

      const res = await updateOrderInspection(editInspection.id, payload);
      recordActivity(user, `Updated site inspection ${editInspection.id}.`, "Site Inspection");
      toast.success("Inspection saved");

      // update local inspections list with returned order
      if (res && res.order) {
        setInspections((prev) => {
          const next = prev.map((i) => ((i._id || i.id) === editInspection.id ? res.order : i));
          return next.filter(isSiteInspectionVisible);
        });
      }
      await fetchSiteInspections();
      setEditInspection(null);
    } catch (err) {
      console.error("Failed to save inspection edit", err, err?.data);
      // Extract detailed error message from backend response
      const details = err?.data?.details;
      const detailMessage = Array.isArray(details)
        ? details.filter(Boolean).join("; ")
        : typeof details === "string"
        ? details
        : null;
      const errorMessage = detailMessage || err?.data?.message || err?.message || "Failed to save inspection.";
      window.alert(errorMessage);
    } finally {
      setSavingEdit(false);
    }
  };

  useEffect(() => {
    localStorage.setItem("sidebarOpen", JSON.stringify(isSidebarOpen));
  }, [isSidebarOpen]);

  const sourceList = activeTab === "cancelled" ? cancelledInspections : inspections.filter(isSiteInspectionVisible);
  const searchedList = filterInspections(sourceList);
  const filteredList = activeTab === "site" && statusFilter !== "all"
    ? searchedList.filter((inspection) => (
        statusFilter === "scheduled"
          ? hasValidInspectionDate(inspection)
          : !hasValidInspectionDate(inspection)
      ))
    : searchedList;
  const totalPages = Math.max(1, Math.ceil(filteredList.length / pageSize));
  const currentPageIndex = Math.min(Math.max(currentPage, 1), totalPages);
  const paginatedList = filteredList.slice((currentPageIndex - 1) * pageSize, currentPageIndex * pageSize);
  const visibleInspections = isMobile ? filteredList : paginatedList;
  const visibleRecordStart = filteredList.length === 0 ? 0 : (currentPageIndex - 1) * pageSize + 1;
  const visibleRecordEnd = Math.min(currentPageIndex * pageSize, filteredList.length);

  useEffect(() => {
    if (!highlightedNotificationRecordId) return;
    const targetIndex = filteredList.findIndex((inspection) => String(inspection._id || inspection.id) === highlightedNotificationRecordId);
    if (targetIndex >= 0) setCurrentPage(Math.floor(targetIndex / pageSize) + 1);
  }, [highlightedNotificationRecordId, inspections, filteredList.length]);

  const getInspectionProductSummary = (inspection) => {
    const items = Array.isArray(inspection?.items) ? inspection.items : [];

    if (!items.length) return "Project Item";

    const names = items
      .map((item) => item?.name || item?.product_id?.name || item?.product_name || "Unnamed item")
      .filter(Boolean);

    if (items.length === 1) return names[0] || "Project Item";

    const firstName = names[0] || "Project Item";
    const extraCount = items.length - 1;

    return `${firstName} + ${extraCount} more item${extraCount > 1 ? "s" : ""}`;
  };

  const getInspectionStatusDisplay = (inspection) => {
    if (activeTab === "cancelled") return "Cancelled";
    return hasValidInspectionDate(inspection) ? "Scheduled" : "Needs to be Called";
  };

  const getInspectionStatusTone = (status) => {
    if (status === "Cancelled") {
      return darkMode
        ? "border border-rose-300/40 bg-rose-500/20 text-rose-100"
        : "border border-rose-200 bg-rose-50 text-rose-700";
    }
    if (status === "Scheduled") {
      return darkMode
        ? "border border-emerald-300/40 bg-emerald-500/20 text-emerald-100"
        : "border border-emerald-200 bg-emerald-50 text-emerald-700";
    }
    return darkMode
      ? "border border-amber-300/40 bg-amber-500/20 text-amber-100"
      : "border border-amber-200 bg-amber-50 text-amber-700";
  };

  const getInspectionActionButtons = (inspection) => {
    const inspectionId = inspection._id || inspection.id;
    const isCancelledTab = activeTab === "cancelled";
    const isWalkIn = inspection.order_type === "walk_in_customer"
      || ["walk-in", "Walk-in Customer", "walk_in_customer"].includes(inspection.customerType);

    return (
      <>
        <button
          type="button"
          className={`${actionButtonClass} ${darkMode ? "bg-blue-500/15 text-blue-300 hover:bg-blue-500/25" : "bg-blue-100 text-blue-600 hover:bg-blue-200"}`}
          onClick={() => handleView(inspection)}
          title="View inspection"
          aria-label="View inspection"
        >
          <Eye size={18} strokeWidth={2.2} />
        </button>
        {!isCancelledTab && (
          <>
            <button
              type="button"
              className={`${actionButtonClass} ${darkMode ? "bg-amber-500/15 text-amber-300 hover:bg-amber-500/25" : "bg-amber-100 text-amber-700 hover:bg-amber-200"}`}
              onClick={() => handleEdit(inspectionId)}
              title="Edit inspection"
              aria-label="Edit inspection"
            >
              <Pencil size={18} strokeWidth={2.2} />
            </button>
            {hasValidInspectionDate(inspection) && (
              <button
                type="button"
                title="Generate or view contract"
                aria-label="Generate or view contract"
                className={`${actionButtonClass} disabled:cursor-not-allowed disabled:opacity-60 ${darkMode ? "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25" : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"}`}
                onClick={() => openContractButtonHandler(inspection)}
                disabled={generatingId === inspectionId}
              >
                {generatingId === inspectionId ? <span className="text-[10px] font-bold">…</span> : <FileText size={18} strokeWidth={2.2} />}
              </button>
            )}
            {isWalkIn && (
              <button
                type="button"
                title="Manual approval"
                aria-label="Manual approval"
                className={`${actionButtonClass} ${darkMode ? "bg-amber-500/15 text-amber-300 hover:bg-amber-500/25" : "bg-amber-100 text-amber-700 hover:bg-amber-200"}`}
                onClick={() => openManualApprovalModal(inspection)}
              >
                <ShieldCheck size={18} strokeWidth={2.2} />
              </button>
            )}
            <button
              type="button"
              className={`${actionButtonClass} disabled:cursor-not-allowed disabled:opacity-60 ${darkMode ? "bg-red-500/15 text-red-300 hover:bg-red-500/25" : "bg-red-100 text-red-600 hover:bg-red-200"}`}
              onClick={() => requestCancel(inspectionId)}
              title="Cancel inspection"
              aria-label="Cancel inspection"
              disabled={cancellingId === inspectionId}
            >
              {cancellingId === inspectionId ? <span className="text-[10px] font-bold">…</span> : <Ban size={18} strokeWidth={2.2} />}
            </button>
          </>
        )}
        {isCancelledTab && (
          <button
            type="button"
            title="Restore inspection"
            aria-label="Restore inspection"
            className={`${actionButtonClass} disabled:cursor-not-allowed disabled:opacity-60 ${darkMode ? "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25" : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"}`}
            onClick={() => requestRestore(inspectionId)}
            disabled={restoringId === inspectionId}
          >
            {restoringId === inspectionId ? <span className="text-[10px] font-bold">…</span> : <RotateCcw size={18} strokeWidth={2.2} />}
          </button>
        )}
      </>
    );
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100">
      <Sidebar isOpen={isSidebarOpen} onToggle={() => setIsSidebarOpen((open) => !open)} />

      <div className="flex-1 min-h-0 flex flex-col">
        <Navbar />

        <main className="flex-1 min-h-0 overflow-y-auto p-6">

          <AdminPageHeader
            title="Site Inspection Management"
            description="Manage all site inspections and estimations."
            stats={[
              { label: "Inspections", value: inspections.length, color: "text-blue-200" },
              { label: "Scheduled", value: inspections.filter(hasValidInspectionDate).length, color: "text-emerald-300" },
              { label: "Cancelled", value: cancelledInspections.length, color: "text-red-300" },
            ]}
          />



          {/* CANCEL CONFIRMATION MODAL */}
          {cancelConfirm.open && (
            <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50">
              <div className="bg-white w-full max-w-md rounded-3xl p-6">
                <h3 className="text-xl font-bold mb-4">Confirm Cancel Inspection</h3>
                <p className="text-gray-600 mb-6">Are you sure you want to mark this inspection as cancelled? This action can be restored only by admins via the backend.</p>

                <div className="flex justify-end gap-3">
                  <button onClick={closeCancelModal} className="px-4 py-2 bg-gray-200 rounded-xl">Close</button>
                  <button
                    onClick={handleConfirmCancel}
                    className="px-4 py-2 bg-red-600 text-white rounded-xl"
                    disabled={cancellingId === cancelConfirm.id}
                  >
                    {cancellingId === cancelConfirm.id ? 'Cancelling...' : 'Confirm Cancel'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* RESTORE CONFIRMATION MODAL */}
          {restoreConfirm.open && (
            <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50">
              <div className="bg-white w-full max-w-md rounded-3xl p-6">
                <h3 className="text-xl font-bold mb-4">Confirm Restore Inspection</h3>
                <p className="text-gray-600 mb-6">Are you sure you want to restore this inspection to Site Inspections?</p>

                <div className="flex justify-end gap-3">
                  <button onClick={closeRestoreModal} className="px-4 py-2 bg-gray-200 rounded-xl">Close</button>
                  <button
                    onClick={handleConfirmRestore}
                    className="px-4 py-2 bg-emerald-600 text-white rounded-xl"
                    disabled={restoringId === restoreConfirm.id}
                  >
                    {restoringId === restoreConfirm.id ? 'Restoring...' : 'Confirm Restore'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {contractConfirm.open && (
            <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50">
              <div className="bg-white w-full max-w-md rounded-3xl p-6">
                <h3 className="text-xl font-bold mb-4">Generate Contract</h3>
                <p className="text-gray-600 mb-6">A contract will be generated for this order. Do you want to continue?</p>

                <div className="flex justify-end gap-3">
                  <button onClick={closeContractModal} className="px-4 py-2 bg-gray-200 rounded-xl">Cancel</button>
                  <button
                    onClick={handleConfirmGenerateContract}
                    className="px-4 py-2 bg-emerald-600 text-white rounded-xl"
                    disabled={generatingId === contractConfirm.id}
                  >
                    {generatingId === contractConfirm.id ? 'Generating...' : 'Confirm'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {manualApprovalModal.open && (
            <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50 p-4">
              <div className="w-full max-w-md rounded-[26px] border border-slate-200 bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.25)]">
                <div className="mb-4 flex justify-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-600 shadow-sm">
                    <ShieldCheck size={24} />
                  </div>
                </div>

                <h3 className="text-center text-[28px] font-black tracking-[-0.04em] text-slate-900">Confirm Manual Approval</h3>
                <p className="mt-3 text-center text-sm leading-6 text-slate-600">
                  You are manually approving the contract for <span className="font-semibold text-slate-800">Order {manualApprovalModal.tracking}</span>. Please upload the signed contract or receipt before proceeding.
                </p>

                <label
                  className="mt-6 flex min-h-[150px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center transition hover:border-red-300 hover:bg-red-50"
                  onClick={() => manualApprovalFileInputRef.current?.click()}
                  onDrop={(event) => {
                    event.preventDefault();
                    handleManualApprovalFileUpload(event.dataTransfer.files);
                  }}
                  onDragOver={(event) => event.preventDefault()}
                >
                  <input
                    ref={manualApprovalFileInputRef}
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg"
                    className="hidden"
                    onChange={(event) => {
                      const files = event.target.files;
                      handleManualApprovalFileUpload(files);
                      event.target.value = "";
                    }}
                  />

                  {manualApprovalModal.uploadedUrl ? (
                    <div className="space-y-2 text-center">
                      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                        <ShieldCheck size={20} />
                      </div>
                      <p className="text-sm font-semibold text-emerald-700">Signed contract uploaded</p>
                      <p className="text-xs font-medium text-slate-600 break-all">{manualApprovalModal.fileName || "Selected file"}</p>
                      <p className="text-xs text-slate-500">Ready for approval</p>
                    </div>
                  ) : (
                    <div className="space-y-2 text-center">
                      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-slate-200 text-slate-500">
                        <FileText size={20} />
                      </div>
                      <p className="text-sm font-semibold text-slate-700">Drag &amp; drop signed contract/receipt here, or browse</p>
                      <p className="text-xs text-slate-500">Supports PDF, PNG, JPG up to 50MB</p>
                    </div>
                  )}
                </label>

                {manualApprovalModal.error && (
                  <p className="mt-3 text-sm font-medium text-red-600">{manualApprovalModal.error}</p>
                )}

                <div className="mt-8 flex justify-end gap-3">
                  <button onClick={closeManualApprovalModal} className="px-4 py-2.5 rounded-xl bg-slate-200 text-slate-700 font-semibold">Cancel</button>
                  <button
                    onClick={handleCompleteManualApproval}
                    className="px-5 py-2.5 rounded-xl bg-red-600 text-white font-bold disabled:cursor-not-allowed disabled:opacity-70"
                    disabled={manualApprovalModal.uploading || !manualApprovalModal.uploadedUrl}
                  >
                    {manualApprovalModal.uploading ? "Uploading..." : "Complete Approval"}
                  </button>
                </div>
              </div>
            </div>
          )}

          <Toaster position="bottom-right" />

          {/* SEARCH */}
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="relative flex-1">
                <Search
                  size={18}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder="Search inspections..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-12 pr-4 text-sm text-slate-700 outline-none transition focus:border-red-400 focus:bg-white"
                />
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                {activeTab === "site" && (
                  <select
                    aria-label="Filter inspections by status"
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value)}
                    className={`min-h-10 rounded-xl border px-3 py-2 text-sm font-semibold outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-100 ${darkMode ? "border-slate-600 bg-[#122d42] text-slate-100" : "border-slate-200 bg-white text-slate-700"}`}
                  >
                    <option value="all">All status</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="needs-call">Needs to be Called</option>
                  </select>
                )}
                <button
                  onClick={() => { resetNewInspectionForm(); setShowModal(true); }}
                  className="inline-flex items-center justify-center rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700"
                >
                  <Plus size={18} className="mr-2" />
                  New Site Inspection
                </button>
              </div>
            </div>
          </div>

          {/* TABLE */}

          <div className={`mt-6 overflow-hidden rounded-3xl border shadow-sm ${darkMode ? "border-slate-700 bg-[#071f2f] shadow-[0_18px_48px_rgba(15,23,42,0.42)]" : "border-slate-200 bg-white"}`}>
            <div className={`border-b px-6 py-5 ${darkMode ? "border-slate-700 bg-[#0b2338]" : "border-slate-200 bg-slate-50"}`}>
              <h2 className={`text-xl font-bold tracking-[-0.02em] ${darkMode ? "text-white" : "text-slate-900"}`}>
                Site Inspection Records
              </h2>
            </div>

            <div className={`flex items-center gap-3 border-b p-4 ${darkMode ? "border-slate-700 bg-[#0d2033]" : "border-slate-200 bg-white"}`}>
              <button className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${activeTab === 'site' ? 'bg-red-600 text-white shadow-sm' : darkMode ? 'bg-slate-700 text-slate-200 hover:bg-slate-600' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`} onClick={() => setActiveTab('site')}>
                Site Inspections
              </button>
              <button className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${activeTab === 'cancelled' ? 'bg-red-600 text-white shadow-sm' : darkMode ? 'bg-slate-700 text-slate-200 hover:bg-slate-600' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`} onClick={() => setActiveTab('cancelled')}>
                Cancelled
              </button>
            </div>

            <div className="hidden md:block">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1280px] table-fixed">
                  <colgroup>
                    <col className="w-[145px]" />
                    <col className="w-[120px]" />
                    <col className="w-[110px]" />
                    <col className="w-[145px]" />
                    <col className="w-[100px]" />
                    <col className="w-[105px]" />
                    <col className="w-[110px]" />
                    <col className="w-[125px]" />
                    <col className="w-[115px]" />
                    <col className="w-[205px]" />
                  </colgroup>
                  <thead className={darkMode ? "bg-[#0d2033] shadow-inner" : "bg-gradient-to-r from-slate-100 via-slate-50 to-white shadow-inner"}>
                    <tr>
                      <th className={`px-2 py-3 text-left text-[10px] font-black uppercase leading-tight tracking-[0.1em] ${darkMode ? "text-slate-300" : "text-black"}`}>Client</th>
                      <th className={`px-2 py-3 text-left text-[10px] font-black uppercase leading-tight tracking-[0.1em] ${darkMode ? "text-slate-300" : "text-black"}`}>Tracking ID</th>
                      <th className={`px-2 py-3 text-left text-[10px] font-black uppercase leading-tight tracking-[0.1em] ${darkMode ? "text-slate-300" : "text-black"}`}>Customer Type</th>
                      <th className={`px-2 py-3 text-left text-[10px] font-black uppercase leading-tight tracking-[0.1em] ${darkMode ? "text-slate-300" : "text-black"}`}>Site Address</th>
                      <th className={`px-2 py-3 text-left text-[10px] font-black uppercase leading-tight tracking-[0.1em] ${darkMode ? "text-slate-300" : "text-black"}`}>Created</th>
                      <th className={`px-2 py-3 text-left text-[10px] font-black uppercase leading-tight tracking-[0.1em] ${darkMode ? "text-slate-300" : "text-black"}`}>Inspection Date</th>
                      <th className={`px-2 py-3 text-left text-[10px] font-black uppercase leading-tight tracking-[0.1em] ${darkMode ? "text-slate-300" : "text-black"}`}>Est. Install Date</th>
                      <th className={`px-2 py-3 text-left text-[10px] font-black uppercase leading-tight tracking-[0.1em] ${darkMode ? "text-slate-300" : "text-black"}`}>Status</th>
                      <th className={`px-2 py-3 text-right text-[10px] font-black uppercase leading-tight tracking-[0.1em] ${darkMode ? "text-slate-300" : "text-black"}`}>Est. Total</th>
                      <th className={`px-4 py-3 text-center text-[10px] font-black uppercase leading-tight tracking-[0.1em] ${darkMode ? "text-slate-300" : "text-black"}`}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inspectionsLoading ? (
                      <tr><td colSpan={11} className={`p-8 text-center ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Loading inspections...</td></tr>
                    ) : !filteredList.length ? (
                      <tr><td colSpan={11} className={`p-8 text-center ${darkMode ? "text-slate-400" : "text-slate-500"}`}>No records in this tab.</td></tr>
                    ) : (
                      visibleInspections.map((inspection, index) => {
                        const clientName = inspection.customer ? `${inspection.customer.first_name || ""} ${inspection.customer.last_name || ""}`.trim() || inspection.customer.email || inspection.customer_name || "Customer" : inspection.customer_name || inspection.customer_email || "Customer";
                        const trackingId = inspection.tracking || inspection.order_number || inspection.orderId || `SI-${String((inspection._id || inspection.id || "")).slice(-8).toUpperCase()}`;
                        const phone = inspection.customer?.phone || inspection.customer_phone || "—";
                        const customerTypeLabel = getCustomerTypeLabel(inspection);
                        const siteAddress = inspection.shipping_address || inspection.siteAddress || inspection.customer?.street_address || "—";
                        const createdDate = formatDateToMMMDDYYYY(inspection.createdAt) || "—";
                        const createdTime = inspection.createdAt ? new Date(inspection.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";
                        const inspectionDate = formatDateToMMMDDYYYY(inspection.inspection_date) || "—";
                        const installDateValue = getEstimatedInstallationDate(inspection);
                        const installDate = formatDateToMMMDDYYYY(installDateValue) || "—";
                        const total = Number(inspection.total_amount || inspection.contract_amount || 0) || (Array.isArray(inspection.items)
                          ? inspection.items.reduce((sum, item) => sum + getInspectionItemTotal(item), 0)
                          : 0);
                        const statusDisplay = getInspectionStatusDisplay(inspection);
                        const progressColor = getInspectionStatusTone(statusDisplay);
                        const rowActions = getInspectionActionButtons(inspection);
                        return (
                          <tr
                            key={inspection._id || inspection.id || index}
                            data-notification-record-id={String(inspection._id || inspection.id || "")}
                            className={highlightedNotificationRecordId === String(inspection._id || inspection.id || "")
                              ? "border-t border-amber-400 bg-amber-100 ring-2 ring-inset ring-amber-500"
                              : darkMode ? "border-t border-slate-700 bg-slate-900/20 hover:bg-slate-800/50" : "border-t border-slate-200 bg-white hover:bg-slate-50"}
                          >
                            <td className="px-2 py-3"><div className="min-w-0"><div className="truncate text-[12px] font-bold text-slate-800 dark:text-slate-100">{clientName}</div><div className="mt-1 text-[10px] text-slate-500">{phone}</div></div></td>
                            <td className="px-2 py-3 text-[12px] text-slate-700">{trackingId}</td>
                            <td className="px-2 py-3 text-[12px] text-slate-700">{customerTypeLabel}</td>
                            <td className="px-2 py-3 text-[12px] text-slate-700"><span className="line-clamp-2 break-words">{siteAddress}</span></td>
                            <td className="px-2 py-3 text-[12px] text-slate-700">{createdDate}<div className="text-[10px] text-slate-500">{createdTime}</div></td>
                            <td className="px-2 py-3 text-[12px] text-slate-700">{inspectionDate}</td>
                            <td className="px-2 py-3 text-[12px] text-slate-700">{installDate}</td>
                            <td className="px-2 py-3"><span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ${progressColor}`}>{statusDisplay}</span></td>
                            <td className="px-2 py-3 text-right text-[12px] font-bold text-slate-900">₱{Number(total || 0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                            <td className="px-4 py-3 text-center"><div className="flex justify-center gap-2">{rowActions}</div></td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-3 p-3 md:hidden">
              {inspectionsLoading ? (
                <div className="rounded-2xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">Loading inspections...</div>
              ) : !filteredList.length ? (
                <div className="rounded-2xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">No records in this tab.</div>
              ) : visibleInspections.map((inspection, index) => {
                const clientName = inspection.customer ? `${inspection.customer.first_name || ""} ${inspection.customer.last_name || ""}`.trim() || inspection.customer.email || inspection.customer_name || "Customer" : inspection.customer_name || inspection.customer_email || "Customer";
                const trackingId = inspection.tracking || inspection.order_number || inspection.orderId || `SI-${String((inspection._id || inspection.id || "")).slice(-8).toUpperCase()}`;
                const inspectionDate = formatDateToMMMDDYYYY(inspection.inspection_date) || "—";
                const installDateValue = getEstimatedInstallationDate(inspection);
                const installDate = formatDateToMMMDDYYYY(installDateValue) || "—";
                const statusDisplay = getInspectionStatusDisplay(inspection);
                const total = Number(inspection.total_amount || inspection.contract_amount || 0) || (Array.isArray(inspection.items) ? inspection.items.reduce((sum, item) => sum + getInspectionItemTotal(item), 0) : 0);
                return (
                  <div
                    key={inspection._id || inspection.id || index}
                    data-notification-record-id={String(inspection._id || inspection.id || "")}
                    className={`rounded-2xl border p-3 transition-colors ${highlightedNotificationRecordId === String(inspection._id || inspection.id || "") ? "border-amber-500 bg-amber-100 ring-2 ring-amber-400" : "border-gray-200 bg-gray-50"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-gray-900">{clientName}</p>
                        <p className="mt-1 text-xs text-gray-500">{trackingId}</p>
                      </div>
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ${getInspectionStatusTone(statusDisplay)}`}>{statusDisplay}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-600">
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-gray-400">Inspection</p>
                        <p className="mt-1 font-medium text-gray-700">{inspectionDate}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-gray-400">Install</p>
                        <p className="mt-1 font-medium text-gray-700">{installDate}</p>
                      </div>
                      <div className="col-span-2">
                        <p className="text-[10px] uppercase tracking-wide text-gray-400">Estimated Total</p>
                        <p className="mt-1 font-semibold text-gray-900">₱{Number(total || 0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex justify-end gap-2">
                      {getInspectionActionButtons(inspection)}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className={`hidden flex-col gap-3 justify-center items-center border-t p-4 md:flex md:flex-row ${darkMode ? "border-slate-700 bg-[#0b2338]" : "border-slate-200 bg-gray-50"}`}>
              <div className={`text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                Showing {visibleRecordStart} - {visibleRecordEnd} of {filteredList.length} records
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                  disabled={currentPage <= 1}
                  className={`px-4 py-2 rounded-lg border disabled:cursor-not-allowed disabled:opacity-50 ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border bg-white text-slate-700 hover:bg-gray-100"}`}
                >
                  Previous
                </button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, idx) => {
                  const startPage = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
                  const pageNumber = startPage + idx;
                  return (
                    <button
                      key={pageNumber}
                      type="button"
                      onClick={() => setCurrentPage(pageNumber)}
                      className={`w-10 h-10 rounded-lg ${pageNumber === currentPage ? 'bg-red-600 text-white' : darkMode ? 'border border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700' : 'border bg-white text-slate-700 hover:bg-gray-100'}`}
                    >
                      {pageNumber}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                  disabled={currentPage >= totalPages}
                  className={`px-4 py-2 rounded-lg border disabled:cursor-not-allowed disabled:opacity-50 ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border bg-white text-slate-700 hover:bg-gray-100"}`}
                >
                  Next
                </button>
              </div>
            </div>

          </div>

          {/* MODAL */}

          {showModal && (
            <div className="mobile-fullscreen-overlay fixed inset-0 z-50 flex h-[100dvh] min-h-0 items-stretch justify-center overflow-hidden overscroll-contain bg-slate-950/60 p-0 backdrop-blur-sm sm:h-auto sm:min-h-screen sm:items-center sm:overflow-y-auto sm:p-5">
              <div className={`mobile-fullscreen-dialog flex h-full max-h-full min-h-0 w-full max-w-none flex-col overflow-hidden rounded-none sm:h-auto sm:max-h-[88dvh] sm:max-w-4xl sm:rounded-3xl ${modalShellClass}`}>
                <div className={`flex shrink-0 items-start justify-between gap-4 px-4 py-4 sm:px-7 sm:py-5 ${modalHeaderClass}`}>
                  <div className="flex min-w-0 items-start gap-3">
                    <span className={`mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${darkMode ? "bg-red-500/15 text-red-300" : "bg-red-50 text-red-600"}`}>
                      <ClipboardList size={20} aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className={`text-[10px] font-bold uppercase tracking-[0.16em] ${darkMode ? "text-red-300" : "text-red-600"}`}>Site inspection</p>
                      <h2 className={`mt-1 text-xl font-bold leading-tight sm:text-2xl ${darkMode ? "text-white" : "text-slate-900"}`}>New Site Inspection</h2>
                      <p className={`mt-1 text-sm leading-5 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>Create a customer record and schedule an inspection.</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${darkMode ? "border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}
                    aria-label="Close new site inspection modal"
                  >
                    <X size={18} aria-hidden="true" />
                  </button>
                </div>

                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:space-y-5 sm:px-6 sm:py-5">
                  <section className={`rounded-2xl p-5 ${modalSectionClass}`}>
                    <h3 className={modalSectionTitleClass}>Client Information</h3>

                    <div className="grid gap-5 md:grid-cols-3">
                      <div className="md:col-span-1">
                        <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>Client Name <span className="text-red-400">*</span></label>
                        <input
                          type="text"
                          placeholder="e.g. Maria Santos"
                          className={`${fieldClass} ${Boolean(selectedCustomer) ? "border-slate-300 bg-slate-200 text-slate-600 shadow-inner dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200" : ""}`}
                          value={customerSearch || newInspection.customerName}
                          onChange={(e) => handleClientNameInput(e.target.value)}
                        />
                        {customerSearchLoading && !selectedCustomer && <p className={`mt-2 text-xs ${mutedTextClass}`}>Searching customers...</p>}
                        {customerSearchError && <p className="mt-2 text-xs text-red-400">{customerSearchError}</p>}
                        {errors.customerName && <p className="mt-2 text-xs text-red-400">{errors.customerName}</p>}
                        {customerSuggestions.length > 0 && !selectedCustomer && (
                          <div className={`absolute z-30 mt-2 w-full max-w-[22rem] rounded-2xl border shadow-lg max-h-72 overflow-y-auto ${darkMode ? "border-slate-700 bg-[#122d42]" : "border-slate-200 bg-white"}`}>
                            {customerSuggestions.map((customer) => {
                              const label = `${customer.first_name || ""} ${customer.last_name || ""}`.trim() || customer.email || customer.phone || "Unnamed";
                              return (
                                <button
                                  key={customer._id}
                                  type="button"
                                  onClick={() => handleCustomerSelect(customer)}
                                  className={`w-full text-left px-4 py-3 ${darkMode ? "hover:bg-slate-700" : "hover:bg-slate-100"}`}
                                >
                                  <div className={`font-semibold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>{label}</div>
                                  <div className={`text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{customer.email || customer.phone || formatCustomerAddress(customer)}</div>
                                </button>
                              );
                            })}
                          </div>
                        )}
                        {errors.customerId && <p className="mt-2 text-xs text-red-500">{errors.customerId}</p>}
                      </div>

                      <div className="md:col-span-1">
                        <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>Client Number <span className="text-red-400">*</span></label>
                        <input
                          type="tel"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          placeholder="e.g. 09171234567"
                          className={selectedCustomer ? lockedFieldClass : fieldClass}
                          value={normalizePhoneInput(newInspection.phone)}
                          onChange={(e) => handleInspectionFieldChange("phone", e.target.value)}
                          readOnly={!!selectedCustomer}
                        />
                        {errors.phone && <p className="mt-2 text-xs text-red-400">{errors.phone}</p>}
                      </div>

                      <div className="md:col-span-1">
                        <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>Site Address <span className="text-red-400">*</span></label>
                        <input
                          type="text"
                          placeholder="e.g. 45 Magsaysay Dr."
                          className={selectedCustomer ? lockedFieldClass : fieldClass}
                          value={newInspection.siteAddress}
                          onChange={(e) => handleInspectionFieldChange("siteAddress", e.target.value)}
                          readOnly={!!selectedCustomer}
                        />
                        {errors.siteAddress && <p className="mt-2 text-xs text-red-400">{errors.siteAddress}</p>}
                      </div>
                    </div>

                    <div className="mt-5 grid gap-5 md:grid-cols-3">
                      <div>
                        <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>Inspection Date <span className="text-red-400">*</span></label>
                        <input
                          type="date"
                          className={fieldClass}
                          value={newInspection.inspection_date}
                          min={today}
                          onChange={(e) => handleInspectionFieldChange("inspection_date", e.target.value)}
                        />
                        {errors.inspection_date && <p className="mt-2 text-xs text-red-400">{errors.inspection_date}</p>}
                      </div>

                      <div>
                        <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>Est. Installation Date <span className="text-red-400">*</span></label>
                        <input
                          type="date"
                          className={fieldClass}
                          value={newInspection.estimated_installation_date || ""}
                          min={today}
                          onChange={(e) => handleInspectionFieldChange("estimated_installation_date", e.target.value)}
                        />
                        {errors.estimated_installation_date && <p className="mt-2 text-xs text-red-400">{errors.estimated_installation_date}</p>}
                      </div>

                      <div>
                        <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>Status</label>
                        <div className={`flex h-[48px] items-center justify-center rounded-xl px-3 text-sm font-bold ${inspectionStatus.className}`}>
                          <span className="mr-2 text-base">{inspectionStatus.icon}</span>
                          {inspectionStatus.label}
                        </div>
                      </div>
                    </div>

                    {newInspection.items.length > 1 && (
                      <div className="mt-6">
                        <p className={`mb-3 text-sm font-semibold ${labelClass}`}>Warranty Assignment</p>
                        <div className="grid max-w-2xl gap-2 sm:grid-cols-2">
                          {[
                            { value: "same", label: "Same Warranty for All Products" },
                            { value: "per_product", label: "Different Warranty per Product" },
                          ].map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              aria-pressed={(newInspection.warranty_assignment_mode || "same") === option.value}
                              onClick={() => setNewInspection((prev) => ({ ...prev, warranty_assignment_mode: option.value }))}
                              className={`min-h-11 rounded-lg border px-3 py-2 text-left text-sm font-semibold transition ${(newInspection.warranty_assignment_mode || "same") === option.value ? "border-red-600 bg-red-600 text-white" : darkMode ? "border-slate-600 bg-[#122d42] text-slate-200" : "border-slate-200 bg-white text-slate-700"}`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {!(newInspection.items.length > 1 && newInspection.warranty_assignment_mode === "per_product") && <div className="mt-6">
                      <p className={`mb-3 text-sm font-semibold ${labelClass}`}>Warranty Period</p>
                      <div className="grid max-w-2xl grid-cols-2 gap-2 sm:grid-cols-4">
                        {["No Warranty", 30, 90, "Custom"].map((option) => {
                          const isSelected = option === "Custom"
                            ? newInspection.warranty_period === "Custom" || normalizeWarrantyPeriodValue(newInspection.warranty_period) === "Custom"
                            : option === "No Warranty"
                              ? newInspection.warranty_period === "No Warranty"
                              : Number(newInspection.warranty_period) === Number(option);
                          return (
                            <button
                              key={String(option)}
                              type="button"
                              onClick={() => {
                                if (option === "Custom") {
                                  handleInspectionFieldChange("warranty_period", "Custom");
                                  setNewInspection((prev) => ({
                                    ...prev,
                                    custom_warranty_days: Number(prev.custom_warranty_days) || 90,
                                  }));
                                  return;
                                }

                                handleInspectionFieldChange("warranty_period", option === "No Warranty" ? option : Number(option));
                              }}
                              className={`min-h-11 w-full rounded-lg border px-3 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
                                isSelected
                                  ? "border-red-600 bg-red-600 text-white shadow-sm"
                                  : darkMode
                                    ? "border-slate-600 bg-[#122d42] text-slate-200 hover:border-slate-500 hover:bg-slate-700"
                                    : "border-slate-200 bg-white text-slate-700 hover:border-red-200 hover:bg-red-50"
                              }`}
                            >
                              {option === "Custom" || option === "No Warranty" ? option : `${option} Days`}
                            </button>
                          );
                        })}
                      </div>

                      {newInspection.warranty_period === "Custom" && (
                        <div className="mt-4 max-w-xs">
                          <label className={`mb-2 block text-[13px] font-bold ${labelClass}`}>
                            Custom Warranty Days
                          </label>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={newInspection.custom_warranty_days || ""}
                            onChange={(e) => {
                              const nextValue = Number(e.target.value);
                              handleInspectionFieldChange("custom_warranty_days", Number.isFinite(nextValue) ? nextValue : 0);
                            }}
                            className={fieldClass}
                            placeholder="e.g. 365"
                          />
                        </div>
                      )}

                      <p className={`mt-3 text-xs ${mutedTextClass}`}>Coverage starts on the installation date. Used for testing warranty expiry.</p>
                    </div>}
                  </section>

                  <section className={`rounded-2xl p-5 ${modalSectionClass}`}>
                    <h3 className={modalSectionTitleClass}>Customer Account</h3>

                    <div className="grid gap-5 md:grid-cols-[1.1fr_1.7fr]">
                      <div>
                        <p className={`mb-2 text-[14px] font-bold ${labelClass}`}>Has Account on Website?</p>
                        <div className={`grid grid-cols-2 overflow-hidden rounded-xl border shadow-sm ${darkMode ? "border-slate-600 bg-[#122d42]" : "border-slate-200 bg-slate-50"}`}>
                          <button
                            type="button"
                            onClick={() => handleInspectionFieldChange("has_account_on_website", true)}
                            className={`flex items-center justify-center gap-2 px-4 py-3 text-sm font-bold transition ${
                              newInspection.has_account_on_website
                                ? darkMode ? "bg-green-500/15 text-green-300" : "bg-green-50 text-green-700"
                                : darkMode ? "bg-[#122d42] text-slate-400" : "bg-white text-slate-500"
                            }`}
                          >
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-green-400 bg-green-600 text-[10px] text-white">✓</span>
                            Yes
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(selectedCustomer || newInspection.customerId)}
                            onClick={() => handleInspectionFieldChange("has_account_on_website", false)}
                            className={`flex items-center justify-center gap-2 px-4 py-3 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                              !newInspection.has_account_on_website
                                ? darkMode ? "bg-slate-700 text-slate-100" : "bg-slate-200 text-slate-800"
                                : darkMode ? "bg-[#122d42] text-slate-400" : "bg-white text-slate-500"
                            }`}
                          >
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-500 bg-slate-600 text-[10px] text-slate-100">×</span>
                            No
                          </button>
                        </div>
                        {newInspection.order_type === "walk_in_customer" && newInspection.has_account_on_website && (
                          <p className={`mt-2 text-xs ${mutedTextClass}`}>Select the matching registered customer from the Client Name search results to link this walk-in record to My Orders.</p>
                        )}
                      </div>

                      <div>
                        <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>Customer Email (optional)</label>
                        <input
                          type="email"
                          placeholder="e.g. maria@email.com"
                          className={fieldClass}
                          value={newInspection.customerEmail}
                          onChange={(e) => handleInspectionFieldChange("customerEmail", e.target.value)}
                          readOnly={Boolean(selectedCustomer)}
                        />
                        <p className={`mt-2 text-xs ${mutedTextClass}`}>Optional — only needed if you plan to email the contract; you can still print it without one.</p>
                      </div>
                    </div>

                  </section>

                  <section className={`rounded-2xl p-5 ${modalSectionClass}`}>
                    <h3 className={modalSectionTitleClass}>Site Details</h3>
                    <textarea
                      rows={4}
                      placeholder="Describe the project scope, access notes, special requirements..."
                      className={fieldClass}
                      value={newInspection.site_notes || newInspection.notes || ""}
                      onChange={(e) => {
                        const value = e.target.value;
                        setNewInspection((prev) => ({ ...prev, site_notes: value, notes: value }));
                      }}
                    />
                  </section>

                  <section className={`rounded-2xl p-3 sm:p-5 ${modalSectionClass}`}>
                    <h3 className={modalSectionTitleClass}>Measurements</h3>
                    <p className={`text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`}>Add or edit measurement rows. Totals update in real time.</p>

                    <div className={`mt-4 hidden overflow-x-auto rounded-xl border md:block ${darkMode ? "border-slate-700 bg-[#122d42]" : "border-slate-200 bg-white"}`}>
                      <div className={`grid min-w-[760px] grid-cols-[1.7fr_0.9fr_0.9fr_0.8fr_0.7fr_1fr_1fr] gap-2 px-3 py-3 text-[10px] font-bold uppercase tracking-[0.1em] ${darkMode ? "bg-[#0d2033] text-slate-300" : "bg-slate-100 text-slate-600"}`}>
                        <div>Product / Description</div>
                        <div>Width</div>
                        <div>Height</div>
                        <div>Unit</div>
                        <div>Qty</div>
                        <div>Price/ Sqft</div>
                        <div>Total</div>
                      </div>

                      {(newInspection.items || []).map((item, index) => {
                        const rowSubtotal = calculateRowSubtotal(item);
                        return (
                          <div key={item.id} className={`grid min-w-[760px] grid-cols-[1.7fr_0.9fr_0.9fr_0.8fr_0.7fr_1fr_1fr] gap-2 border-t p-3 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                            <div className="flex flex-col items-start gap-2">
                              <select
                                value={item.product_id || ""}
                                onChange={(e) => handleItemProductChange(item.id, e.target.value)}
                                className={darkMode ? "w-full rounded-lg border border-slate-600 bg-[#122d42] px-2 py-2 text-sm text-slate-100 outline-none focus:border-red-500" : "w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-900 outline-none focus:border-red-500"}
                              >
                                <option value="">-- Select Active Product --</option>
                                {products.map((product) => (
                                  <option key={String(product._id || product.id)} value={String(product._id || product.id)}>{product.name}</option>
                                ))}
                              </select>
                              {newInspection.items.length > 1 && newInspection.warranty_assignment_mode === "per_product" && (
                                <div className="w-full">
                                  <label className={`mb-1 block text-[10px] font-bold uppercase ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Warranty</label>
                                  <select
                                    aria-label={`Warranty for ${item.name || `product ${index + 1}`}`}
                                    value={getItemWarrantySelectValue(item)}
                                    onChange={(event) => {
                                      const value = event.target.value;
                                      if (value === "Custom") {
                                        handleItemFieldChange(item.id, "warranty_period", "Custom");
                                        if (!Number(item.custom_warranty_days)) handleItemFieldChange(item.id, "custom_warranty_days", 90);
                                      } else {
                                        handleItemFieldChange(item.id, "warranty_period", value === "No Warranty" ? value : Number(value));
                                      }
                                    }}
                                    className={darkMode ? "w-full rounded-lg border border-slate-600 bg-[#122d42] px-2 py-2 text-sm text-slate-100" : "w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-900"}
                                  >
                                    <option value="No Warranty">No Warranty</option>
                                    <option value="30">30 Days</option>
                                    <option value="60">60 Days</option>
                                    <option value="90">90 Days</option>
                                    <option value="Custom">Custom</option>
                                  </select>
                                  {getItemWarrantySelectValue(item) === "Custom" && (
                                    <input
                                      type="number"
                                      min="1"
                                      step="1"
                                      aria-label={`Custom warranty days for product ${index + 1}`}
                                      value={getItemWarrantyCustomDays(item)}
                                      onChange={(event) => handleItemFieldChange(item.id, "custom_warranty_days", event.target.value)}
                                      className={`mt-2 ${darkMode ? "w-full rounded-lg border border-slate-600 bg-[#122d42] px-2 py-2 text-sm text-slate-100" : "w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-900"}`}
                                      placeholder="Custom days"
                                    />
                                  )}
                                </div>
                              )}
                            </div>
                            <input
                              type="number"
                              min="0"
                              value={getDimensionInputValue(item.width)}
                              onFocus={() => clearDefaultDimensionZero(item.id, "width", item.width, handleItemFieldChange)}
                              onChange={(e) => handleItemFieldChange(item.id, "width", e.target.value)}
                              className={darkMode ? "w-full rounded-lg border border-slate-600 bg-[#122d42] px-2 py-2 text-sm text-slate-100 outline-none focus:border-red-500" : "w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-900 outline-none focus:border-red-500"}
                            />
                            <input
                              type="number"
                              min="0"
                              value={getDimensionInputValue(item.height)}
                              onFocus={() => clearDefaultDimensionZero(item.id, "height", item.height, handleItemFieldChange)}
                              onChange={(e) => handleItemFieldChange(item.id, "height", e.target.value)}
                              className={darkMode ? "w-full rounded-lg border border-slate-600 bg-[#122d42] px-2 py-2 text-sm text-slate-100 outline-none focus:border-red-500" : "w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-900 outline-none focus:border-red-500"}
                            />
                            <div className={`flex items-center justify-center rounded-lg border px-2 py-2 text-sm font-medium ${darkMode ? "border-slate-600 bg-[#0d2033] text-slate-200" : "border-slate-200 bg-slate-100 text-slate-700"}`}>
                              {item.unit || "sqft"}
                            </div>
                            <input
                              type="number"
                              min="1"
                              value={item.qty || 1}
                              onChange={(e) => handleItemFieldChange(item.id, "qty", e.target.value)}
                              className={darkMode ? "w-full rounded-lg border border-slate-600 bg-[#122d42] px-2 py-2 text-sm text-slate-100 outline-none focus:border-red-500" : "w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-900 outline-none focus:border-red-500"}
                            />
                            <div className={`flex items-center justify-center rounded-lg border px-2 py-2 text-sm font-bold ${darkMode ? "border-slate-600 bg-[#0d2033] text-slate-100" : "border-slate-200 bg-slate-100 text-slate-800"}`}>
                              {formatCurrency(Number(item.unit_price) || 0)}
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className={`text-sm font-bold ${darkMode ? "text-slate-100" : "text-slate-800"}`}>{formatCurrency(rowSubtotal)}</span>
                              <button type="button" onClick={() => removeItemRow(item.id)} className="text-lg font-bold text-red-400 hover:text-red-300">×</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-4 space-y-3 md:hidden">
                      {(newInspection.items || []).map((item, index) => {
                        const rowSubtotal = calculateRowSubtotal(item);
                        const inputClasses = darkMode
                          ? "min-w-0 w-full rounded-lg border border-slate-600 bg-[#122d42] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-red-500"
                          : "min-w-0 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-red-500";
                        const labelClasses = `mb-1.5 block text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`;

                        return (
                          <div key={item.id} className={`min-w-0 rounded-xl border p-3 ${darkMode ? "border-slate-700 bg-[#0d2033]" : "border-slate-200 bg-slate-50"}`}>
                            <div className="flex items-center justify-between gap-2">
                              <p className={`text-xs font-bold ${darkMode ? "text-slate-200" : "text-slate-700"}`}>Measurement {index + 1}</p>
                              <button type="button" onClick={() => removeItemRow(item.id)} className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-red-500 transition hover:bg-red-500/10" aria-label={`Remove measurement ${index + 1}`} title="Remove measurement">
                                <X size={16} aria-hidden="true" />
                              </button>
                            </div>
                            <div className="mt-2">
                              <label className={labelClasses} htmlFor={`new-measurement-product-${index}`}>Product / Description</label>
                              <select
                                id={`new-measurement-product-${index}`}
                                value={item.product_id || ""}
                                onChange={(event) => handleItemProductChange(item.id, event.target.value)}
                                className={inputClasses}
                              >
                                <option value="">-- Select Active Product --</option>
                                {products.map((product) => (
                                  <option key={String(product._id || product.id)} value={String(product._id || product.id)}>{product.name}</option>
                                ))}
                              </select>
                                {newInspection.items.length > 1 && newInspection.warranty_assignment_mode === "per_product" && (
                                  <div className="mt-3">
                                    <label className={labelClasses} htmlFor={`new-measurement-warranty-${index}`}>Warranty</label>
                                    <select
                                      id={`new-measurement-warranty-${index}`}
                                      value={getItemWarrantySelectValue(item)}
                                      onChange={(event) => {
                                        const value = event.target.value;
                                        if (value === "Custom") {
                                          handleItemFieldChange(item.id, "warranty_period", "Custom");
                                          if (!Number(item.custom_warranty_days)) handleItemFieldChange(item.id, "custom_warranty_days", 90);
                                        } else {
                                          handleItemFieldChange(item.id, "warranty_period", value === "No Warranty" ? value : Number(value));
                                        }
                                      }}
                                      className={inputClasses}
                                    >
                                      <option value="No Warranty">No Warranty</option>
                                      <option value="30">30 Days</option>
                                      <option value="60">60 Days</option>
                                      <option value="90">90 Days</option>
                                      <option value="Custom">Custom</option>
                                    </select>
                                    {getItemWarrantySelectValue(item) === "Custom" && (
                                      <input
                                        type="number"
                                        min="1"
                                        step="1"
                                        aria-label={`Custom warranty days for measurement ${index + 1}`}
                                        value={getItemWarrantyCustomDays(item)}
                                        onChange={(event) => handleItemFieldChange(item.id, "custom_warranty_days", event.target.value)}
                                        className={`${inputClasses} mt-2`}
                                        placeholder="Custom warranty days"
                                      />
                                    )}
                                  </div>
                                )}
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-3">
                              <label className="min-w-0">
                                <span className={labelClasses}>Width</span>
                                <input type="number" min="0" inputMode="decimal" aria-label={`Width for measurement ${index + 1}`} value={getDimensionInputValue(item.width)} onFocus={() => clearDefaultDimensionZero(item.id, "width", item.width, handleItemFieldChange)} onChange={(event) => handleItemFieldChange(item.id, "width", event.target.value)} className={inputClasses} />
                              </label>
                              <label className="min-w-0">
                                <span className={labelClasses}>Height</span>
                                <input type="number" min="0" inputMode="decimal" aria-label={`Height for measurement ${index + 1}`} value={getDimensionInputValue(item.height)} onFocus={() => clearDefaultDimensionZero(item.id, "height", item.height, handleItemFieldChange)} onChange={(event) => handleItemFieldChange(item.id, "height", event.target.value)} className={inputClasses} />
                              </label>
                              <div className="min-w-0">
                                <span className={labelClasses}>Area Unit</span>
                                <div className={`flex min-h-10 items-center rounded-lg border px-3 py-2.5 text-sm font-medium ${darkMode ? "border-slate-600 bg-[#0d2033] text-slate-200" : "border-slate-200 bg-white text-slate-700"}`}>{item.unit || "sqft"}</div>
                              </div>
                              <label className="min-w-0">
                                <span className={labelClasses}>Quantity</span>
                                <input type="number" min="1" inputMode="numeric" aria-label={`Quantity for measurement ${index + 1}`} value={item.qty || 1} onChange={(event) => handleItemFieldChange(item.id, "qty", event.target.value)} className={inputClasses} />
                              </label>
                            </div>
                            <div className={`mt-3 grid grid-cols-2 gap-3 border-t pt-3 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                              <div className="min-w-0">
                                <span className={labelClasses}>Price / Sqft</span>
                                <p className={`truncate text-sm font-semibold ${darkMode ? "text-slate-200" : "text-slate-700"}`}>{formatCurrency(Number(item.unit_price) || 0)}</p>
                              </div>
                              <div className="min-w-0 text-right">
                                <span className={labelClasses}>Row Total</span>
                                <p className={`truncate text-sm font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>{formatCurrency(rowSubtotal)}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <button type="button" onClick={addItemRow} className={`rounded-[12px] border px-4 py-2 text-sm font-bold transition ${darkMode ? "border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20" : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"}`}>
                        + Add Row
                      </button>
                      <div className={`text-right text-lg font-black ${darkMode ? "text-slate-100" : "text-slate-900"}`}>
                        Total: <span className="text-red-400">{formatCurrency(computeTotals().totalEstimate)}</span>
                      </div>
                    </div>
                  </section>

                  <section className={`rounded-2xl p-3 sm:p-5 ${modalSectionClass}`}>
                    <h3 className={modalSectionTitleClass}>Payment Information</h3>
                    <div className={`mb-5 rounded-xl border px-4 py-3 text-sm font-medium ${darkMode ? "border-amber-500/30 bg-amber-500/10 text-amber-100" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
                      <span className="mr-2 text-base">💡</span>
                      Business Policy: {isFullPaymentPlan(newInspection.payment_terms) ? "Full payment is required before project commences." : `A downpayment of ${formatCurrency(resolveRequiredPaymentAmount(newInspection.payment_terms, Number(newInspection.manual_override) || computeTotals().totalEstimate, newInspection.required_downpayment_amount))} is required before project commences.`}
                    </div>

                    <div className="grid gap-5 md:grid-cols-2">
                      <div>
                        <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>Computed Total</label>
                        <div className={`rounded-xl border px-3 py-3 text-xl font-black ${darkMode ? "border-slate-600 bg-[#122d42] text-white" : "border-slate-200 bg-white text-slate-900"}`}>
                          {formatCurrency(computeTotals().totalEstimate)}
                        </div>
                      </div>

                      <div>
                        <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>Manual Override (optional)</label>
                        <input
                          type="number"
                          min="0"
                          placeholder="Enter adjusted total..."
                          className={fieldClass}
                          value={newInspection.manual_override}
                          onChange={(e) => handleInspectionFieldChange("manual_override", e.target.value)}
                        />
                      </div>
                    </div>

                    <div className={`mt-5 rounded-xl border border-dashed px-4 py-4 ${darkMode ? "border-slate-600 bg-[#102838] text-slate-200" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
                      <div className="flex items-center justify-between gap-4 text-[14px] font-bold">
                        <span>Final Estimated Total</span>
                        <span className={`text-[18px] font-black ${darkMode ? "text-white" : "text-slate-900"}`}>
                          {formatCurrency(Number(newInspection.manual_override) || computeTotals().totalEstimate)}
                        </span>
                      </div>
                      <div className={`mt-3 flex items-center justify-between gap-4 border-t pt-3 text-[14px] font-bold ${darkMode ? "border-slate-700 text-red-400" : "border-slate-200 text-red-600"}`}>
                        <label htmlFor="required-downpayment-amount" className="shrink-0">Required Downpayment</label>
                        <input
                          id="required-downpayment-amount"
                          type="number"
                          min="0"
                          max={Number(newInspection.manual_override) || computeTotals().totalEstimate}
                          step="0.01"
                          inputMode="decimal"
                          value={resolveRequiredPaymentAmount(newInspection.payment_terms, Number(newInspection.manual_override) || computeTotals().totalEstimate, newInspection.required_downpayment_amount)}
                          onChange={(event) => handleInspectionFieldChange("required_downpayment_amount", event.target.value)}
                          disabled={isFullPaymentPlan(newInspection.payment_terms)}
                          className={`w-full max-w-[220px] rounded-lg border px-3 py-2 text-right text-base font-black outline-none focus:border-red-500 disabled:opacity-70 ${darkMode ? "border-slate-600 bg-[#122d42] text-red-300" : "border-slate-200 bg-white text-red-600"}`}
                        />
                      </div>
                    </div>

                    <div className="mt-5 grid gap-5 md:grid-cols-2">
                      <div>
                        <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>Payment Terms</label>
                        <select
                          className={fieldClass}
                          value={newInspection.payment_terms}
                          onChange={(e) => handleInspectionFieldChange("payment_terms", e.target.value)}
                        >
                          <option value="50%_down_payment">50% downpayment, 50% upon completion</option>
                          <option value="full_payment">Full Payment</option>
                          <option value="installment_3_months">Installment (3 months)</option>
                          <option value="installment_6_months">Installment (6 months)</option>
                          <option value="custom_arrangement">Custom Arrangement</option>
                        </select>
                        {shouldShowAgreedPaymentDate(newInspection.payment_terms) && (
                          <div className="mt-3">
                            <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>Agreed Payment Date (optional)</label>
                            <input
                              type="date"
                              className={fieldClass}
                              min={today}
                              value={newInspection.agreed_payment_date || ""}
                              onChange={(e) => {
                                const nextValue = e.target.value;
                                if (nextValue && isPastDateValue(nextValue)) {
                                  toast.error("Agreed payment date cannot be in the past.");
                                  return;
                                }
                                handleInspectionFieldChange("agreed_payment_date", nextValue);
                              }}
                            />
                            <p className={`mt-2 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                              Client agreed to pay downpayment on this date.
                            </p>
                          </div>
                        )}
                      </div>

                      <div>
                        <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>{getPaymentReceivedQuestion(newInspection.payment_terms)}</label>
                        <div className={`grid grid-cols-2 overflow-hidden rounded-xl border shadow-sm ${darkMode ? "border-slate-600 bg-[#122d42]" : "border-slate-200 bg-slate-50"}`}>
                          <button
                            type="button"
                            onClick={() => handleInspectionFieldChange("downpayment_received", true)}
                            className={`flex items-center justify-center gap-2 px-4 py-3 text-sm font-bold transition ${
                              newInspection.downpayment_received
                                ? darkMode ? "bg-green-500/15 text-green-300" : "bg-green-50 text-green-700"
                                : darkMode ? "bg-[#122d42] text-slate-400" : "bg-white text-slate-500"
                            }`}
                          >
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-green-400 bg-green-600 text-[10px] text-white">✓</span>
                            {isFullPaymentPlan(newInspection.payment_terms) ? "Yes, Received" : "Yes, Paid"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleInspectionFieldChange("downpayment_received", false)}
                            className={`flex items-center justify-center gap-2 px-4 py-3 text-sm font-bold transition ${
                              !newInspection.downpayment_received
                                ? darkMode ? "bg-slate-700 text-slate-100" : "bg-slate-200 text-slate-800"
                                : darkMode ? "bg-[#122d42] text-slate-400" : "bg-white text-slate-500"
                            }`}
                          >
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-500 bg-slate-600 text-[10px] text-slate-100">✕</span>
                            Not Yet
                          </button>
                        </div>
                      </div>
                    </div>
                  </section>
                </div>

                <div className={`sticky bottom-0 z-10 flex shrink-0 flex-col-reverse gap-2 px-4 py-3 sm:flex-row sm:justify-end sm:gap-3 sm:px-7 sm:py-4 ${footerClass}`}>
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className={`${secondaryButtonClass} w-full sm:w-auto`}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={submitNewInspection}
                    className={`${primaryButtonClass} w-full sm:w-auto`}
                    disabled={submitting}
                  >
                    {submitting ? "Creating..." : "Create Inspection"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* VIEW DETAILS MODAL */}
          {viewInspection && (() => {
            const orderId = viewInspection._id || viewInspection.id;
            const customerName = viewInspection.customer
              ? `${viewInspection.customer.first_name || ""} ${viewInspection.customer.last_name || ""}`.trim() || viewInspection.customer.email || viewInspection.customer_name || "Customer"
              : viewInspection.customer_name || viewInspection.customer_email || "Customer";
            const customerPhone = viewInspection.customer?.phone || viewInspection.customer_phone || "—";
            const siteAddress = viewInspection.shipping_address || viewInspection.siteAddress || viewInspection.customer?.street_address || "—";
            const inspectionDate = viewInspection.inspection_date ? formatDateToMMDDYYYY(viewInspection.inspection_date) : "—";
            const installDateValue = getEstimatedInstallationDate(viewInspection);
            const installDate = installDateValue ? formatDateToMMDDYYYY(installDateValue) : "—";
            const orderReference = viewInspection.order_number || viewInspection.tracking || viewInspection.contract_number || `SI-ORD-${String(orderId || "NEW").slice(-10).toUpperCase()}`;
            const readinessIssues = [];
            if (!viewInspection.inspection_date) readinessIssues.push("Inspection Date");
            const inspectionItems = Array.isArray(viewInspection.items) ? viewInspection.items : [];
            const estimatedTotal = getInspectionDisplayTotal(
              viewInspection,
              inspectionItems.reduce((sum, item) => sum + getInspectionItemTotal(item), 0)
            );
            const isFullPaymentMethod = isFullPaymentPlan(viewInspection.payment_terms);
            const paymentSummary = getPaymentSummary(viewInspection);
            const paymentRequiredAmount = paymentSummary.requiredAmount;
            const balance = paymentSummary.remainingAmount;
            const downPayment = paymentRequiredAmount;
            const paymentReceivedQuestion = getPaymentReceivedQuestion(viewInspection.payment_terms);
            const paymentStatusLabel = getPaymentStatusLabel(viewInspection.payment_terms);
            const paymentTermsText = getPaymentTermsLabel(viewInspection.payment_terms);
            const isPerProductWarranty = inspectionItems.length > 1 && viewInspection.warranty_assignment_mode === "per_product";
            const warrantyPeriod = isPerProductWarranty
              ? "Different per product"
              : viewInspection.warranty_period === "No Warranty"
              ? "No Warranty"
              : `${viewInspection.warranty_period === "Custom"
                ? Number(viewInspection.custom_warranty_days) || 90
                : Number(viewInspection.warranty_period) || 90} days`;
            const agreedPaymentDateValue = viewInspection.agreed_payment_date ? formatDateToMMDDYYYY(viewInspection.agreed_payment_date) : null;
            const statusBadge = !viewInspection.inspection_date
              ? {
                  label: "Needs to be Called",
                  className: darkMode
                    ? "border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs font-bold uppercase tracking-[0.16em] text-violet-200"
                    : "border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-bold uppercase tracking-[0.16em] text-violet-700",
                }
              : {
                  label: "Scheduled",
                  className: darkMode
                    ? "border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-bold uppercase tracking-[0.16em] text-emerald-200"
                    : "border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold uppercase tracking-[0.16em] text-emerald-700",
                };
            const downpaymentStatus = paymentSummary.status.key !== "pending"
              ? {
              label: paymentSummary.status.label,
                  className: darkMode
                    ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                    : "border border-emerald-200 bg-emerald-50 text-emerald-700",
                }
              : {
                  label: "Pending",
                  className: darkMode
                    ? "border border-amber-500/30 bg-amber-500/10 text-amber-200"
                    : "border border-amber-200 bg-amber-50 text-amber-700",
                };
            const measurementRows = inspectionItems.map((item, index) => {
              const itemName = item.name || item.product_id?.name || `Item ${index + 1}`;
              const qty = Number(item.quantity ?? item.qty ?? 1) || 1;
              const unitPrice = Number(item.unit_price ?? item.price ?? 0) || 0;
              const explicitLineTotal = Number(item.estimated_price ?? item.total_price ?? 0);
              const itemWarrantyPeriod = item.warranty_period ?? viewInspection.warranty_period ?? 90;
              const isNoItemWarranty = itemWarrantyPeriod === "No Warranty";
              const itemWarrantyDays = itemWarrantyPeriod === "Custom"
                ? Number(item.custom_warranty_days ?? viewInspection.custom_warranty_days) || 90
                : getWarrantyPeriodDays(itemWarrantyPeriod) || 90;
              const warrantyStartDate = isNoItemWarranty
                ? null
                : item.warranty_start_date || viewInspection.warranty_start_date || getEstimatedInstallationDate(viewInspection);
              const warrantyExpiryDate = isNoItemWarranty
                ? null
                : item.warranty_expiry_date || calculateWarrantyExpiry(warrantyStartDate, itemWarrantyPeriod, item.custom_warranty_days ?? viewInspection.custom_warranty_days);

              return {
                key: `${itemName}-${index}`,
                itemName,
                width: Number(item.width || 0),
                height: Number(item.height || 0),
                unit: item.unit || "in",
                qty,
                unitPrice,
                lineTotal: Number.isFinite(explicitLineTotal) && explicitLineTotal > 0
                  ? explicitLineTotal
                  : qty * unitPrice,
                warrantyPeriod: isNoItemWarranty ? "No Warranty" : `${itemWarrantyDays} days`,
                warrantyStartDate: warrantyStartDate ? formatDateToMMDDYYYY(warrantyStartDate) || "TBD" : "TBD",
                warrantyExpiryDate: warrantyExpiryDate ? formatDateToMMDDYYYY(warrantyExpiryDate) || "TBD" : "TBD",
              };
            });
            const measurementLabelClass = `text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`;

            return (
              <div className="mobile-fullscreen-overlay fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/45 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:items-center sm:p-5">
                <div
                  data-notification-record-id={String(orderId || "")}
                  className={`mobile-fullscreen-dialog flex max-h-[calc(100dvh-1.5rem)] min-h-0 w-full max-w-5xl flex-col overflow-hidden rounded-[18px] border transition-shadow ${modalShellClass} ${highlightedNotificationRecordId === String(orderId || "") ? "ring-4 ring-amber-400" : ""}`}
                >
                  <div className={`flex shrink-0 flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:py-4 ${darkMode ? "border-b border-slate-700 bg-[#0b2338]" : "border-b border-slate-200 bg-white"}`}>
                    <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
                      <h2 className={`text-xl font-black leading-tight sm:text-[28px] ${darkMode ? "text-white" : "text-slate-900"}`}>Inspection Details</h2>
                      <span className={`break-all text-[10px] font-semibold uppercase tracking-[0.12em] sm:text-xs sm:tracking-[0.18em] ${darkMode ? "text-slate-300" : "text-slate-500"}`}>
                        {orderReference}
                      </span>
                    </div>

                    <div className="flex w-full items-center gap-2 sm:w-auto sm:gap-3">
                      <button
                        type="button"
                        onClick={() => handleGenerateContract(orderId)}
                        disabled={!orderId || generatingId === orderId || readinessIssues.length > 0}
                        className="inline-flex min-h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-600/90 px-3 py-2 text-center text-xs font-bold uppercase tracking-[0.12em] leading-tight text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none sm:px-4"
                      >
                        <span>✓</span>
                        {generatingId === orderId ? "Generating..." : "Generate Contract"}
                      </button>

                      <button
                        type="button"
                        onClick={() => setViewInspection(null)}
                        aria-label="Close inspection details"
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border text-lg font-semibold transition ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"}`}
                      >
                        ×
                      </button>
                    </div>
                  </div>

                  {readinessIssues.length > 0 && (
                    <div className={`flex items-center gap-3 border-b px-5 py-3 text-sm font-medium ${darkMode ? "border-amber-500/20 bg-amber-500/10 text-amber-100" : "border-amber-200 bg-[#fdf3d5] text-amber-900"}`}>
                      <span className="text-base">⚠</span>
                      <span>
                        This order isn't ready for contract generation yet. Missing: {readinessIssues.join(", ")}. 
                      </span>
                    </div>
                  )}

                  <div className={`min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5 sm:py-5 ${darkMode ? "bg-[#0d1b2a]" : "bg-[#f4f3f1]"}`}>
                    <div className={`rounded-[16px] border p-5 ${darkMode ? "border-slate-700 bg-[#122d42]" : "border-slate-200 bg-[#f9f9f9]"}`}>
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Client Information</div>
                      </div>

                      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                        <div>
                          <div className={`mb-2 text-[11px] font-black uppercase tracking-[0.18em] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Client Name</div>
                          <div className={`text-lg font-bold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>{customerName}</div>
                        </div>

                        <div>
                          <div className={`mb-2 text-[11px] font-black uppercase tracking-[0.18em] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Client Number</div>
                          <div className={`text-lg font-semibold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>{customerPhone}</div>
                        </div>

                        <div className="md:col-span-1">
                          <div className={`mb-2 text-[11px] font-black uppercase tracking-[0.18em] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Site Address</div>
                          <div className={`text-sm leading-6 ${darkMode ? "text-slate-200" : "text-slate-700"}`}>{siteAddress}</div>
                        </div>
                      </div>

                      <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-3">
                        <div>
                          <div className={`mb-2 text-[11px] font-black uppercase tracking-[0.18em] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Inspection Date</div>
                          <div className={`text-base font-medium ${darkMode ? "text-slate-200" : "text-slate-700"}`}>{inspectionDate}</div>
                        </div>

                        <div>
                          <div className={`mb-2 text-[11px] font-black uppercase tracking-[0.18em] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Est. Installation Date</div>
                          <div className={`text-base font-medium ${darkMode ? "text-slate-200" : "text-slate-700"}`}>{installDate}</div>
                        </div>

                        <div className="flex items-end justify-start md:justify-end">
                          <span className={`inline-flex items-center justify-center rounded-xl border px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] ${statusBadge.className}`}>
                            {statusBadge.label}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className={`rounded-[16px] border p-0 overflow-hidden ${darkMode ? "border-slate-700 bg-[#122d42]" : "border-slate-200 bg-white"}`}>
                      <div className={`px-4 py-3 text-[11px] font-black uppercase tracking-[0.18em] ${darkMode ? "bg-[#0d2033] text-slate-300" : "bg-slate-100 text-slate-500"}`}>
                        Measurements
                      </div>

                      <div className="hidden overflow-x-auto md:block">
                        <table className="min-w-full text-left">
                          <thead className={darkMode ? "bg-[#0d2033] text-slate-300" : "bg-slate-100 text-slate-600"}>
                            <tr>
                              <th className="px-4 py-3 text-[11px] font-black uppercase tracking-[0.14em]">Product / Description</th>
                              <th className="px-4 py-3 text-[11px] font-black uppercase tracking-[0.14em]">Width</th>
                              <th className="px-4 py-3 text-[11px] font-black uppercase tracking-[0.14em]">Height</th>
                              <th className="px-4 py-3 text-[11px] font-black uppercase tracking-[0.14em]">Unit</th>
                              <th className="px-4 py-3 text-[11px] font-black uppercase tracking-[0.14em]">Qty</th>
                              <th className="px-4 py-3 text-[11px] font-black uppercase tracking-[0.14em]">Price/SQFT</th>
                              {inspectionItems.length > 1 && <th className="px-4 py-3 text-[11px] font-black uppercase tracking-[0.14em]">Warranty</th>}
                              <th className="px-4 py-3 text-right text-[11px] font-black uppercase tracking-[0.14em]">Est. Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {measurementRows.length ? measurementRows.map((measurement) => (
                              <tr key={measurement.key} className={darkMode ? "border-t border-slate-700 text-slate-200" : "border-t border-slate-200 text-slate-700"}>
                                <td className="px-4 py-3 font-medium">{measurement.itemName}</td>
                                <td className="px-4 py-3">{measurement.width || "—"}</td>
                                <td className="px-4 py-3">{measurement.height || "—"}</td>
                                <td className="px-4 py-3">{measurement.unit}</td>
                                <td className="px-4 py-3">{measurement.qty}</td>
                                <td className="px-4 py-3">{measurement.unitPrice ? formatCurrency(measurement.unitPrice) : "—"}</td>
                                {inspectionItems.length > 1 && (
                                  <td className="px-4 py-3 text-sm">
                                    <div className="font-semibold">{measurement.warrantyPeriod}</div>
                                    {measurement.warrantyPeriod !== "No Warranty" && (
                                      <div className={darkMode ? "mt-1 text-xs text-slate-400" : "mt-1 text-xs text-slate-500"}>
                                        <div>Start: {measurement.warrantyStartDate}</div>
                                        <div>End: {measurement.warrantyExpiryDate}</div>
                                      </div>
                                    )}
                                  </td>
                                )}
                                <td className="px-4 py-3 text-right font-semibold">{formatCurrency(measurement.lineTotal)}</td>
                              </tr>
                            )) : (
                              <tr>
                                <td colSpan={inspectionItems.length > 1 ? 8 : 7} className={`px-4 py-6 text-center text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                                  No measurement rows available.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>

                      <div className="space-y-3 p-3 md:hidden">
                        {measurementRows.length ? measurementRows.map((measurement, index) => (
                          <article key={measurement.key} className={`min-w-0 rounded-xl border p-3 ${darkMode ? "border-slate-700 bg-[#0d2033]" : "border-slate-200 bg-slate-50"}`}>
                            <h4 className={`break-words text-sm font-semibold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>
                              {measurement.itemName || `Item ${index + 1}`}
                            </h4>
                            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3">
                              <div className="min-w-0">
                                <dt className={measurementLabelClass}>Width</dt>
                                <dd className={`mt-1 text-sm font-medium ${darkMode ? "text-slate-200" : "text-slate-700"}`}>{measurement.width || "—"}</dd>
                              </div>
                              <div className="min-w-0">
                                <dt className={measurementLabelClass}>Height</dt>
                                <dd className={`mt-1 text-sm font-medium ${darkMode ? "text-slate-200" : "text-slate-700"}`}>{measurement.height || "—"}</dd>
                              </div>
                              <div className="min-w-0">
                                <dt className={measurementLabelClass}>Unit</dt>
                                <dd className={`mt-1 text-sm font-medium ${darkMode ? "text-slate-200" : "text-slate-700"}`}>{measurement.unit}</dd>
                              </div>
                              <div className="min-w-0">
                                <dt className={measurementLabelClass}>Quantity</dt>
                                <dd className={`mt-1 text-sm font-medium ${darkMode ? "text-slate-200" : "text-slate-700"}`}>{measurement.qty}</dd>
                              </div>
                              {inspectionItems.length > 1 && (
                                <div className="col-span-2 min-w-0">
                                  <dt className={measurementLabelClass}>Warranty</dt>
                                  <dd className={`mt-1 text-sm font-semibold ${darkMode ? "text-slate-100" : "text-slate-800"}`}>{measurement.warrantyPeriod}</dd>
                                  {measurement.warrantyPeriod !== "No Warranty" && (
                                    <dd className={`mt-1 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                                      Start: {measurement.warrantyStartDate} · End: {measurement.warrantyExpiryDate}
                                    </dd>
                                  )}
                                </div>
                              )}
                            </dl>
                            <div className={`mt-3 grid grid-cols-2 gap-3 border-t pt-3 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                              <div className="min-w-0">
                                <p className={measurementLabelClass}>Price / Sqft</p>
                                <p className={`mt-1 truncate text-sm font-medium ${darkMode ? "text-slate-200" : "text-slate-700"}`}>{measurement.unitPrice ? formatCurrency(measurement.unitPrice) : "—"}</p>
                              </div>
                              <div className="min-w-0 text-right">
                                <p className={measurementLabelClass}>Estimated Total</p>
                                <p className={`mt-1 truncate text-sm font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>{formatCurrency(measurement.lineTotal)}</p>
                              </div>
                            </div>
                          </article>
                        )) : (
                          <p className={`p-4 text-center text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                            No measurement rows available.
                          </p>
                        )}
                      </div>

                      <div className={`flex justify-end px-4 py-3 text-sm font-semibold ${darkMode ? "bg-[#0d2033] text-slate-200" : "bg-slate-50 text-slate-700"}`}>
                        <span>Total: </span>
                        <span className="ml-2 text-base font-black">{formatCurrency(estimatedTotal)}</span>
                      </div>
                    </div>

                    <div className={`rounded-[16px] border p-5 ${darkMode ? "border-slate-700 bg-[#122d42]" : "border-slate-200 bg-[#f5f0f0]"}`}>
                      <div className="mb-4 text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Payment Summary</div>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between text-sm font-semibold">
                          <span className={darkMode ? "text-slate-200" : "text-slate-700"}>Estimated Total</span>
                          <span className={darkMode ? "text-slate-100" : "text-slate-900"}>{formatCurrency(estimatedTotal)}</span>
                        </div>

                        <div className="relative h-10 overflow-hidden rounded-lg border border-rose-200 bg-rose-100">
                          <div className="absolute inset-y-0 left-0 w-1/2 bg-rose-200" />
                          <div className="relative flex h-full items-center justify-between px-3 text-sm font-semibold text-rose-700">
                            <span>{isFullPaymentMethod ? "Full Payment Required" : "Required Downpayment"}</span>
                            <span>{formatCurrency(downPayment)}</span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-sm font-semibold">
                          <span className={darkMode ? "text-slate-200" : "text-slate-700"}>Balance</span>
                          <span className={darkMode ? "text-slate-100" : "text-slate-900"}>{isFullPaymentMethod ? "Paid in Full" : formatCurrency(balance)}</span>
                        </div>

                        <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-4 text-sm text-slate-500">
                          <span>Payment Terms</span>
                          <span className={darkMode ? "text-slate-300" : "text-slate-600"}>{paymentTermsText}</span>
                        </div>

                        <div className="flex items-center justify-between text-sm">
                          <span className={darkMode ? "text-slate-300" : "text-slate-600"}>Warranty Period</span>
                          <span className={darkMode ? "font-semibold text-slate-100" : "font-semibold text-slate-800"}>{warrantyPeriod}</span>
                        </div>

                        {agreedPaymentDateValue && (
                          <div className="mt-3 flex items-center justify-between text-sm text-slate-500">
                            <span className={darkMode ? "text-slate-300" : "text-slate-600"}>Agreed Payment Date (optional)</span>
                            <span className={darkMode ? "text-slate-200" : "text-slate-700"}>{agreedPaymentDateValue}</span>
                          </div>
                        )}

                        <div className="mt-3 flex items-center justify-between text-sm">
                          <span className={darkMode ? "text-slate-300" : "text-slate-600"}>{paymentStatusLabel}</span>
                          <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] ${downpaymentStatus.className}`}>
                            {downpaymentStatus.label}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* EDIT INSPECTION MODAL */}
          {editInspection && (
            <div className="mobile-fullscreen-overlay fixed inset-0 z-50 flex h-[100dvh] min-h-0 items-stretch justify-center overflow-hidden overscroll-contain bg-slate-950/60 p-0 backdrop-blur-sm sm:h-auto sm:min-h-screen sm:items-center sm:overflow-y-auto sm:p-5">
              <div className={`mobile-fullscreen-dialog flex h-full max-h-full min-h-0 w-full max-w-none flex-col overflow-hidden rounded-none sm:h-auto sm:max-h-[88dvh] sm:max-w-4xl sm:rounded-3xl ${modalShellClass}`}>
                <div className={`flex shrink-0 items-start justify-between gap-4 px-4 py-4 sm:px-7 sm:py-5 ${modalHeaderClass}`}>
                  <div className="flex min-w-0 items-start gap-3">
                    <span className={`mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${darkMode ? "bg-red-500/15 text-red-300" : "bg-red-50 text-red-600"}`}>
                      <Pencil size={19} aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className={`text-[10px] font-bold uppercase tracking-[0.16em] ${darkMode ? "text-red-300" : "text-red-600"}`}>Site inspection</p>
                      <h2 className={`mt-1 text-xl font-bold leading-tight sm:text-2xl ${darkMode ? "text-white" : "text-slate-900"}`}>
                        Edit Site Inspection
                      </h2>
                      <p className={`mt-1 text-sm leading-5 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                        Update customer, schedule, and project details.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditInspection(null)}
                    className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${darkMode ? "border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}
                    aria-label="Close edit site inspection modal"
                  >
                    <X size={18} aria-hidden="true" />
                  </button>
                </div>

                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:space-y-5 sm:px-6 sm:py-5">
                  <section className={`rounded-2xl p-5 ${modalSectionClass}`}>
                    <h3 className={`mb-5 text-[13px] font-black uppercase tracking-[0.16em] ${darkMode ? "text-red-400" : "text-red-600"}`}>
                      Client Information
                    </h3>

                    <div className="grid gap-5 md:grid-cols-3">
                      <div>
                        <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>Client Name</label>
                        <input
                          type="text"
                          className={editInspection.isOnlineCustomer ? lockedFieldClass : fieldClass}
                          value={editInspection.customerName || ""}
                          onChange={(e) => handleEditChange("customerName", e.target.value)}
                          readOnly={Boolean(editInspection.isOnlineCustomer)}
                          aria-readonly={Boolean(editInspection.isOnlineCustomer)}
                        />
                      </div>

                      <div>
                        <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>Client Number</label>
                        <input
                          type="tel"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          className={editInspection.isOnlineCustomer ? lockedFieldClass : fieldClass}
                          value={normalizePhoneInput(editInspection.phone)}
                          onChange={(e) => handleEditChange("phone", e.target.value)}
                          readOnly={Boolean(editInspection.isOnlineCustomer)}
                          aria-readonly={Boolean(editInspection.isOnlineCustomer)}
                        />
                      </div>

                      <div>
                        <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>Site Address</label>
                        <input
                          type="text"
                          className={editInspection.isOnlineCustomer ? lockedFieldClass : fieldClass}
                          value={editInspection.siteAddress || ""}
                          onChange={(e) => handleEditChange("siteAddress", e.target.value)}
                          readOnly={Boolean(editInspection.isOnlineCustomer)}
                          aria-readonly={Boolean(editInspection.isOnlineCustomer)}
                        />
                      </div>
                    </div>

                    <div className="mt-5 grid gap-5 md:grid-cols-3">
                      <div>
                        <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>Inspection Date <span className="text-red-400">*</span></label>
                        <input
                          type="date"
                          className={fieldClass}
                          value={editInspection.inspection_date || ""}
                          min={today}
                          onChange={(e) => handleEditChange("inspection_date", e.target.value)}
                        />
                        {errors.inspection_date && <p className="mt-2 text-xs text-red-400">{errors.inspection_date}</p>}
                      </div>

                      <div>
                        <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>Est. Installation Date <span className="text-red-400">*</span></label>
                        <input
                          type="date"
                          className={fieldClass}
                          value={editInspection.estimated_installation_date || ""}
                          min={today}
                          onChange={(e) => handleEditChange("estimated_installation_date", e.target.value)}
                        />
                        {errors.estimated_installation_date && <p className="mt-2 text-xs text-red-400">{errors.estimated_installation_date}</p>}
                      </div>

                      <div>
                        <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>Status</label>
                        <div className={`flex h-[48px] items-center justify-center rounded-xl px-3 text-sm font-bold ${editInspection.inspection_date ? (darkMode ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border border-emerald-200 bg-emerald-50 text-emerald-700") : statusBadgeClass}`}>
                          <span className="mr-2 text-base">{editInspection.inspection_date ? "✓" : "📞"}</span>
                          {editInspection.inspection_date ? "Scheduled" : "Needs to be Called"}
                        </div>
                      </div>
                    </div>

                    {editInspection.items.length > 1 && (
                      <div className="mt-6">
                        <p className={`mb-3 text-sm font-semibold ${labelClass}`}>Warranty Assignment</p>
                        <div className="grid max-w-2xl gap-2 sm:grid-cols-2">
                          {[
                            { value: "same", label: "Same Warranty for All Products" },
                            { value: "per_product", label: "Different Warranty per Product" },
                          ].map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              aria-pressed={(editInspection.warranty_assignment_mode || "same") === option.value}
                              onClick={() => setEditInspection((prev) => ({ ...prev, warranty_assignment_mode: option.value }))}
                              className={`min-h-11 rounded-lg border px-3 py-2 text-left text-sm font-semibold transition ${(editInspection.warranty_assignment_mode || "same") === option.value ? "border-red-600 bg-red-600 text-white" : darkMode ? "border-slate-600 bg-[#122d42] text-slate-200" : "border-slate-200 bg-white text-slate-700"}`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {!(editInspection.items.length > 1 && editInspection.warranty_assignment_mode === "per_product") && <div className="mt-6">
                      <p className={`mb-3 text-sm font-semibold ${labelClass}`}>Warranty Period</p>
                      <div className="grid max-w-2xl grid-cols-2 gap-2 sm:grid-cols-4">
                        {["No Warranty", 30, 90, "Custom"].map((option) => {
                          const isSelected = option === "Custom"
                            ? editInspection.warranty_period === "Custom" || normalizeWarrantyPeriodValue(editInspection.warranty_period) === "Custom"
                            : option === "No Warranty"
                              ? editInspection.warranty_period === "No Warranty"
                              : Number(editInspection.warranty_period) === Number(option);
                          return (
                            <button
                              key={String(option)}
                              type="button"
                              onClick={() => {
                                if (option === "Custom") {
                                  handleEditChange("warranty_period", "Custom");
                                  setEditInspection((prev) => ({
                                    ...prev,
                                    custom_warranty_days: Number(prev.custom_warranty_days) || 90,
                                  }));
                                  return;
                                }

                                handleEditChange("warranty_period", option === "No Warranty" ? option : Number(option));
                              }}
                              className={`min-h-11 w-full rounded-lg border px-3 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
                                isSelected
                                  ? "border-red-600 bg-red-600 text-white shadow-sm"
                                  : darkMode
                                    ? "border-slate-600 bg-[#122d42] text-slate-200 hover:border-slate-500 hover:bg-slate-700"
                                    : "border-slate-200 bg-white text-slate-700 hover:border-red-200 hover:bg-red-50"
                              }`}
                            >
                              {option === "Custom" || option === "No Warranty" ? option : `${option} Days`}
                            </button>
                          );
                        })}
                      </div>

                      {editInspection.warranty_period === "Custom" && (
                        <div className="mt-4 max-w-xs">
                          <label className={`mb-2 block text-[13px] font-bold ${labelClass}`}>
                            Custom Warranty Days
                          </label>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={editInspection.custom_warranty_days || ""}
                            onChange={(e) => {
                              const nextValue = Number(e.target.value);
                              handleEditChange("custom_warranty_days", Number.isFinite(nextValue) ? nextValue : 0);
                            }}
                            className={fieldClass}
                            placeholder="e.g. 365"
                          />
                        </div>
                      )}

                      <p className={`mt-3 text-xs ${mutedTextClass}`}>Coverage starts on the installation date. Used for testing warranty expiry.</p>
                    </div>}

                  </section>

                  <section className={`rounded-2xl p-5 ${modalSectionClass}`}>
                    <h3 className={`mb-5 text-[13px] font-black uppercase tracking-[0.16em] ${darkMode ? "text-red-400" : "text-red-600"}`}>Customer Account</h3>

                    <div className="grid gap-5 md:grid-cols-[1.1fr_1.7fr]">
                      <div>
                        <p className={`mb-2 text-[14px] font-bold ${labelClass}`}>Has Account on Website?</p>
                        <div className={`grid grid-cols-2 overflow-hidden rounded-xl border shadow-sm ${darkMode ? "border-slate-600 bg-[#122d42]" : "border-slate-200 bg-slate-50"}`}>
                          <button
                            type="button"
                            disabled={editInspection.isOnlineCustomer}
                            onClick={() => handleEditChange("has_account_on_website", true)}
                            className={`flex items-center justify-center gap-2 px-4 py-3 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-100 ${Boolean(editInspection.has_account_on_website) ? (darkMode ? "bg-green-500/15 text-green-300" : "bg-green-50 text-green-700") : (darkMode ? "bg-[#122d42] text-slate-400" : "bg-white text-slate-500")}`}
                          >
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-green-400 bg-green-600 text-[10px] text-white">✓</span>
                            Yes
                          </button>
                          <button
                            type="button"
                            disabled={editInspection.isOnlineCustomer}
                            onClick={() => handleEditChange("has_account_on_website", false)}
                            className={`flex items-center justify-center gap-2 px-4 py-3 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${!Boolean(editInspection.has_account_on_website) ? (darkMode ? "bg-slate-700 text-slate-100" : "bg-slate-200 text-slate-800") : (darkMode ? "bg-[#122d42] text-slate-400" : "bg-white text-slate-500")}`}
                          >
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-500 bg-slate-600 text-[10px] text-slate-100">×</span>
                            No
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>Customer Email (optional)</label>
                        <input
                          type="email"
                          className={editInspection.isOnlineCustomer ? lockedFieldClass : fieldClass}
                          value={editInspection.customerEmail || ""}
                          onChange={(e) => handleEditChange("customerEmail", e.target.value)}
                          readOnly={Boolean(editInspection.isOnlineCustomer)}
                          aria-readonly={Boolean(editInspection.isOnlineCustomer)}
                        />
                        <p className={`mt-2 text-xs ${mutedTextClass}`}>Optional — only needed if you plan to email the contract; you can still print it without one.</p>
                      </div>
                    </div>
                  </section>

                  <section className={`rounded-2xl p-5 ${modalSectionClass}`}>
                    <h3 className={`mb-4 text-[13px] font-black uppercase tracking-[0.16em] ${darkMode ? "text-red-400" : "text-red-600"}`}>
                      Site Details
                    </h3>
                    <textarea
                      rows={4}
                      placeholder="Describe the project scope, access notes, special requirements..."
                      className={fieldClass}
                      value={editInspection.inspection_notes || ""}
                      onChange={(e) => handleEditChange("inspection_notes", e.target.value)}
                    />
                  </section>

                  <section className={`rounded-2xl p-5 ${modalSectionClass}`}>
                    <h3 className={`mb-4 text-[13px] font-black uppercase tracking-[0.16em] ${darkMode ? "text-red-400" : "text-red-600"}`}>
                      Measurements
                    </h3>

                    <div className={`mt-4 hidden overflow-hidden rounded-xl border md:block ${darkMode ? "border-slate-700 bg-[#122d42]" : "border-slate-200 bg-white"}`}>
                      <div className={`grid grid-cols-[1.7fr_0.9fr_0.9fr_0.8fr_0.7fr_1fr_1fr] gap-2 px-3 py-3 text-[11px] font-black uppercase tracking-[0.12em] ${darkMode ? "bg-[#0d2033] text-slate-300" : "bg-slate-100 text-slate-600"}`}>
                        <div>Product / Description</div>
                        <div>Width</div>
                        <div>Height</div>
                        <div>Unit</div>
                        <div>Qty</div>
                        <div>Price / Sqft</div>
                        <div>Total</div>
                      </div>

                      {(editInspection.items || []).map((item) => {
                        const rowSubtotal = calculateRowSubtotal(item);
                        return (
                          <div key={item.id || `${item.product_id || "row"}-${Math.random()}`} className={`grid grid-cols-[1.7fr_0.9fr_0.9fr_0.8fr_0.7fr_1fr_1fr] gap-2 border-t p-3 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                            <div className="flex flex-col items-start gap-2">
                              <select
                                value={item.product_id || ""}
                                onChange={(e) => handleEditItemProductChange(item.id, e.target.value)}
                                className={darkMode ? "w-full rounded-lg border border-slate-600 bg-[#122d42] px-2 py-2 text-sm text-slate-100 outline-none focus:border-red-500" : "w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-900 outline-none focus:border-red-500"}
                              >
                                <option value="">-- Select Active Product --</option>
                                {products.map((product) => (
                                  <option key={String(product._id || product.id)} value={String(product._id || product.id)}>{product.name}</option>
                                ))}
                              </select>
                              {editInspection.items.length > 1 && editInspection.warranty_assignment_mode === "per_product" && (
                                <div className="w-full">
                                  <label className={`mb-1 block text-[10px] font-bold uppercase ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Warranty</label>
                                  <select
                                    aria-label={`Warranty for ${item.name || "product"}`}
                                    value={getItemWarrantySelectValue(item)}
                                    onChange={(event) => {
                                      const value = event.target.value;
                                      if (value === "Custom") {
                                        handleEditItemFieldChange(item.id, "warranty_period", "Custom");
                                        if (!Number(item.custom_warranty_days)) handleEditItemFieldChange(item.id, "custom_warranty_days", 90);
                                      } else {
                                        handleEditItemFieldChange(item.id, "warranty_period", value === "No Warranty" ? value : Number(value));
                                      }
                                    }}
                                    className={darkMode ? "w-full rounded-lg border border-slate-600 bg-[#122d42] px-2 py-2 text-sm text-slate-100" : "w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-900"}
                                  >
                                    <option value="No Warranty">No Warranty</option>
                                    <option value="30">30 Days</option>
                                    <option value="60">60 Days</option>
                                    <option value="90">90 Days</option>
                                    <option value="Custom">Custom</option>
                                  </select>
                                  {getItemWarrantySelectValue(item) === "Custom" && (
                                    <input type="number" min="1" step="1" aria-label={`Custom warranty days for ${item.name || "product"}`} value={getItemWarrantyCustomDays(item)} onChange={(event) => handleEditItemFieldChange(item.id, "custom_warranty_days", event.target.value)} className={`mt-2 ${darkMode ? "w-full rounded-lg border border-slate-600 bg-[#122d42] px-2 py-2 text-sm text-slate-100" : "w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-900"}`} placeholder="Custom days" />
                                  )}
                                </div>
                              )}
                            </div>

                            <input
                              type="number"
                              min="0"
                              value={getDimensionInputValue(item.width)}
                              onFocus={() => clearDefaultDimensionZero(item.id, "width", item.width, handleEditItemFieldChange)}
                              onChange={(e) => handleEditItemFieldChange(item.id, "width", e.target.value)}
                              className={darkMode ? "w-full rounded-lg border border-slate-600 bg-[#122d42] px-2 py-2 text-sm text-slate-100 outline-none focus:border-red-500" : "w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-900 outline-none focus:border-red-500"}
                            />

                            <input
                              type="number"
                              min="0"
                              value={getDimensionInputValue(item.height)}
                              onFocus={() => clearDefaultDimensionZero(item.id, "height", item.height, handleEditItemFieldChange)}
                              onChange={(e) => handleEditItemFieldChange(item.id, "height", e.target.value)}
                              className={darkMode ? "w-full rounded-lg border border-slate-600 bg-[#122d42] px-2 py-2 text-sm text-slate-100 outline-none focus:border-red-500" : "w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-900 outline-none focus:border-red-500"}
                            />

                            <div className={`flex items-center justify-center rounded-lg border px-2 py-2 text-sm font-medium ${darkMode ? "border-slate-600 bg-[#0d2033] text-slate-200" : "border-slate-200 bg-slate-100 text-slate-700"}`}>
                              {item.unit || "sqft"}
                            </div>

                            <input
                              type="number"
                              min="1"
                              value={item.qty || item.quantity || 1}
                              onChange={(e) => handleEditItemFieldChange(item.id, "qty", e.target.value)}
                              className={darkMode ? "w-full rounded-lg border border-slate-600 bg-[#122d42] px-2 py-2 text-sm text-slate-100 outline-none focus:border-red-500" : "w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-900 outline-none focus:border-red-500"}
                            />

                            <div className={`flex items-center justify-center rounded-lg border px-2 py-2 text-sm font-bold ${darkMode ? "border-slate-600 bg-[#0d2033] text-slate-100" : "border-slate-200 bg-slate-100 text-slate-800"}`}>
                              {formatCurrency(Number(item.unit_price) || 0)}
                            </div>

                            <div className="flex items-center justify-between gap-2">
                              <span className={`text-sm font-bold ${darkMode ? "text-slate-100" : "text-slate-800"}`}>
                                {formatCurrency(rowSubtotal)}
                              </span>
                              <button type="button" onClick={() => removeEditItemRow(item.id)} className="text-lg font-bold text-red-400 hover:text-red-300">
                                ×
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-4 space-y-3 md:hidden">
                      {(editInspection.items || []).map((item, index) => {
                        const rowSubtotal = calculateRowSubtotal(item);
                        const inputClasses = darkMode
                          ? "min-w-0 w-full rounded-lg border border-slate-600 bg-[#122d42] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-red-500"
                          : "min-w-0 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-red-500";
                        const labelClasses = `mb-1.5 block text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`;

                        return (
                          <div key={item.id || `${item.product_id || "row"}-${index}`} className={`min-w-0 rounded-xl border p-3 ${darkMode ? "border-slate-700 bg-[#0d2033]" : "border-slate-200 bg-slate-50"}`}>
                            <div className="flex items-center justify-between gap-2">
                              <p className={`text-xs font-bold ${darkMode ? "text-slate-200" : "text-slate-700"}`}>Measurement {index + 1}</p>
                              <button type="button" onClick={() => removeEditItemRow(item.id)} className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-red-500 transition hover:bg-red-500/10" aria-label={`Remove measurement ${index + 1}`} title="Remove measurement">
                                <X size={16} aria-hidden="true" />
                              </button>
                            </div>
                            <div className="mt-2">
                              <label className={labelClasses} htmlFor={`edit-measurement-product-${index}`}>Product / Description</label>
                              <select
                                id={`edit-measurement-product-${index}`}
                                value={item.product_id || ""}
                                onChange={(event) => handleEditItemProductChange(item.id, event.target.value)}
                                className={inputClasses}
                              >
                                <option value="">-- Select Active Product --</option>
                                {products.map((product) => (
                                  <option key={String(product._id || product.id)} value={String(product._id || product.id)}>{product.name}</option>
                                ))}
                              </select>
                              {editInspection.items.length > 1 && editInspection.warranty_assignment_mode === "per_product" && (
                                <div className="mt-3">
                                  <label className={labelClasses} htmlFor={`edit-measurement-warranty-${index}`}>Warranty</label>
                                  <select
                                    id={`edit-measurement-warranty-${index}`}
                                    value={getItemWarrantySelectValue(item)}
                                    onChange={(event) => {
                                      const value = event.target.value;
                                      if (value === "Custom") {
                                        handleEditItemFieldChange(item.id, "warranty_period", "Custom");
                                        if (!Number(item.custom_warranty_days)) handleEditItemFieldChange(item.id, "custom_warranty_days", 90);
                                      } else {
                                        handleEditItemFieldChange(item.id, "warranty_period", value === "No Warranty" ? value : Number(value));
                                      }
                                    }}
                                    className={inputClasses}
                                  >
                                    <option value="No Warranty">No Warranty</option>
                                    <option value="30">30 Days</option>
                                    <option value="60">60 Days</option>
                                    <option value="90">90 Days</option>
                                    <option value="Custom">Custom</option>
                                  </select>
                                  {getItemWarrantySelectValue(item) === "Custom" && (
                                    <input type="number" min="1" step="1" aria-label={`Custom warranty days for item ${index + 1}`} value={getItemWarrantyCustomDays(item)} onChange={(event) => handleEditItemFieldChange(item.id, "custom_warranty_days", event.target.value)} className={`${inputClasses} mt-2`} placeholder="Custom warranty days" />
                                  )}
                                </div>
                              )}
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-3">
                              <label className="min-w-0">
                                <span className={labelClasses}>Width</span>
                                <input type="number" min="0" inputMode="decimal" aria-label={`Width for measurement ${index + 1}`} value={getDimensionInputValue(item.width)} onFocus={() => clearDefaultDimensionZero(item.id, "width", item.width, handleEditItemFieldChange)} onChange={(event) => handleEditItemFieldChange(item.id, "width", event.target.value)} className={inputClasses} />
                              </label>
                              <label className="min-w-0">
                                <span className={labelClasses}>Height</span>
                                <input type="number" min="0" inputMode="decimal" aria-label={`Height for measurement ${index + 1}`} value={getDimensionInputValue(item.height)} onFocus={() => clearDefaultDimensionZero(item.id, "height", item.height, handleEditItemFieldChange)} onChange={(event) => handleEditItemFieldChange(item.id, "height", event.target.value)} className={inputClasses} />
                              </label>
                              <div className="min-w-0">
                                <span className={labelClasses}>Area Unit</span>
                                <div className={`flex min-h-10 items-center rounded-lg border px-3 py-2.5 text-sm font-medium ${darkMode ? "border-slate-600 bg-[#0d2033] text-slate-200" : "border-slate-200 bg-white text-slate-700"}`}>{item.unit || "sqft"}</div>
                              </div>
                              <label className="min-w-0">
                                <span className={labelClasses}>Quantity</span>
                                <input type="number" min="1" inputMode="numeric" aria-label={`Quantity for measurement ${index + 1}`} value={item.qty || item.quantity || 1} onChange={(event) => handleEditItemFieldChange(item.id, "qty", event.target.value)} className={inputClasses} />
                              </label>
                            </div>
                            <div className={`mt-3 grid grid-cols-2 gap-3 border-t pt-3 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                              <div className="min-w-0">
                                <span className={labelClasses}>Price / Sqft</span>
                                <p className={`truncate text-sm font-semibold ${darkMode ? "text-slate-200" : "text-slate-700"}`}>{formatCurrency(Number(item.unit_price) || 0)}</p>
                              </div>
                              <div className="min-w-0 text-right">
                                <span className={labelClasses}>Row Total</span>
                                <p className={`truncate text-sm font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>{formatCurrency(rowSubtotal)}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <button type="button" onClick={addEditItemRow} className={`rounded-[12px] border px-4 py-2 text-sm font-bold transition ${darkMode ? "border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20" : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"}`}>
                        + Add Row
                      </button>
                      <div className={`text-right text-lg font-black ${darkMode ? "text-slate-100" : "text-slate-900"}`}>
                        Total: <span className="text-red-400">{formatCurrency(computeEditTotals().totalEstimate)}</span>
                      </div>
                    </div>
                  </section>

                  <section className={`rounded-2xl p-5 ${modalSectionClass}`}>
                    <h3 className={`mb-4 text-[13px] font-black uppercase tracking-[0.16em] ${darkMode ? "text-red-400" : "text-red-600"}`}>
                      Payment Information
                    </h3>

                    <div className={`mb-5 rounded-xl border px-4 py-3 text-sm font-medium ${darkMode ? "border-amber-500/30 bg-amber-500/10 text-amber-100" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
                      <span className="mr-2 text-base">💡</span>
                      Business Policy: {isFullPaymentPlan(editInspection.payment_terms || "") ? "Full payment is required before project commences." : `A downpayment of ${formatCurrency(resolveRequiredPaymentAmount(editInspection.payment_terms, Number(editInspection.manual_override) || computeEditTotals().totalEstimate, editInspection.required_downpayment_amount))} is required before project commences.`}
                    </div>

                    {(() => {
                      const proof = getCustomerPaymentProof(editInspection);
                      const proofNoticeClass = darkMode
                        ? "rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-100 shadow-sm"
                        : "rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 shadow-sm";
                      const proofContainerClass = darkMode
                        ? "mt-3 overflow-hidden rounded-xl border border-slate-700 bg-slate-900 p-3"
                        : "mt-3 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-3";
                      const proofCardClass = darkMode
                        ? "mt-3 rounded-xl border border-slate-700 bg-slate-800 p-3 shadow-sm"
                        : "mt-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm";
                      const proofSecondaryTextClass = darkMode ? "text-slate-400" : "text-slate-500";
                      const proofBodyTextClass = darkMode ? "text-slate-300" : "text-slate-600";
                      if (proof.submitted) {
                        return (
                          <div className="mb-5 space-y-3">
                            <div className={proofNoticeClass}>
                              <p className="font-medium leading-6">
                                Customer says they paid <span className={`font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>₱{Number(proof.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>. Confirm it matches what you received.
                              </p>
                              <p className={`mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${darkMode ? "text-amber-300" : "text-amber-700"}`}>Use this amount</p>
                            </div>

                            <div>
                              <div className={`mb-2 text-[11px] font-bold uppercase tracking-[0.14em] ${darkMode ? "text-slate-300" : "text-slate-500"}`}>PROOF OF PAYMENT</div>
                              <button
                                type="button"
                                className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm transition ${darkMode ? "border-slate-600 bg-slate-800/80 text-slate-200 hover:bg-slate-700" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"}`}
                              >
                                <span className="font-medium">View Proof of Payment</span>
                                <span className={proofSecondaryTextClass}>↗</span>
                              </button>

                              <div className={proofContainerClass}>
                                <div className={`flex items-center justify-between gap-3 text-[11px] font-bold uppercase tracking-[0.12em] ${proofSecondaryTextClass}`}>
                                  <span>Customer Payment Submissions (1)</span>
                                  <span>{proof.paymentMethod || "Cash"}</span>
                                </div>

                                <div className={proofCardClass}>
                                  <div className={`mb-3 flex items-center justify-between gap-3 text-xs ${proofSecondaryTextClass}`}>
                                    <span className={`font-semibold ${darkMode ? "text-slate-200" : "text-slate-700"}`}>Payment #1</span>
                                    <span>{formatDateToMMMDDYYYY(new Date())}</span>
                                  </div>

                                  <div className={`rounded-lg border p-3 ${darkMode ? "border-slate-600 bg-slate-900/80" : "border-slate-200 bg-slate-50"}`}>
                                    <div className={`mb-2 text-[11px] font-bold uppercase tracking-[0.12em] ${proofSecondaryTextClass}`}>Customer declared</div>
                                    <div className={`text-xl font-bold tracking-tight ${darkMode ? "text-white" : "text-slate-900"}`}>
                                      ₱{Number(proof.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </div>
                                  </div>

                                  <div className={`mt-3 grid gap-2 text-sm ${proofBodyTextClass}`}>
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="font-medium">Admin recorded</span>
                                      <span className={`font-semibold ${darkMode ? "text-red-400" : "text-red-600"}`}>
                                        ₱{Number(proof.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                      </span>
                                    </div>
                                    {proof.transactionNumber && (
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="font-medium">Transaction</span>
                                        <span className={`font-semibold ${darkMode ? "text-slate-100" : "text-slate-800"}`}>{proof.transactionNumber}</span>
                                      </div>
                                    )}
                                    {proof.fileName && (
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="font-medium">Attachment</span>
                                        <span className={`max-w-[150px] truncate text-right font-semibold ${darkMode ? "text-slate-100" : "text-slate-800"}`} title={proof.fileName}>{proof.fileName}</span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div className={`mb-5 rounded-xl border px-3 py-3 text-sm ${darkMode ? "border-slate-700 bg-slate-900/60 text-slate-400" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
                          <div className={`mb-2 text-[11px] font-bold uppercase tracking-[0.14em] ${darkMode ? "text-slate-300" : "text-slate-500"}`}>PROOF OF PAYMENT</div>
                          <p>Customer has not submitted proof of payment yet.</p>
                        </div>
                      );
                    })()}

                    <div className="grid gap-5 md:grid-cols-2">
                      <div>
                        <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>Computed Total</label>
                        <div className={`rounded-xl border px-3 py-3 text-xl font-black ${darkMode ? "border-slate-600 bg-[#122d42] text-white" : "border-slate-200 bg-white text-slate-900"}`}>
                          {formatCurrency(computeEditTotals().totalEstimate)}
                        </div>
                      </div>

                      <div>
                        <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>Manual Override (optional)</label>
                        <input
                          type="number"
                          min="0"
                          placeholder="Enter adjusted total..."
                          className={fieldClass}
                          value={editInspection.manual_override || ""}
                          onChange={(e) => handleEditChange("manual_override", e.target.value)}
                        />
                      </div>
                    </div>

                    <div className={`mt-5 rounded-xl border border-dashed px-4 py-4 ${darkMode ? "border-slate-600 bg-[#102838] text-slate-200" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
                      <div className="flex items-center justify-between gap-4 text-[14px] font-bold">
                        <span>Final Estimated Total</span>
                        <span className={`text-[18px] font-black ${darkMode ? "text-white" : "text-slate-900"}`}>
                          {formatCurrency(Number(editInspection.manual_override) || computeEditTotals().totalEstimate)}
                        </span>
                      </div>
                      <div className={`mt-3 flex items-center justify-between gap-4 border-t pt-3 text-[14px] font-bold ${darkMode ? "border-slate-700 text-red-400" : "border-slate-200 text-red-600"}`}>
                        <label htmlFor="edit-required-downpayment-amount" className="shrink-0">Required Downpayment</label>
                        <input
                          id="edit-required-downpayment-amount"
                          type="number"
                          min="0"
                          max={Number(editInspection.manual_override) || computeEditTotals().totalEstimate}
                          step="0.01"
                          inputMode="decimal"
                          value={resolveRequiredPaymentAmount(editInspection.payment_terms, Number(editInspection.manual_override) || computeEditTotals().totalEstimate, editInspection.required_downpayment_amount)}
                          onChange={(event) => handleEditChange("required_downpayment_amount", event.target.value)}
                          disabled={isFullPaymentPlan(editInspection.payment_terms || "")}
                          className={`w-full max-w-[220px] rounded-lg border px-3 py-2 text-right text-base font-black outline-none focus:border-red-500 disabled:opacity-70 ${darkMode ? "border-slate-600 bg-[#122d42] text-red-300" : "border-slate-200 bg-white text-red-600"}`}
                        />
                      </div>
                    </div>

                    <div className="mt-5 grid gap-5 md:grid-cols-2">
                      <div>
                        <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>Payment Terms</label>
                        <select
                          className={fieldClass}
                          value={editInspection.payment_terms || ""}
                          onChange={(e) => handleEditChange("payment_terms", e.target.value)}
                        >
                          <option value="50%_down_payment">50% downpayment, 50% upon completion</option>
                          <option value="full_payment">Full Payment</option>
                          <option value="installment_3_months">Installment (3 months)</option>
                          <option value="installment_6_months">Installment (6 months)</option>
                          <option value="custom_arrangement">Custom Arrangement</option>
                        </select>
                        {shouldShowAgreedPaymentDate(editInspection.payment_terms || "") && (
                          <div className="mt-3">
                            <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>Agreed Payment Date (optional)</label>
                            <input
                              type="date"
                              className={fieldClass}
                              min={today}
                              value={editInspection.agreed_payment_date || ""}
                              onChange={(e) => {
                                const nextValue = e.target.value;
                                if (nextValue && isPastDateValue(nextValue)) {
                                  toast.error("Agreed payment date cannot be in the past.");
                                  return;
                                }
                                handleEditChange("agreed_payment_date", nextValue);
                              }}
                            />
                            <p className={`mt-2 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                              Client agreed to pay downpayment on this date.
                            </p>
                          </div>
                        )}
                      </div>

                      <div>
                        <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>{getPaymentReceivedQuestion(editInspection.payment_terms || "")}</label>
                        <div className={`grid grid-cols-2 overflow-hidden rounded-xl border shadow-sm ${darkMode ? "border-slate-600 bg-[#122d42]" : "border-slate-200 bg-slate-50"}`}>
                          <button
                            type="button"
                            onClick={() => handleEditChange("downpayment_received", true)}
                            className={`flex items-center justify-center gap-2 px-4 py-3 text-sm font-bold transition ${editInspection.downpayment_received ? (darkMode ? "bg-green-500/15 text-green-300" : "bg-green-50 text-green-700") : (darkMode ? "bg-[#122d42] text-slate-400" : "bg-white text-slate-500")}`}
                          >
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-green-400 bg-green-600 text-[10px] text-white">✓</span>
                            {isFullPaymentPlan(editInspection.payment_terms || "") ? "Yes, Received" : "Yes, Paid"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleEditChange("downpayment_received", false)}
                            className={`flex items-center justify-center gap-2 px-4 py-3 text-sm font-bold transition ${!editInspection.downpayment_received ? (darkMode ? "bg-slate-700 text-slate-100" : "bg-slate-200 text-slate-800") : (darkMode ? "bg-[#122d42] text-slate-400" : "bg-white text-slate-500")}`}
                          >
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-500 bg-slate-600 text-[10px] text-slate-100">×</span>
                            Not Yet
                          </button>
                        </div>
                      </div>
                    </div>
                  </section>
                </div>

                <div className={`sticky bottom-0 z-10 flex shrink-0 flex-col-reverse gap-2 px-4 py-3 sm:flex-row sm:justify-end sm:gap-3 sm:px-7 sm:py-4 ${footerClass}`}>
                  <button
                    type="button"
                    onClick={() => setEditInspection(null)}
                    className={`${secondaryButtonClass} w-full sm:w-auto`}
                    disabled={savingEdit}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={saveEdit}
                    className={`${primaryButtonClass} w-full sm:w-auto`}
                    disabled={savingEdit}
                  >
                    {savingEdit ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </div>
            </div>
          )}

        </main>

        {/* Contract Modal */}
        <ContractModal
          isOpen={showContractModal}
          onClose={() => {
            setShowContractModal(false);
            setContractNeedsRegeneration(false);
          }}
          inspection={contractInspection}
          contractData={contractData}
          onDownload={handleDownloadContract}
          onSendToCustomer={contractInspection?.order_type === "walk_in_customer" ? undefined : handleSendToCustomer}
          isSendingToCustomer={sendingCustomerEmail}
          darkMode={darkMode}
        />
      </div>
    </div>
  );
}

export default SiteInspection;
