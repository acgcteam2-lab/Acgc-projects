import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { createPortal } from "react-dom";
import toast, { Toaster } from "react-hot-toast";
import { toPng } from "html-to-image";
import { Button } from "@/components/ui/button";
import {
  Home,
  ShoppingCart,
  Info,
  User,
  LogOut,
  Search,
  Mail,
  Phone,
  MapPin,
  Camera,
  Save,
  ShieldCheck,
  Ruler,
  Package,
  ArrowRight,
  Plus,
  Minus,
  FileText,
  Eye,
  Pencil,
  Bell,
  Check,
  CheckCheck,
  CheckCircle,
  AlertTriangle,
  Star,
  StarHalf,
  Clock3,
  Wrench,
  Moon,
  Sun,
  ArrowLeft,
  X,
  ClipboardList,
  CreditCard,
  Trash2,
  Paperclip,
  ChevronDown,
  ChevronUp,
  ImagePlus,
  Scissors,
  Truck,
} from "lucide-react";
import logo from "../../assets/images/ACGCLOGO1.png";
import { useAuth } from "@/contexts/AuthContext";
import { getProducts } from "@/api/products";
import { API_BASE, apiFetch } from "@/api/client";
import { resolveBackendImageUrl } from "@/lib/resolveBackendImageUrl";
import {
  createOrder,
  getOrders,
  trackOrder,
  acceptContract,
  declineContract,
  submitOrderReview,
  getProductReviews,
  cancelCustomerOrder,
} from "@/api/orders";
import { uploadFiles } from "@/api/uploads";
import ContractModal from "../../components/ContractModal";
import { formatOrderItemMeasurements } from "@/components/OrderProgressTimeline";
import OrderTimelineModal from "@/components/OrderTimelineModal";
import { calculateEstimate } from "@/lib/estimator";
import { buildOrderTimelineStages, calculateStageProgressPercent } from "@/lib/orderTimeline";
import { getProgressColor } from "@/lib/utils";
import { paginateItems } from "@/lib/pagination";
import { useIsMobile } from "@/hooks/useIsMobile";
import { getSystemSettings } from "@/api/users";
import { getCart, saveCart } from "@/api/cart";
import { formatDateToMMMDDYYYY, formatDateTimeToMMMDDYYYY, formatTimeAgo } from "@/lib/dateUtils";
import { buildDelayNotifications, sortCustomerNotificationsNewestFirst } from "@/lib/delayNotifications";
import { getOrderStatusClasses, getOrderStatusLabel, normalizeOrderStatus, normalizeOrderStatusKey } from "./orderStatusUtils";
import { getPaymentSummary, isPaymentProofConfirmed } from "@/pages/Transactions/paymentProofUtils";
import { buildProductPriceSnapshot, getProductLineTotal } from "@/lib/productPricing";

const PRODUCT_IMAGE_PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='400' viewBox='0 0 600 400'%3E%3Crect width='600' height='400' fill='%23e2e8f0'/%3E%3Cpath d='M248 148h104a28 28 0 0 1 28 28v48a28 28 0 0 1-28 28H248a28 28 0 0 1-28-28v-48a28 28 0 0 1 28-28Zm0 20a8 8 0 0 0-8 8v48a8 8 0 0 0 8 8h104a8 8 0 0 0 8-8v-48a8 8 0 0 0-8-8H248Zm18 22a16 16 0 1 1 0 32 16 16 0 0 1 0-32Zm50 35 17-21 31 40H244l34-42 25 30 13-7Z' fill='%2394a3b8'/%3E%3Ctext x='300' y='292' text-anchor='middle' font-family='Arial, sans-serif' font-size='24' font-weight='700' fill='%23475569'%3EProduct image%3C/text%3E%3C/svg%3E";

const CUSTOMER_READ_NOTIFICATIONS_KEY = "acgc-customer-read-notifications";
const CUSTOMER_DARK_MODE_KEY = "acgc-customer-dark-mode";
const getOrderSubmissionMessage = (response, action) => {
  const baseMessage = `${action} successfully. Tracking ID: ${response.order.tracking}`;
  if (response.notification_email_status === "sent") return `${baseMessage} A confirmation email was sent to your account email.`;
  if (response.notification_email_status === "missing_recipient") return `${baseMessage} No confirmation email was sent because your account has no email address.`;
  return `${baseMessage} We couldn't send the confirmation email right now. Please contact support.`;
};
const ORDER_REVIEW_TEMPLATES = [
  {
    value: "quality",
    label: "Product quality",
    title: "Excellent product quality",
    comment: "The product quality is excellent, and the finished project looks great. I am very satisfied with the result.",
  },
  {
    value: "service",
    label: "Professional service",
    title: "Professional service",
    comment: "The team communicated clearly, arrived as scheduled, and handled the project professionally. I am happy with the service.",
  },
  {
    value: "installation",
    label: "Installation experience",
    title: "Great installation experience",
    comment: "The installation was completed carefully and as agreed. The team did a great job, and I would recommend their service.",
  },
];

const getDelayNotificationMessage = (notification) => {
  const stageName = notification.delayStageName || "Project stage";
  const reason = notification.delayReason ? ` Reason: ${notification.delayReason}` : "";
  const expectedResolution = formatDateToMMMDDYYYY(notification.delayExpectedResolution);
  const resolutionText = expectedResolution ? ` Expected resolution: ${expectedResolution}.` : "";
  return `${stageName} is delayed.${reason}${resolutionText}`;
};

const normalizeAddress = (value) => {
  if (!value) return "";
  const cleaned = value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[,;]+/g, ",")
    .replace(/\s*[.,]\s*/g, ", ")
    .replace(/\s*,\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const canonical = (text) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\b(city|province|zip|code|street|st|road|rd)\b/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const parts = cleaned
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const normalizedParts = [];
  const seen = [];

  for (const part of parts) {
    const key = canonical(part);
    if (!key) {
      normalizedParts.push(part);
      continue;
    }
    const isDuplicate = seen.some(
      (existing) => existing === key || existing.includes(key) || key.includes(existing)
    );
    if (!isDuplicate) {
      seen.push(key);
      normalizedParts.push(part);
    }
  }

  return normalizedParts.join(", ");
};

const buildFullAddress = (user) => {
  if (!user) return "";
  const addressParts = [user.street_address, user.city, user.province, user.zip_code].filter(Boolean);
  return normalizeAddress(addressParts.join(", "));
};

const renderRatingStars = (rating = 0, size = 18) => {
  const normalizedRating = Number(rating) || 0;
  const fullStars = Math.floor(normalizedRating);
  const hasHalfStar = normalizedRating - fullStars >= 0.5;

  return Array.from({ length: 5 }, (_, index) => {
    if (index < fullStars) {
      return <Star key={index} size={size} fill="currentColor" className="text-amber-500" />;
    }

    if (index === fullStars && hasHalfStar) {
      return <StarHalf key={index} size={size} fill="currentColor" className="text-amber-500" />;
    }

    return <Star key={index} size={size} className="text-slate-300" />;
  });
};

function CustomerDashboard() {
  const isMobile = useIsMobile();
  const API_HOST = (function getApiHost() {
    try {
      return (API_BASE || "").replace(/\/api$/, "");
    } catch (e) {
      return "";
    }
  })();

  const isLocalBlobOrFile = (url) => typeof url === "string" && (url.startsWith("blob:") || url.startsWith("file:"));

  const ensureAbsoluteUrl = (url) => {
    if (!url) return PRODUCT_IMAGE_PLACEHOLDER;
    if (isLocalBlobOrFile(url)) return PRODUCT_IMAGE_PLACEHOLDER;
    url = resolveBackendImageUrl(url);
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith("/")) return API_HOST ? `${API_HOST}${url}` : url;
    if (url.startsWith("uploads/")) return API_HOST ? `${API_HOST}/${url}` : `/${url}`;
    return API_HOST ? `${API_HOST}/${url}` : url;
  };
  const { user, loading, updateProfile, refreshUser, logout } = useAuth();
  const orderOwnerId = user?.id || user?._id;
  const navigate = useNavigate();
  const location = useLocation();
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  useEffect(() => {
    if (loading || user?.role !== "customer") return undefined;

    const refreshCustomerPermissions = () => {
      if (document.visibilityState !== "visible") return;
      refreshUser().catch((error) => console.warn("Unable to refresh customer permissions", error));
    };
    refreshCustomerPermissions();
    const intervalId = window.setInterval(refreshCustomerPermissions, 30000);
    window.addEventListener("focus", refreshCustomerPermissions);
    document.addEventListener("visibilitychange", refreshCustomerPermissions);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshCustomerPermissions);
      document.removeEventListener("visibilitychange", refreshCustomerPermissions);
    };
  }, [loading, refreshUser, user?.id, user?.role]);

  const accountPermissions = {
    can_request_orders: true,
    can_estimate_pricing: true,
    view_only_access: false,
    can_track_products: true,
    can_upload_feedback: true,
    show_ratings_homepage: true,
    ...(user?.access_permissions || {}),
  };
  const canRequestOrders = !maintenanceMode && accountPermissions.can_request_orders && !accountPermissions.view_only_access;
  const canEstimatePricing = !maintenanceMode && accountPermissions.can_estimate_pricing && !accountPermissions.view_only_access;
  const canTrackProducts = !maintenanceMode && accountPermissions.can_track_products && !accountPermissions.view_only_access;
  const canUploadFeedback = !maintenanceMode && accountPermissions.can_upload_feedback && !accountPermissions.view_only_access;
  const canShowRatings = accountPermissions.show_ratings_homepage && !accountPermissions.view_only_access;
  const isProductModalReadOnly = !canRequestOrders && !canEstimatePricing;

  const [activeTab, setActiveTab] = useState("home");
  useEffect(() => {
    if (!canRequestOrders && activeTab === "cart") setActiveTab("home");
  }, [activeTab, canRequestOrders]);

  const [darkMode, setDarkMode] = useState(() => {
    try {
      return localStorage.getItem(CUSTOMER_DARK_MODE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [products, setProducts] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [productPage, setProductPage] = useState(1);
  const [productsPerPage, setProductsPerPage] = useState(8);
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [productError, setProductError] = useState("");
  const [featuredProducts, setFeaturedProducts] = useState([]);
  const [featuredProductsLoading, setFeaturedProductsLoading] = useState(false);
  const [featuredProductsError, setFeaturedProductsError] = useState("");
  const [featuredRatingStats, setFeaturedRatingStats] = useState({
    average: 0,
    total: 0,
    counts: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
  });

  const [cartItems, setCartItems] = useState([]);
  const [cartLoaded, setCartLoaded] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedProductImageIndex, setSelectedProductImageIndex] = useState(0);
  const [productEstimatorForm, setProductEstimatorForm] = useState({ unit: "in", width: "0", height: "0" });
  const [showAboutProduct, setShowAboutProduct] = useState(false);
  const [showCartDecisionModal, setShowCartDecisionModal] = useState(false);
  const [cartDecisionStep, setCartDecisionStep] = useState("choice");
  const [cartDecisionProduct, setCartDecisionProduct] = useState(null);
  const [estimateForm, setEstimateForm] = useState({
    unit: "in",
    width: "",
    height: "",
    quantity: 1,
    notes: "",
  });
  const [estimateFormErrors, setEstimateFormErrors] = useState({});
  const [cartActionError, setCartActionError] = useState("");
  const [batchOrderForm, setBatchOrderForm] = useState({
    phone: "",
    shipping_address: "",
    notes: "",
  });

  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [productReviews, setProductReviews] = useState([]);
  const [productReviewsLoading, setProductReviewsLoading] = useState(false);
  const [productReviewStats, setProductReviewStats] = useState({});

  const toggleDarkMode = () => {
    const nextDarkMode = !darkMode;
    setDarkMode(nextDarkMode);
    toast.success(`${nextDarkMode ? "Dark" : "Light"} mode activated`, {
      id: "customer-theme-mode",
    });
    try {
      localStorage.setItem(CUSTOMER_DARK_MODE_KEY, String(nextDarkMode));
    } catch {
      // Keep the current session theme if storage is unavailable.
    }
  };

  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutMessage, setCheckoutMessage] = useState("");
  const [checkoutError, setCheckoutError] = useState("");
  const [orderRequestMessage, setOrderRequestMessage] = useState("");
  const [orderRequestLoading, setOrderRequestLoading] = useState(false);
  const [contractActionLoading, setContractActionLoading] = useState(false);
  const [contractActionError, setContractActionError] = useState("");
  const [contractActionMessage, setContractActionMessage] = useState("");
  const [contractActionOrderId, setContractActionOrderId] = useState(null);
  const [showContractModal, setShowContractModal] = useState(false);
  const [contractPreviewOrder, setContractPreviewOrder] = useState(null);
  const autoOpenedContractRef = useRef("");
  const [contractConfirmModal, setContractConfirmModal] = useState({
    open: false,
    action: null,
    orderId: null,
  });
  const [contractDeclineReason, setContractDeclineReason] = useState("");
  const [showOrderReviewModal, setShowOrderReviewModal] = useState(false);
  const [showBatchOrderModal, setShowBatchOrderModal] = useState(false);
  const [showBatchOrderConfirmModal, setShowBatchOrderConfirmModal] = useState(false);
  const [batchOrderAgreed, setBatchOrderAgreed] = useState(false);
  const [showBatchSuccessModal, setShowBatchSuccessModal] = useState(false);
  const [paymentProofOpenOrderId, setPaymentProofOpenOrderId] = useState(null);
  const [paymentProofForm, setPaymentProofForm] = useState({
    amount: "",
    fileName: "",
  });
  const [paymentProofError, setPaymentProofError] = useState("");
  const [paymentProofLoading, setPaymentProofLoading] = useState(false);
  const [paymentProofSuccessByOrder, setPaymentProofSuccessByOrder] = useState({});
  const [showCustomerReviewModal, setShowCustomerReviewModal] = useState(false);
  const [reviewDetailsOrder, setReviewDetailsOrder] = useState(null);
  const [showProductReviewModal, setShowProductReviewModal] = useState(false);
  const [selectedReviewRatingTab, setSelectedReviewRatingTab] = useState(0);
  const [reviewOrderMode, setReviewOrderMode] = useState("estimate");
  const [orderReviewAgreed, setOrderReviewAgreed] = useState(false);
  const [orderReviewForm, setOrderReviewForm] = useState({
    rating: 0,
    title: "",
    comment: "",
    photos: [],
    photoPreviews: [],
  });
  const [reviewFormError, setReviewFormError] = useState("");
  const [reviewFormLoading, setReviewFormLoading] = useState(false);
  const [selectedReviewOrder, setSelectedReviewOrder] = useState(null);
  const [batchReviewSession, setBatchReviewSession] = useState(null);
  const [estimateFlowType, setEstimateFlowType] = useState(null);
  const [showDeliveryConfirmModal, setShowDeliveryConfirmModal] = useState(false);
  const [deliveryConfirmMode, setDeliveryConfirmMode] = useState("estimate");
  const [deliveryConfirmForm, setDeliveryConfirmForm] = useState({
    phone: "",
    street_address: "",
    city: "",
    province: "",
    zip_code: "",
  });
  const [deliveryConfirmNotes, setDeliveryConfirmNotes] = useState("");
  const [deliveryConfirmError, setDeliveryConfirmError] = useState("");
  const [showOrderNowModal, setShowOrderNowModal] = useState(false);
  const [orderNowProduct, setOrderNowProduct] = useState(null);
  const [orderNowQuantity, setOrderNowQuantity] = useState(1);
  const [showOrderSuccessModal, setShowOrderSuccessModal] = useState(false);
  const [orderSuccessData, setOrderSuccessData] = useState(null);
  const [cancelRequestModal, setCancelRequestModal] = useState({ open: false, order: null });
  const [expandedOrderId, setExpandedOrderId] = useState(null);
  const [highlightedOrderId, setHighlightedOrderId] = useState(null);
  const [orderFilter, setOrderFilter] = useState("all");
  const [orderPage, setOrderPage] = useState(1);
  const [orderViewMode, setOrderViewMode] = useState("view2");
  const [selectedOrderForModal, setSelectedOrderForModal] = useState(null);
  const [contractSummaryExpanded, setContractSummaryExpanded] = useState(true);
  const [contractHistoryTab, setContractHistoryTab] = useState("accepted");
  const [contractPage, setContractPage] = useState(1);
  const [warrantyHistoryTab, setWarrantyHistoryTab] = useState(null);

  const customerContracts = orders.filter((order) => {
    const status = normalizeOrderStatusKey(order?.status);
    const contractStatus = normalizeOrderStatusKey(order?.contract_status);
    return ["contract_sent", "contract_accepted"].includes(status) || ["sent", "accepted"].includes(contractStatus);
  });
  const rejectedContracts = orders.filter((order) => {
    const status = normalizeOrderStatusKey(order?.status);
    const contractStatus = normalizeOrderStatusKey(order?.contract_status);
    return status === "contract_declined" || contractStatus === "declined";
  });
  const contractsInTab = contractHistoryTab === "rejected" ? rejectedContracts : customerContracts;
  const CONTRACT_PAGE_SIZE = 5;
  const contractPageCount = Math.max(1, Math.ceil(contractsInTab.length / CONTRACT_PAGE_SIZE));
  const safeContractPage = Math.min(Math.max(1, contractPage), contractPageCount);
  const paginatedContracts = contractsInTab.slice(
    (safeContractPage - 1) * CONTRACT_PAGE_SIZE,
    safeContractPage * CONTRACT_PAGE_SIZE
  );
  const displayedContracts = isMobile ? contractsInTab : paginatedContracts;

  useEffect(() => {
    setContractPage(1);
  }, [contractHistoryTab, contractsInTab.length]);

  // Expand batch warranties so each product has its own transaction record.
  const warrantyRecords = orders.flatMap((order) => {
    const items = Array.isArray(order.items) ? order.items : [];
    const hasItemWarranties = items.some((item) => (
      item.warranty_start_date || item.warranty_expiry_date || item.warranty_status
    ));
    if (hasItemWarranties) {
      return items
        .filter((item) => item.warranty_status !== "no_warranty" && (item.warranty_start_date || item.warranty_expiry_date || item.warranty_status))
        .map((item, index) => ({
          ...order,
          warranty_record_id: `${order._id || order.id}-item-${index}`,
          items: [item],
          warranty_period: item.warranty_period || order.warranty_period,
          warranty_start_date: item.warranty_start_date || order.warranty_start_date,
          warranty_expiry_date: item.warranty_expiry_date || order.warranty_expiry_date,
          warranty_status: item.warranty_status || order.warranty_status,
        }));
    }
    return order.warranty_expiry_date || order.warranty_status
      ? [{ ...order, warranty_record_id: `${order._id || order.id}-order`, items: [items[0] || {}] }]
      : [];
  });
  const activeWarranties = warrantyRecords.filter((order) => {
    if (!order.warranty_expiry_date) return false;
    const expiryDate = new Date(order.warranty_expiry_date);
    const today = new Date();
    const startDate = order.warranty_start_date ? new Date(order.warranty_start_date) : null;
    return expiryDate > today && (!startDate || startDate <= today) && (order.warranty_status?.toLowerCase() === "active" || !order.warranty_status);
  });
  const expiredWarranties = warrantyRecords.filter((order) => {
    if (!order.warranty_expiry_date) return false;
    const expiryDate = new Date(order.warranty_expiry_date);
    const today = new Date();
    return expiryDate <= today || order.warranty_status?.toLowerCase() === "expired";
  });
  const warrantiesInTab = warrantyHistoryTab === "expired" ? expiredWarranties : activeWarranties;

  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingResult, setTrackingResult] = useState(null);

  const [profileForm, setProfileForm] = useState({
    first_name: "",
    last_name: "",
    phone: "",
    email: "",
    street_address: "",
    city: "",
    province: "",
    zip_code: "",
    current_password: "",
    new_password: "",
    confirm_password: "",
  });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [profileError, setProfileError] = useState("");

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationFilter, setNotificationFilter] = useState("all");
  const [readNotificationIds, setReadNotificationIds] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(CUSTOMER_READ_NOTIFICATIONS_KEY) || "[]"));
    } catch {
      return new Set();
    }
  });
  const [profileTab, setProfileTab] = useState("profile");
  const [profileEditing, setProfileEditing] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordModalError, setPasswordModalError] = useState("");
  const [permissionNotice, setPermissionNotice] = useState(null);
  const [maintenanceCountdown, setMaintenanceCountdown] = useState(10);
  const permissionNoticeTimer = useRef(null);
  const customerNotificationItems = orders.flatMap((order) => {
    const orderId = order._id || order.id || order.tracking;
    const status = normalizeOrderStatusKey(order?.status);
    const contractStatus = normalizeOrderStatusKey(order?.contract_status);
    const hasPendingContractNotification = status === "contract_sent" || contractStatus === "sent";
    const contractVersion = order.contractVersion || order.currentContractVersion || order.contractId || order.contract_number || "current";
    const notifications = [{
      ...order,
      notificationType: hasPendingContractNotification ? "contract" : "order",
      notificationId: hasPendingContractNotification ? `${orderId}-contract-${contractVersion}` : orderId,
      notificationDate: hasPendingContractNotification
        ? order.contractSentAt || order.contractGeneratedAt || order.updatedAt || order.createdAt
        : order.updatedAt || order.createdAt,
    }];

    if (order.payment_proof_submitted_at) {
      notifications.unshift({
        ...order,
        notificationType: "payment",
        notificationId: `${orderId}-payment-${new Date(order.payment_proof_submitted_at).getTime()}`,
        notificationDate: order.payment_proof_submitted_at,
      });

      if (order.payment_proof_confirmed_at) {
        notifications.unshift({
          ...order,
          notificationType: "payment_confirmed",
          notificationId: `${orderId}-payment-confirmed-${new Date(order.payment_proof_confirmed_at).getTime()}`,
          notificationDate: order.payment_proof_confirmed_at,
        });
      }
    }

    return [...notifications, ...buildDelayNotifications(order)];
  });
  const unreadNotificationCount = customerNotificationItems.filter((notification) => !readNotificationIds.has(notification.notificationId)).length;
  const readNotificationCount = customerNotificationItems.length - unreadNotificationCount;
  const filteredNotifications = customerNotificationItems.filter((notification) => {
    const isRead = readNotificationIds.has(notification.notificationId);
    return notificationFilter === "all" || (notificationFilter === "unread" ? !isRead : isRead);
  });

  const markAllCustomerNotificationsRead = () => {
    const nextReadNotificationIds = new Set(readNotificationIds);
    customerNotificationItems.forEach((notification) => nextReadNotificationIds.add(notification.notificationId));
    setReadNotificationIds(nextReadNotificationIds);
    localStorage.setItem(CUSTOMER_READ_NOTIFICATIONS_KEY, JSON.stringify([...nextReadNotificationIds]));
  };

  const markCustomerNotificationRead = (notificationId) => {
    if (!notificationId || readNotificationIds.has(notificationId)) return;
    const nextReadNotificationIds = new Set(readNotificationIds);
    nextReadNotificationIds.add(notificationId);
    setReadNotificationIds(nextReadNotificationIds);
    localStorage.setItem(CUSTOMER_READ_NOTIFICATIONS_KEY, JSON.stringify([...nextReadNotificationIds]));
  };

  useEffect(() => {
    getSystemSettings()
      .then((response) => {
        const enabled = response.maintenance_mode === true;
        setMaintenanceMode(enabled);
        if (enabled) showPermissionNotice("The system is under maintenance. Please log out and try again later.", { maintenance: true });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) return undefined;

    let active = true;
    const checkMaintenanceMode = async () => {
      try {
        const response = await getSystemSettings();
        if (!active) return;
        const enabled = response.maintenance_mode === true;
        setMaintenanceMode(enabled);
        if (enabled) {
          showPermissionNotice("The system is under maintenance. Please log out and try again later.", { maintenance: true });
        } else {
          setPermissionNotice((current) => (current?.maintenance ? null : current));
        }
      } catch {}
    };
    const interval = window.setInterval(checkMaintenanceMode, 30_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [user?.id]);

  const showPermissionNotice = (message, options = {}) => {
    if (permissionNoticeTimer.current) {
      clearTimeout(permissionNoticeTimer.current);
    }

    setPermissionNotice((current) => {
      if (current?.maintenance && options.maintenance) return current;
      return { message, maintenance: options.maintenance === true, closing: false };
    });
    if (options.maintenance) {
      setMaintenanceCountdown(10);
      return;
    }

    permissionNoticeTimer.current = setTimeout(() => {
      setPermissionNotice((current) => (current ? { ...current, closing: true } : current));
      permissionNoticeTimer.current = setTimeout(() => setPermissionNotice(null), 350);
    }, 2400);
  };

  useEffect(() => () => {
    if (permissionNoticeTimer.current) clearTimeout(permissionNoticeTimer.current);
  }, []);

  const handleLogoutConfirm = () => {
    logout();
    setConfirmOpen(false);
    navigate("/login");
  };

  useEffect(() => {
    if (!permissionNotice?.maintenance) return undefined;

    setMaintenanceCountdown(5);
    const countdownTimer = setInterval(() => {
      setMaintenanceCountdown((current) => {
        if (current <= 1) {
          clearInterval(countdownTimer);
          handleLogoutConfirm();
          return 0;
        }
        return current - 1;
      });
    }, 1800);

    return () => clearInterval(countdownTimer);
  }, [permissionNotice?.maintenance]);

  useEffect(() => {
    if (user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProfileForm({
        first_name: user.first_name || "",
        last_name: user.last_name || "",
        phone: user.phone || "",
        email: user.email || "",
        street_address: user.street_address || "",
        city: user.city || "",
        province: user.province || "",
        zip_code: user.zip_code || "",
        current_password: "",
        new_password: "",
        confirm_password: "",
      });
      setDeliveryConfirmForm({
        phone: user.phone || "",
        street_address: user.street_address || "",
        city: user.city || "",
        province: user.province || "",
        zip_code: user.zip_code || "",
      });
    }
  }, [user]);

  useEffect(() => {
    if (!loading && user && user.role !== "customer") {
      navigate("/dashboard", { replace: true });
    }
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!user) return undefined;

    let active = true;
    const loadCart = async () => {
      try {
        const response = await getCart();
        if (!active) return;
        setCartItems(
          Array.isArray(response.items)
            ? response.items.map((item) => ({ ...item, selected: item.selected !== false }))
            : []
        );
      } catch (error) {
        if (!active) return;
        const storedCart = localStorage.getItem("customerCart");
        if (storedCart) {
          try {
            const cart = JSON.parse(storedCart);
            setCartItems(
              Array.isArray(cart)
                ? cart.map((item) => ({ ...item, selected: item.selected !== false }))
                : []
            );
          } catch (parseError) {
            console.warn("Unable to parse saved cart", parseError);
          }
        }
        console.warn("Unable to load cart from backend; using local cart fallback.", error);
      } finally {
        if (active) setCartLoaded(true);
      }
    };

    loadCart();
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    const activeTabFromState = location.state?.activeTab;
    const activeTabFromQuery = new URLSearchParams(location.search).get("tab");
    const tab = activeTabFromState || activeTabFromQuery;

    if (tab) {
      setActiveTab(tab);
      if (activeTabFromState) {
        navigate(location.pathname, { replace: true, state: {} });
      }
    }
  }, [location, navigate]);

  useEffect(() => {
    if (!cartLoaded) return;
    localStorage.setItem("customerCart", JSON.stringify(cartItems));

    const saveTimer = setTimeout(() => {
      saveCart(cartItems).catch((error) => {
        console.warn("Unable to save cart to backend.", error);
      });
    }, 250);

    return () => clearTimeout(saveTimer);
  }, [cartItems, cartLoaded]);

  const selectedCartItems = cartItems.filter((item) => item.selected);
  const selectedItemCount = selectedCartItems.length;
  const selectedQuantityTotal = selectedCartItems.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const selectedSubtotal = selectedCartItems.reduce((sum, item) => sum + getItemPriceValue(item), 0);
  const allSelected = cartItems.length > 0 && selectedItemCount === cartItems.length;

  const ratedProductReviews = productReviews.filter((review) => Number(review.rating) > 0);
  const totalRatedReviews = ratedProductReviews.length;

  const productReviewAverageRating = totalRatedReviews
    ? (ratedProductReviews.reduce((sum, review) => sum + Number(review.rating), 0) / totalRatedReviews).toFixed(1)
    : null;

  const averageProductReviewRating = Number(productReviewAverageRating) || 0;

  const reviewRatingCounts = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: ratedProductReviews.filter((review) => Math.round(Number(review.rating)) === star).length,
  }));

  const filteredProductReviews = selectedReviewRatingTab
    ? productReviews.filter((review) => Math.round(Number(review.rating || 0)) === selectedReviewRatingTab)
    : productReviews;

  useEffect(() => {
    if (selectedOrderForModal) {
      const contractStatus = selectedOrderForModal.contract_status?.toLowerCase();
      if (contractStatus === "accepted" || contractStatus === "declined") {
        setContractSummaryExpanded(false);
      } else {
        setContractSummaryExpanded(true);
      }
    }
  }, [selectedOrderForModal]);

  function canShowContractForOrder(order) {
    if (!order) return false;

    const status = normalizeOrderStatusKey(order?.status);
    const contractStatus = normalizeOrderStatusKey(order?.contract_status);
    const contractStageStatus = [
      "contract_sent",
      "contract_accepted",
      "contract_declined",
      "sent",
      "accepted",
      "declined",
    ];

    const hasContractArtifacts = Boolean(
      order.contract_terms ||
      order.contract_amount ||
      order.contract_status ||
      order.contract_number ||
      order.contract_id
    );

    return hasContractArtifacts && (
      contractStageStatus.includes(status) ||
      contractStageStatus.includes(contractStatus)
    );
  }

  const selectedOrderContractStatus = normalizeOrderStatusKey(selectedOrderForModal?.contract_status);
  const selectedOrderStatus = normalizeOrderStatusKey(selectedOrderForModal?.status);
  const selectedOrderHasContractSummary = Boolean(selectedOrderForModal) && canShowContractForOrder(selectedOrderForModal);
  const selectedOrderCanRespondToContract =
    selectedOrderHasContractSummary &&
    (selectedOrderStatus === "contract_sent" || selectedOrderStatus === "site_inspection" || selectedOrderContractStatus === "sent") &&
    !["accepted", "declined"].includes(selectedOrderContractStatus) &&
    !["contract_accepted", "contract_declined", "cancelled"].includes(selectedOrderStatus);

  const isOrderCompletedAndReviewable = (order) => {
    if (!order) return false;
    const status = normalizeOrderStatusKey(order?.status);
    if (["cancelled", "declined", "contract_declined", "rejected"].includes(status)) return false;

    const isStageComplete = (stage) =>
      stage?.completed === true || ["done", "completed"].includes(normalizeOrderStatusKey(stage?.status));
    const orderStages = Array.isArray(order.progress_stages) ? order.progress_stages : [];
    const orderStagesComplete = orderStages.length > 0 && orderStages.every(isStageComplete);
    const orderFieldsComplete = status === "completed" && Number(order.progress) >= 100;
    const batchItems = Array.isArray(order.items) ? order.items : [];
    const batchItemsComplete = batchItems.length > 1 && batchItems.every((item) => {
      const itemStages = Array.isArray(item?.progress_stages) ? item.progress_stages : [];
      return itemStages.length > 0
        ? itemStages.every(isStageComplete)
        : Number(item?.progress) >= 100;
    });

    if (!orderFieldsComplete && !orderStagesComplete && !batchItemsComplete) return false;
    if (orderStagesComplete || batchItemsComplete) return true;

    const lastStage = orderStages[orderStages.length - 1];
    const lastStageStatus = normalizeOrderStatusKey(lastStage?.status);
    if (!lastStage) return true;
    return Boolean(lastStage.completed || lastStageStatus === "done" || lastStageStatus === "completed");
  };

  const isCustomerContractAccepted = (order) => {
    if (!order) return false;
    const status = normalizeOrderStatusKey(order?.status);
    const contractStatus = normalizeOrderStatusKey(order?.contract_status);
    return Boolean(
      order.acceptedByCustomer === true ||
      status === "contract_accepted" ||
      contractStatus === "accepted" ||
      status === "contract_signed" ||
      contractStatus === "signed"
    );
  };

  const getOrderItemReview = (order, itemIndex) => {
    if (!order || !Array.isArray(order.items)) return null;
    if (order.items.length > 1) return order.items[itemIndex]?.review || null;
    return order.review || order.items[itemIndex]?.review || null;
  };

  const getReviewForOrderContext = (order) => (
    Number.isInteger(order?.reviewItemIndex)
      ? getOrderItemReview(order, order.reviewItemIndex)
      : order?.review
  );

  const isOrderReviewEditable = (order, itemIndex = null) => {
    const review = Number.isInteger(itemIndex)
      ? getOrderItemReview(order, itemIndex)
      : getReviewForOrderContext(order);
    if (!review?.submittedAt) return false;
    const submittedAt = new Date(review.submittedAt);
    const editDeadline = new Date(submittedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
    return new Date() <= editDeadline;
  };

  const hasOrderReview = (order) => {
    if (Number.isInteger(order?.reviewItemIndex)) {
      return Boolean(getOrderItemReview(order, order.reviewItemIndex)?.submittedAt);
    }
    if (Array.isArray(order?.items) && order.items.length > 1) {
      return order.items.every((_, index) => Boolean(getOrderItemReview(order, index)?.submittedAt));
    }
    return Boolean(order?.review?.submittedAt);
  };

  const hasAnyOrderReview = (order) => Boolean(
    order?.review?.submittedAt ||
    (Array.isArray(order?.items) && order.items.some((_, index) => getOrderItemReview(order, index)?.submittedAt))
  );

  const openCustomerReviewModal = (order, itemIndex = null) => {
    if (!canUploadFeedback) {
      showPermissionNotice("Feedback access is disabled for your account.");
      return;
    }
    const reviewItemIndex = Array.isArray(order?.items) && order.items.length > 1
      ? itemIndex
      : null;
    const existingReview = Number.isInteger(reviewItemIndex)
      ? getOrderItemReview(order, reviewItemIndex) || {}
      : order?.review || {};
    setSelectedReviewOrder({
      ...order,
      reviewItemIndex,
      reviewProductName: Number.isInteger(reviewItemIndex)
        ? order.items[reviewItemIndex]?.name || order.items[reviewItemIndex]?.product_name || "Product"
        : order.items?.[0]?.name || order.items?.[0]?.product_name || "Project",
    });
    setOrderReviewForm({
      rating: existingReview.rating || 0,
      title: existingReview.title || "",
      comment: existingReview.comment || "",
      photos: existingReview.photos || [],
      photoPreviews: existingReview.photos || [],
    });
    setReviewFormError("");
    setShowCustomerReviewModal(true);
  };

  const openBatchOrderReviewModal = (order) => {
    if (!canUploadFeedback) {
      showPermissionNotice("Feedback access is disabled for your account.");
      return;
    }
    const itemIndexes = (order.items || []).flatMap((_, index) =>
      getOrderItemReview(order, index)?.submittedAt ? [] : [index]
    );
    if (!itemIndexes.length) return;

    setBatchReviewSession({ itemIndexes, currentPosition: 0 });
    openCustomerReviewModal(order, itemIndexes[0]);
  };

  const openOrderReviewDetails = (order, itemIndex = null) => {
    const reviewItemIndex = Array.isArray(order?.items) && order.items.length > 1
      ? itemIndex
      : null;
    const review = Number.isInteger(reviewItemIndex)
      ? getOrderItemReview(order, reviewItemIndex)
      : order?.review || order?.items?.[0]?.review;
    if (!review?.submittedAt) return;

    setReviewDetailsOrder({
      ...order,
      review,
      reviewItemIndex,
      reviewProductName: Number.isInteger(reviewItemIndex)
        ? order.items[reviewItemIndex]?.name || order.items[reviewItemIndex]?.product_name || `Product ${reviewItemIndex + 1}`
        : order.items?.[0]?.name || order.items?.[0]?.product_name || "Project",
    });
  };

  const closeCustomerReviewModal = () => {
    setSelectedReviewOrder(null);
    setBatchReviewSession(null);
    setShowCustomerReviewModal(false);
    setReviewFormError("");
    setOrderReviewForm({ rating: 0, title: "", comment: "", photos: [], photoPreviews: [] });
  };

  const openProductReviewModal = () => {
    if (!canUploadFeedback) {
      showPermissionNotice("Feedback access is disabled for your account.");
      return;
    }
    setShowProductReviewModal(true);
  };

  const closeProductReviewModal = () => {
    setShowProductReviewModal(false);
  };

  const handleOrderReviewChange = (field, value) => {
    setOrderReviewForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleOrderReviewPhotoChange = async (e) => {
    if (!canUploadFeedback) return;
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const existingCount = orderReviewForm.photos.length;
    if (existingCount + files.length > 5) {
      setReviewFormError("You may upload up to 5 photos.");
      return;
    }
    const uploads = await uploadFiles(files, undefined, { purpose: "review-photos" });
    if (!uploads.success) {
      setReviewFormError(uploads.message || "Unable to upload photos.");
      return;
    }
    setOrderReviewForm((prev) => ({
      ...prev,
      photos: [...prev.photos, ...(uploads.files || []).map((f) => f.url)],
      photoPreviews: [...prev.photoPreviews, ...(uploads.files || []).map((f) => f.url)],
    }));
  };

  const handleRemoveReviewPhoto = (index) => {
    setOrderReviewForm((prev) => ({
      ...prev,
      photos: prev.photos.filter((_, i) => i !== index),
      photoPreviews: prev.photoPreviews.filter((_, i) => i !== index),
    }));
  };

  const submitCustomerReview = async () => {
    if (!canUploadFeedback) return;
    if (!selectedReviewOrder) return;
    if (!orderReviewForm.rating || orderReviewForm.rating < 1 || orderReviewForm.rating > 5) {
      setReviewFormError("Please select a rating from 1 to 5.");
      return;
    }
    if (!orderReviewForm.comment || orderReviewForm.comment.trim().length < 10) {
      setReviewFormError("Comment must be at least 10 characters.");
      return;
    }
    if (orderReviewForm.comment.trim().length > 500) {
      setReviewFormError("Comment cannot exceed 500 characters.");
      return;
    }

    setReviewFormLoading(true);
    setReviewFormError("");

    try {
      const payload = {
        rating: orderReviewForm.rating,
        title: orderReviewForm.title.trim(),
        comment: orderReviewForm.comment.trim(),
        photos: orderReviewForm.photos.slice(0, 5),
        ...(Number.isInteger(selectedReviewOrder.reviewItemIndex)
          ? { itemIndex: selectedReviewOrder.reviewItemIndex }
          : {}),
      };
      const response = await submitOrderReview(selectedReviewOrder._id || selectedReviewOrder.id, payload);
      if (response.order) {
        setOrders((prev) => prev.map((order) => (order._id === response.order._id ? response.order : order)));
        if (selectedOrderForModal && (selectedOrderForModal._id || selectedOrderForModal.id) === response.order._id) {
          setSelectedOrderForModal(response.order);
        }

        const nextItemIndex = batchReviewSession?.itemIndexes?.[batchReviewSession.currentPosition + 1];
        if (Number.isInteger(nextItemIndex)) {
          const nextItem = response.order.items[nextItemIndex];
          const nextReview = getOrderItemReview(response.order, nextItemIndex) || {};
          setBatchReviewSession((current) => current ? {
            ...current,
            currentPosition: current.currentPosition + 1,
          } : null);
          setSelectedReviewOrder({
            ...response.order,
            reviewItemIndex: nextItemIndex,
            reviewProductName: nextItem?.name || nextItem?.product_name || "Product",
          });
          setOrderReviewForm({
            rating: nextReview.rating || 0,
            title: nextReview.title || "",
            comment: nextReview.comment || "",
            photos: nextReview.photos || [],
            photoPreviews: nextReview.photos || [],
          });
          toast.success("Review saved. Continue with the next product.");
          return;
        }

        setBatchReviewSession(null);
        setSelectedReviewOrder(response.order);
        toast.success("Thank you for your feedback. Your review has been submitted.");
        closeCustomerReviewModal();
      }
    } catch (error) {
      setReviewFormError(error.data?.message || error.message || "Unable to submit review.");
    } finally {
      setReviewFormLoading(false);
    }
  };

  useEffect(() => {
    let active = true;

    const fetchFeaturedProducts = async () => {
      setFeaturedProductsLoading(true);
      setFeaturedProductsError("");

      try {
        let response = await getProducts({ featured: true });
        let productsList = response.products || [];

        if (!productsList.length) {
          const fallbackResponse = await getProducts();
          productsList = fallbackResponse.products || [];
        }

        const eligibleProducts = productsList.filter((product) => product.is_active !== false);

        if (!canUploadFeedback) {
          setFeaturedRatingStats({ average: 0, total: 0, counts: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 } });
          setFeaturedProducts(eligibleProducts.slice(0, 3));
          return;
        }

        const productReviewData = await Promise.all(
          eligibleProducts.map(async (product) => {
            try {
              const reviewResponse = await getProductReviews(product._id || product.id);
              const reviews = Array.isArray(reviewResponse.reviews) ? reviewResponse.reviews : [];
              const ratedReviews = reviews.filter((review) => Number(review.rating) > 0);
              const averageRating = ratedReviews.length
                ? ratedReviews.reduce((sum, review) => sum + Number(review.rating), 0) / ratedReviews.length
                : 0;

              return {
                product,
                averageRating,
                ratingsCount: ratedReviews.length,
                ratingCounts: [5, 4, 3, 2, 1].reduce((counts, star) => {
                  counts[star] = ratedReviews.filter((review) => Math.round(Number(review.rating)) === star).length;
                  return counts;
                }, {}),
              };
            } catch (error) {
              return {
                product,
                averageRating: 0,
                ratingsCount: 0,
                ratingCounts: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
              };
            }
          })
        );

        const totalFeaturedRatings = productReviewData.reduce((sum, entry) => sum + entry.ratingsCount, 0);
        const featuredRatingCounts = productReviewData.reduce((counts, entry) => {
          [5, 4, 3, 2, 1].forEach((star) => {
            counts[star] += entry.ratingCounts?.[star] || 0;
          });
          return counts;
        }, { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 });
        const featuredRatingTotal = [5, 4, 3, 2, 1].reduce(
          (sum, star) => sum + featuredRatingCounts[star] * star,
          0
        );

        setFeaturedRatingStats({
          average: totalFeaturedRatings ? featuredRatingTotal / totalFeaturedRatings : 0,
          total: totalFeaturedRatings,
          counts: featuredRatingCounts,
        });

        const sortedProducts = productReviewData
          .sort((a, b) => {
            if (b.averageRating !== a.averageRating) return b.averageRating - a.averageRating;
            return b.ratingsCount - a.ratingsCount;
          })
          .map((entry) => entry.product)
          .slice(0, 3);

        if (!active) return;
        setFeaturedProducts(sortedProducts);
      } catch (error) {
        if (!active) return;
        setFeaturedProducts([]);
        setFeaturedRatingStats({ average: 0, total: 0, counts: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 } });
        setFeaturedProductsError(error.data?.message || error.message || "Unable to load featured products.");
      } finally {
        if (active) setFeaturedProductsLoading(false);
      }
    };

    fetchFeaturedProducts();

    return () => {
      active = false;
    };
  }, [canUploadFeedback]);

  useEffect(() => {
    setProductPage(1);
  }, [searchQuery, categoryFilter, productsPerPage]);

  useEffect(() => {
    let active = true;

    const fetchProducts = async () => {
      setIsLoadingProducts(true);
      setProductError("");

      try {
        const response = await getProducts({
          search: searchQuery,
          category: categoryFilter && categoryFilter !== "All" ? categoryFilter : undefined,
        });
        if (!active) return;

        const productsList = (response.products || []).sort(
          (firstProduct, secondProduct) => Number(Boolean(secondProduct.is_featured)) - Number(Boolean(firstProduct.is_featured)),
        );
        setProducts(productsList);

        if (!canUploadFeedback) {
          setProductReviewStats({});
          return;
        }

        const stats = {};
        await Promise.all(
          productsList.slice(0, 12).map(async (product) => {
            try {
              const reviewResponse = await getProductReviews(product._id || product.id);
              const reviews = Array.isArray(reviewResponse.reviews) ? reviewResponse.reviews : [];
              const rated = reviews.filter((review) => Number(review.rating) > 0);
              const average = rated.length
                ? (rated.reduce((sum, review) => sum + Number(review.rating), 0) / rated.length).toFixed(1)
                : null;
              stats[product._id || product.id] = {
                averageRating: Number(average) || 0,
                ratingsCount: rated.length,
              };
            } catch (error) {
              stats[product._id || product.id] = {
                averageRating: 0,
                ratingsCount: 0,
              };
            }
          })
        );

        if (active) {
          setProductReviewStats(stats);
        }
      } catch (error) {
        if (!active) return;
        setProductError(error.data?.message || error.message || "Unable to load products.");
      } finally {
        if (active) setIsLoadingProducts(false);
      }
    };

    fetchProducts();

    return () => {
      active = false;
    };
  }, [searchQuery, categoryFilter, canUploadFeedback]);

  const paginatedProducts = paginateItems(products, productPage, productsPerPage);
  const displayedProducts = isMobile ? products : paginatedProducts.items;

  useEffect(() => {
    if (!orderOwnerId) return;
    let active = true;

    const fetchOrders = async (showLoading = true) => {
      if (showLoading) setOrdersLoading(true);

      try {
        const response = await getOrders();
        if (!active) return;
        setOrders(response.orders || []);
      } catch {
        if (!active) return;
      } finally {
        if (active && showLoading) setOrdersLoading(false);
      }
    };

    fetchOrders();
    const refreshInterval = window.setInterval(() => fetchOrders(false), 30000);

    return () => {
      active = false;
      window.clearInterval(refreshInterval);
    };
  }, [orderOwnerId]);

  useEffect(() => {
    const orderId = new URLSearchParams(location.search).get("orderId");
    if (!orderId || ordersLoading || !orders.length || autoOpenedContractRef.current === orderId) return;

    const order = orders.find((candidate) => String(candidate._id || candidate.id) === String(orderId));
    if (!order || !canShowContractForOrder(order)) return;

    autoOpenedContractRef.current = orderId;
    setActiveTab("contracts");
    openContractModal(order);
    navigate(`${location.pathname}?tab=contracts`, { replace: true });
  }, [location.pathname, location.search, navigate, orders, ordersLoading]);

  useEffect(() => {
    if (!selectedProduct?._id || !canUploadFeedback) {
      setProductReviews([]);
      return;
    }

    let active = true;
    const fetchProductReviews = async () => {
      setProductReviewsLoading(true);
      try {
        const response = await getProductReviews(selectedProduct._id);
        if (!active) return;
        setProductReviews(response.reviews || []);
      } catch {
        if (!active) return;
        setProductReviews([]);
      } finally {
        if (active) setProductReviewsLoading(false);
      }
    };

    fetchProductReviews();

    return () => {
      active = false;
    };
  }, [selectedProduct, canUploadFeedback]);

  const generateCartId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const parseProductDimensionText = (value) => {
    if (!value) return {};
    const text = String(value);
    const match = text.match(/(\d+(?:\.\d+)?)\s*(?:x|×|by)\s*(\d+(?:\.\d+)?)/i);
    const unitMatch = text.match(/\b(cm|mm|m|ft|in|inch|inches|feet|meter|meters)\b|"/i);
    const unitMap = {
      inch: "in",
      inches: "in",
      feet: "ft",
      meter: "m",
      meters: "m",
    };

    return {
      width: match ? Number(match[1]) : 0,
      height: match ? Number(match[2]) : 0,
      unit: unitMatch ? unitMap[unitMatch[1]?.toLowerCase()] || unitMatch[1]?.toLowerCase() || "in" : "in",
    };
  };

  const getProductDefaultDimensions = (product, quantity = 1) => {
    const parsed = parseProductDimensionText(product?.dimensions || product?.standard_size || product?.size);
    const width = Number(product?.width) > 0 ? Number(product.width) : Number(parsed.width) || 0;
    const height = Number(product?.height) > 0 ? Number(product.height) : Number(parsed.height) || 0;
    const unit = product?.measurement_unit || product?.measurementUnit || parsed.unit || "in";

    return {
      width,
      height,
      unit,
      quantity: Math.max(1, Number(quantity) || 1),
      customized: false,
    };
  };

  const buildOrderItemDimensions = ({ product, width, height, unit, quantity, customized = false }) => {
    const defaultDimensions = getProductDefaultDimensions(product, quantity);
    const useCustomized = customized || Number(width) > 0 || Number(height) > 0;
    const dimensions = useCustomized
      ? {
          width: Number(width) || 0,
          height: Number(height) || 0,
          unit: unit || defaultDimensions.unit || "in",
          quantity: Math.max(1, Number(quantity) || 1),
          customized: true,
        }
      : defaultDimensions;

    return dimensions;
  };

  const areOrderItemDimensionsValid = (dimensions) =>
    Number(dimensions?.width) > 0 &&
    Number(dimensions?.height) > 0 &&
    Number(dimensions?.quantity) > 0 &&
    Boolean(dimensions?.unit);

  const getOrderItemDimensionText = (itemOrDimensions) => {
    const dimensions = itemOrDimensions?.dimensions || itemOrDimensions || {};
    if (!areOrderItemDimensionsValid(dimensions)) return "—";
    return `${dimensions.width} ${dimensions.unit} × ${dimensions.height} ${dimensions.unit}`;
  };

  const buildCustomerOrderItem = (product, options = {}) => {
    const quantity = Math.max(1, Number(options.quantity) || 1);
    const dimensions = buildOrderItemDimensions({
      product,
      width: options.width,
      height: options.height,
      unit: options.measurementUnit || options.unit,
      quantity,
      customized: Boolean(options.customized),
    });

    const orderItem = {
      ...product,
      _id: product?._id,
      product_id: product?._id,
      name: product?.name || product?.product_name || "Product",
      quantity,
      unit: product?.unit || "piece",
      category: product?.category || "",
      product_type: product?.product_type || "",
      width: dimensions.width,
      height: dimensions.height,
      measurementUnit: dimensions.unit,
      measurement_unit: dimensions.unit,
      dimensions,
      customized: dimensions.customized,
      area: Number(options.area) || 0,
      notes: options.notes || "",
      estimated_price: Number(options.estimated_price) || 0,
      is_estimate: Boolean(options.is_estimate || dimensions.customized),
    };
    return {
      ...orderItem,
      ...buildProductPriceSnapshot(product || {}, orderItem),
    };
  };

  const handleAddToCart = (product) => {
    if (!canRequestOrders) {
      setCartActionError("Order requests are disabled for your account.");
      return;
    }
    const cartItem = buildCustomerOrderItem(product, { quantity: 1 });
    if (!areOrderItemDimensionsValid(cartItem.dimensions)) {
      setCartActionError("Please provide valid product dimensions before submitting your order.");
      return;
    }

    setCartItems((prev) => {
      const existing = prev.find((p) => !p.is_estimate && (p._id === product._id || p.name === product.name));
      if (existing) {
        return prev.map((p) =>
          p.cartId === existing.cartId
            ? {
                ...p,
                quantity: p.quantity + 1,
                dimensions: {
                  ...(p.dimensions || {}),
                  quantity: p.quantity + 1,
                },
                selected: true,
              }
            : p
        );
      }

      return [...prev, { ...cartItem, cartId: generateCartId(), selected: true }];
    });

    toast.success("Product added to cart.");
  };

  const handleAddEstimateToCart = ({ product, width, height, quantity, notes, measurementUnit }) => {
    if (!canRequestOrders) {
      setCartActionError("Order requests are disabled for your account.");
      return;
    }
    if (!canEstimatePricing) {
      setCartActionError("Pricing estimates are disabled for your account.");
      return;
    }
    const parsedWidth = Number(width) || 0;
    const parsedHeight = Number(height) || 0;
    const parsedQuantity = Number(quantity) || 1;
    
    const estimationResult = calculateEstimate({
      productName: product.product_name || product.name,
      categoryKey: product.product_type || product.category,
      variantName: product.variant,
      width: parsedWidth,
      height: parsedHeight,
      measurementUnit,
      quantity: parsedQuantity,
      blade_count: product.blade_count || 0,
      base_price: product.base_price || undefined,
      overrideRate: getProductEstimateRate(product),
      customization: product.customization || false,
      customization_fee: product.customization_fee || 0,
    });
    
    const area = estimationResult.estimated_area || 0;
    const estimated_price = getProductLineTotal(product, {
      width: parsedWidth,
      height: parsedHeight,
      measurement_unit: measurementUnit,
      quantity: parsedQuantity,
      customized: true,
    }) || estimationResult.estimated_price || 0;

    setCartItems((prev) => [
      ...prev,
      {
        ...buildCustomerOrderItem(product, {
          quantity: parsedQuantity,
          width: parsedWidth,
          height: parsedHeight,
          measurementUnit,
          customized: true,
          area,
          notes,
          estimated_price,
          is_estimate: true,
        }),
        cartId: generateCartId(),
        selected: true,
      },
    ]);

    toast.success("Estimate added to cart.");
  };

  const openCartDecisionModal = (product, step = "choice") => {
    if (step === "estimate" && !canEstimatePricing) {
      showPermissionNotice("Pricing estimates are disabled for your account.");
      return;
    }
    if (step !== "estimate" && !canRequestOrders) {
      showPermissionNotice("Order requests are disabled for your account.");
      return;
    }
    setCartDecisionProduct(product);
    setCartDecisionStep(step);
    setShowCartDecisionModal(true);
    setEstimateForm({ unit: "in", width: "", height: "", quantity: 1, notes: "" });
    setEstimateFormErrors({});
    setCartActionError("");
    setEstimateFlowType(step === "estimate" ? "estimate_product" : null);
  };

  const closeCartDecisionModal = () => {
    setShowCartDecisionModal(false);
    setCartDecisionProduct(null);
    setCartDecisionStep("choice");
    setCartActionError("");
    setEstimateFlowType(null);
  };

  const handleCartDecisionNoAdd = () => {
    if (!cartDecisionProduct) return;
    handleAddToCart(cartDecisionProduct);
    closeCartDecisionModal();
  };

  const handleCartDecisionEstimate = () => {
    setCartDecisionStep("estimate");
    setEstimateFlowType("add_to_cart_estimate");
  };

  const handleEstimateFormChange = (e) => {
    const { name, value } = e.target;
    setEstimateForm((prev) => ({ ...prev, [name]: value }));

    if (name === 'width' || name === 'height') {
      const numeric = Number(value);
      setEstimateFormErrors((prev) => ({
        ...prev,
        [name]: numeric <= 0 || Number.isNaN(numeric) ? `${name === 'width' ? 'Width' : 'Height'} must be greater than 0.` : undefined,
      }));
    }
  };

  const handleEstimateAddToCart = () => {
    if (!cartDecisionProduct) return;
    if (!estimateForm.width || !estimateForm.height) {
      setCartActionError("Please enter width and height to estimate.");
      return;
    }
    if (Number(estimateForm.width) <= 0 || Number(estimateForm.height) <= 0) {
      setCartActionError("Width and height must be greater than 0.");
      return;
    }
    if (estimateForm.quantity < 1) {
      setCartActionError("Quantity must be at least 1.");
      return;
    }

    handleAddEstimateToCart({
      product: cartDecisionProduct,
      width: estimateForm.width,
      height: estimateForm.height,
      quantity: estimateForm.quantity,
      notes: estimateForm.notes,
      measurementUnit: estimateForm.unit,
    });
    closeCartDecisionModal();
  };

  const openOrderReviewModal = () => {
    if (!canRequestOrders) {
      setCartActionError("Order requests are disabled for your account.");
      return;
    }
    if (!cartDecisionProduct) return;
    if (!estimateForm.width || !estimateForm.height) {
      setCartActionError("Please enter width and height to estimate.");
      return;
    }
    if (Number(estimateForm.quantity) < 1) {
      setCartActionError("Quantity must be at least 1.");
      return;
    }

    setCartActionError("");
    setOrderReviewAgreed(false);
    setShowOrderReviewModal(true);
  };

  const handleEstimateAfterEstimation = () => {
    if (!canRequestOrders) {
      setCartActionError("Your estimate is ready, but order requests are disabled for your account.");
      return;
    }
    if (!estimateForm.width || !estimateForm.height) {
      setCartActionError("Please enter width and height to request an order.");
      return;
    }
    if (Number(estimateForm.width) <= 0 || Number(estimateForm.height) <= 0) {
      setCartActionError("Width and height must be greater than 0.");
      return;
    }
    if (estimateFlowType === "add_to_cart_estimate") {
      handleEstimateAddToCart();
    } else {
      setDeliveryConfirmMode("estimate");
      setDeliveryConfirmForm({
        phone: profileForm.phone || "",
        street_address: profileForm.street_address || "",
        city: profileForm.city || "",
        province: profileForm.province || "",
        zip_code: profileForm.zip_code || "",
      });
      setDeliveryConfirmError("");
      setShowDeliveryConfirmModal(true);
      setShowCartDecisionModal(false);
    }
  };

  const saveProfileDeliveryInfo = async () => {
    try {
      const payload = {
        phone: deliveryConfirmForm.phone || profileForm.phone || "",
        street_address: deliveryConfirmForm.street_address || profileForm.street_address || "",
        city: deliveryConfirmForm.city || profileForm.city || "",
        province: deliveryConfirmForm.province || profileForm.province || "",
        zip_code: deliveryConfirmForm.zip_code || profileForm.zip_code || "",
      };

      await updateProfile(payload);
      setProfileForm((prev) => ({ ...prev, ...payload }));
    } catch (error) {
      console.error("Failed to update profile delivery info", error);
    }
  };

  const validateDeliveryConfirmForm = () => {
    if (!deliveryConfirmForm.street_address.trim() || !deliveryConfirmForm.phone.trim()) {
      setDeliveryConfirmError("Please complete your delivery information before proceeding.");
      return false;
    }
    setDeliveryConfirmError("");
    return true;
  };

  const handleConfirmAndContinue = async () => {
    if (!validateDeliveryConfirmForm()) return;
    setOrderRequestLoading(true);

    try {
      await saveProfileDeliveryInfo();
      setShowDeliveryConfirmModal(false);
      setReviewOrderMode(deliveryConfirmMode);
      setOrderReviewAgreed(false);
      setShowOrderReviewModal(true);
    } catch (error) {
      setDeliveryConfirmError("Unable to save delivery information. Please try again.");
    } finally {
      setOrderRequestLoading(false);
    }
  };

  const addCreatedOrderToMyOrders = (createdOrder) => {
    if (!createdOrder) return;

    const createdOrderId = createdOrder._id || createdOrder.id || createdOrder.tracking;
    setOrders((prev = []) => {
      const existingIndex = prev.findIndex(
        (order) => (order._id || order.id || order.tracking) === createdOrderId
      );

      if (existingIndex >= 0) {
        const next = [...prev];
        next[existingIndex] = createdOrder;
        return next;
      }

      return [createdOrder, ...prev];
    });
    setOrderFilter("all");
    setTrackingNumber("");
    setTrackingResult(null);
  };

  const handleSubmitOrderRequest = async () => {
    if (!orderReviewAgreed) {
      setCartActionError("Please confirm the payment policy before submitting.");
      return;
    }

    setCartActionError("");
    setOrderRequestLoading(true);

    try {
      if (reviewOrderMode === "orderNow") {
        await handleSubmitOrderNow();
      } else {
        if (!cartDecisionProduct) return;

        const parsedWidth = Number(estimateForm.width) || 0;
        const parsedHeight = Number(estimateForm.height) || 0;
        const parsedQuantity = Number(estimateForm.quantity) || 1;

        const estimationResult = calculateEstimate({
          productName: cartDecisionProduct.product_name || cartDecisionProduct.name,
          categoryKey: cartDecisionProduct.product_type || cartDecisionProduct.category,
          variantName: cartDecisionProduct.variant,
          width: parsedWidth,
          height: parsedHeight,
          measurementUnit: estimateForm.unit,
          quantity: parsedQuantity,
          blade_count: cartDecisionProduct.blade_count || 0,
          base_price: cartDecisionProduct.base_price || undefined,
          overrideRate: getProductEstimateRate(cartDecisionProduct),
          customization: cartDecisionProduct.customization || false,
          customization_fee: cartDecisionProduct.customization_fee || 0,
        });

        const estimatedPrice = getProductLineTotal(cartDecisionProduct, {
          width: parsedWidth,
          height: parsedHeight,
          measurement_unit: estimateForm.unit,
          quantity: parsedQuantity,
          customized: true,
        }) || estimationResult.estimated_price || 0;
        const item = buildCustomerOrderItem(cartDecisionProduct, {
          quantity: parsedQuantity,
          width: parsedWidth,
          height: parsedHeight,
          measurementUnit: estimateForm.unit,
          customized: true,
          area: estimationResult.estimated_area || 0,
          estimated_price: estimatedPrice,
          notes: estimateForm.notes || "",
          is_estimate: true,
        });

        if (!areOrderItemDimensionsValid(item.dimensions)) {
          setCartActionError("Please provide valid product dimensions before submitting your order.");
          return;
        }

        const response = await createOrder({
          items: [item],
          shipping_address: normalizeAddress(
            [deliveryConfirmForm.street_address, deliveryConfirmForm.city, deliveryConfirmForm.province, deliveryConfirmForm.zip_code]
              .filter(Boolean)
              .join(", ") || buildFullAddress(user)
          ),
          order_type: "online_order",
        });

        setOrderRequestMessage(getOrderSubmissionMessage(response, "Order requested"));
        addCreatedOrderToMyOrders(response.order);
        setOrderSuccessData(response.order);
      }

      setOrderReviewAgreed(false);
      setShowOrderReviewModal(false);
      setShowOrderNowModal(false);
      setShowOrderSuccessModal(true);
      closeCartDecisionModal();
    } catch (error) {
      setCartActionError(error.data?.message || error.message || "Unable to request order.");
    } finally {
      setOrderRequestLoading(false);
    }
  };

  const updateLocalOrder = (updatedOrder) => {
    const updatedOrderId = updatedOrder?._id || updatedOrder?.id;
    if (!updatedOrderId) return;

    setOrders((prev) =>
      prev.map((order) =>
        (order._id || order.id) === updatedOrderId ? updatedOrder : order
      )
    );
    if ((selectedOrderForModal?._id || selectedOrderForModal?.id) === updatedOrderId) {
      setSelectedOrderForModal(updatedOrder);
    }
    if ((contractPreviewOrder?._id || contractPreviewOrder?.id) === updatedOrderId) {
      setContractPreviewOrder(updatedOrder);
    }
  };

  const handleOrderUpdate = (updatedOrder) => {
    updateLocalOrder(updatedOrder);
    if ((selectedOrderForModal?._id || selectedOrderForModal?.id) === (updatedOrder?._id || updatedOrder?.id)) {
      setSelectedOrderForModal(updatedOrder);
    }
  };

  const handleAcceptContract = async (orderId) => {
    if (!orderId || contractActionLoading) return;

    setContractActionError("");
    setContractActionMessage("");
    setContractActionOrderId(orderId);
    setContractActionLoading(true);
    try {
      const response = await acceptContract(orderId);
      updateLocalOrder(response.order);
      setContractActionMessage("Contract accepted and signed successfully.");
      toast.success("Contract accepted and signed successfully.");
      setContractActionOrderId(response.order._id);
      setContractConfirmModal({ open: false, action: null, orderId: null });
      setShowContractModal(false);
    } catch (error) {
      const message = error.data?.message || error.message || "Unable to accept contract.";
      setContractActionError(message);
      toast.error(message);
      setContractActionMessage("");
    } finally {
      setContractActionLoading(false);
    }
  };

  const handleDeclineContract = async (orderId, declineReason) => {
    if (!orderId || contractActionLoading) return;

    setContractActionError("");
    setContractActionMessage("");
    setContractActionOrderId(orderId);
    setContractActionLoading(true);
    try {
      const response = await declineContract(orderId, declineReason);
      updateLocalOrder(response.order);
      if (selectedOrderForModal?._id === orderId) {
        setSelectedOrderForModal(response.order);
      }
      setContractActionMessage("Contract declined. ACGC has received your reason.");
      toast.success("Contract declined successfully.");
      setContractActionOrderId(response.order._id);
      setContractConfirmModal({ open: false, action: null, orderId: null });
      setShowContractModal(false);
    } catch (error) {
      const message = error.data?.message || error.message || "Unable to decline contract.";
      setContractActionError(message);
      toast.error(message);
      setContractActionMessage("");
    } finally {
      setContractActionLoading(false);
    }
  };

  const openContractConfirmModal = (action, orderId) => {
    setContractActionError("");
    setContractDeclineReason("");
    setContractConfirmModal({
      open: true,
      action,
      orderId,
    });
  };

  const closeContractConfirmModal = () => {
    setContractConfirmModal({ open: false, action: null, orderId: null });
    setContractDeclineReason("");
  };

  const handleConfirmContractAction = async () => {
    if (!contractConfirmModal.orderId || !contractConfirmModal.action) return;

    const orderId = contractConfirmModal.orderId;
    const action = contractConfirmModal.action;
    const declineReason = contractDeclineReason.trim();

    if (action === "decline" && !declineReason) {
      setContractActionError("Please provide a reason for declining the contract.");
      return;
    }

    closeContractConfirmModal();

    if (action === "accept") {
      await handleAcceptContract(orderId);
    } else if (action === "decline") {
      await handleDeclineContract(orderId, declineReason);
    }
  };

  const handleRemoveFromCart = (cartId) => {
    setCartItems((prev) => prev.filter((item) => item.cartId !== cartId));
  };

  const handleDeleteSelectedItems = () => {
    setCartItems((prev) => prev.filter((item) => !item.selected));
  };

  const handleToggleCartItem = (cartId) => {
    setCartItems((prev) =>
      prev.map((item) =>
        item.cartId === cartId ? { ...item, selected: !item.selected } : item
      )
    );
  };

  const handleSelectAllCartItems = (selected) => {
    setCartItems((prev) => prev.map((item) => ({ ...item, selected })));
  };

  const handleUpdateCartQuantity = (cartId, delta) => {
    setCartItems((prev) =>
      prev
        .map((item) =>
          item.cartId === cartId
            ? {
                ...item,
                quantity: Math.max(1, item.quantity + delta),
                dimensions: {
                  ...(item.dimensions || {}),
                  quantity: Math.max(1, item.quantity + delta),
                },
              }
            : item
        )
        .filter((item) => item.quantity > 0)
    );
  };

  const handleClearCart = () => {
    setCartItems([]);
  };

  const handleViewProduct = (product) => {
    setSelectedProduct(product);
    setSelectedProductImageIndex(0);
    setProductEstimatorForm({ unit: "in", width: "0", height: "0" });
    setShowAboutProduct(false);
  };

  const closeProductModal = () => {
    setSelectedProduct(null);
    setSelectedProductImageIndex(0);
    setShowAboutProduct(false);
  };

  const openOrderNowModal = (product) => {
    if (!canRequestOrders) {
      showPermissionNotice("Order requests are disabled for your account.");
      return;
    }
    setOrderNowProduct(product);
    setOrderNowQuantity(1);
    setDeliveryConfirmMode("orderNow");
    setDeliveryConfirmForm({
      phone: profileForm.phone || user?.phone || "",
      street_address: profileForm.street_address || user?.street_address || "",
      city: profileForm.city || user?.city || "",
      province: profileForm.province || user?.province || "",
      zip_code: profileForm.zip_code || user?.zip_code || "",
    });
    setDeliveryConfirmNotes("");
    setDeliveryConfirmError("");
    setShowDeliveryConfirmModal(true);
    setCartActionError("");
  };

  const openEstimatedProductOrder = (product) => {
    if (!canRequestOrders) {
      showPermissionNotice("Order requests are disabled for your account.");
      return;
    }

    setCartDecisionProduct(product);
    setEstimateForm({
      unit: productEstimatorForm.unit,
      width: productEstimatorForm.width,
      height: productEstimatorForm.height,
      quantity: 1,
      notes: "",
    });
    setEstimateFormErrors({});
    setDeliveryConfirmMode("estimate");
    setDeliveryConfirmForm({
      phone: profileForm.phone || user?.phone || "",
      street_address: profileForm.street_address || user?.street_address || "",
      city: profileForm.city || user?.city || "",
      province: profileForm.province || user?.province || "",
      zip_code: profileForm.zip_code || user?.zip_code || "",
    });
    setDeliveryConfirmNotes("");
    setDeliveryConfirmError("");
    setCartActionError("");
    setShowDeliveryConfirmModal(true);
    setShowCartDecisionModal(false);
  };

  const closeOrderNowModal = () => {
    setShowOrderNowModal(false);
    setOrderNowProduct(null);
    setOrderNowQuantity(1);
    setCartActionError("");
  };

  const handleOrderNowQuantityChange = (delta) => {
    setOrderNowQuantity((prev) => Math.max(1, prev + delta));
  };

  const openOrderNowReviewModal = () => {
    if (!orderNowProduct) return;
    setDeliveryConfirmMode("orderNow");
    setDeliveryConfirmForm({
      phone: profileForm.phone || "",
      street_address: profileForm.street_address || "",
      city: profileForm.city || "",
      province: profileForm.province || "",
      zip_code: profileForm.zip_code || "",
    });
    setDeliveryConfirmError("");
    setShowDeliveryConfirmModal(true);
    setShowOrderNowModal(false);
  };

  const handleSubmitOrderNow = async () => {
    if (!orderNowProduct) return;

    const quantity = Math.max(1, Number(orderNowQuantity) || 1);
    const dimensions = getProductDefaultDimensions(orderNowProduct, quantity);
    const lineTotal = getProductLineTotal(orderNowProduct, dimensions);

    const item = buildCustomerOrderItem(orderNowProduct, {
      quantity,
      width: dimensions.width,
      height: dimensions.height,
      measurementUnit: dimensions.unit,
      area: 0,
      estimated_price: lineTotal,
      notes: "",
      is_estimate: false,
    });

    if (!areOrderItemDimensionsValid(item.dimensions)) {
      setCartActionError("Please provide valid product dimensions before submitting your order.");
      return;
    }

    const response = await createOrder({
      items: [item],
      notes: deliveryConfirmNotes.trim(),
      shipping_address: normalizeAddress(
        [deliveryConfirmForm.street_address, deliveryConfirmForm.city, deliveryConfirmForm.province, deliveryConfirmForm.zip_code]
          .filter(Boolean)
          .join(", ") || buildFullAddress(user)
      ),
      order_type: "online_order",
    });

    setOrderRequestMessage(getOrderSubmissionMessage(response, "Order requested"));
    addCreatedOrderToMyOrders(response.order);
    setOrderSuccessData(response.order);
    setOrderReviewAgreed(false);
    setShowOrderSuccessModal(true);
  };

  const handleOrderNow = (product) => {
    openOrderNowModal(product);
  };

  const handleDeliveryConfirmChange = (e) => {
    const { name, value } = e.target;
    setDeliveryConfirmForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleCancelDeliveryConfirm = () => {
    setDeliveryConfirmError("");
    setShowDeliveryConfirmModal(false);
    if (deliveryConfirmMode === "orderNow") {
      setShowOrderNowModal(false);
      setOrderNowProduct(null);
    } else if (deliveryConfirmMode === "estimate") {
      setProductEstimatorForm({
        unit: estimateForm.unit,
        width: estimateForm.width,
        height: estimateForm.height,
      });
      setSelectedProduct(cartDecisionProduct);
      setCartDecisionProduct(null);
    }
  };

  const handleTrackingSubmit = async () => {
    if (!canTrackProducts) {
      showPermissionNotice("Product tracking is disabled for your account.");
      return;
    }
    if (!trackingNumber.trim()) {
      setTrackingResult({ error: "Please enter a tracking number." });
      return;
    }

    try {
      const response = await trackOrder(trackingNumber.trim());
      setTrackingResult({ ...response.order, message: `Showing order: ${response.order.tracking}` });
    } catch (error) {
      setTrackingResult({ error: error.data?.message || error.message || "No order found with that tracking number." });
    }
  };

  const handleProfileChange = (e) => {
    const { name, value } = e.target;
    setProfileForm((prev) => ({ ...prev, [name]: value }));
  };

  const profileHasChanges = () => {
    if (!user) return false;

    const currentAddress = buildFullAddress(user);
    const profileAddress = normalizeAddress(
      [profileForm.street_address, profileForm.city, profileForm.province, profileForm.zip_code]
        .filter(Boolean)
        .join(", ") || ""
    );

    return (
      profileForm.first_name.trim() !== (user.first_name || "") ||
      profileForm.last_name.trim() !== (user.last_name || "") ||
      profileForm.phone !== (user.phone || "") ||
      profileAddress !== currentAddress ||
      Boolean(profileForm.new_password) ||
      Boolean(profileForm.confirm_password)
    );
  };

  const performProfileSave = async () => {
    if (!profileForm.current_password) {
      setProfileError("Please enter your current password to save profile changes.");
      return false;
    }

    if (!profileForm.first_name.trim() || !profileForm.last_name.trim()) {
      setProfileError("Please enter both first name and last name.");
      return false;
    }

    if (profileForm.new_password || profileForm.confirm_password) {
      if (!profileForm.new_password) {
        setProfileError("Please enter a new password.");
        return false;
      }

      if (profileForm.new_password.length < 8) {
        setProfileError("New password must be at least 8 characters long.");
        return false;
      }

      if (profileForm.new_password !== profileForm.confirm_password) {
        setProfileError("New password and confirmation do not match.");
        return false;
      }
    }

    setProfileSaving(true);
    try {
      const payload = {
        first_name: profileForm.first_name.trim(),
        last_name: profileForm.last_name.trim(),
        phone: profileForm.phone.trim(),
        street_address: normalizeAddress(profileForm.street_address || ""),
        city: profileForm.city.trim(),
        province: profileForm.province.trim(),
        zip_code: profileForm.zip_code.trim(),
        current_password: profileForm.current_password,
      };

      if (profileForm.new_password) {
        payload.new_password = profileForm.new_password;
      }

      const response = await updateProfile(payload);
      const nextProfile = response.user || user;

      setProfileForm({
        first_name: nextProfile?.first_name || "",
        last_name: nextProfile?.last_name || "",
        phone: nextProfile?.phone || "",
        email: nextProfile?.email || profileForm.email,
        street_address: nextProfile?.street_address || "",
        city: nextProfile?.city || "",
        province: nextProfile?.province || "",
        zip_code: nextProfile?.zip_code || "",
        current_password: "",
        new_password: "",
        confirm_password: "",
      });

      try {
        await refreshUser();
      } catch (refreshError) {
        console.warn("Profile refresh after save failed", refreshError);
      }

      setProfileMessage("Profile updated successfully.");
      return true;
    } catch (error) {
      setProfileError(error.data?.message || error.message || "Failed to update profile.");
      return false;
    } finally {
      setProfileSaving(false);
    }
  };

  const handleProfileSave = async () => {
    setProfileError("");
    setPasswordModalError("");
    setProfileMessage("");

    if (!profileHasChanges()) {
      setProfileMessage("No changes to save.");
      return;
    }

    if (!profileForm.current_password) {
      setShowPasswordModal(true);
      return;
    }

    await performProfileSave();
  };

  const openBatchOrderModal = () => {
    if (cartItems.length === 0) {
      setCheckoutError("Your cart is empty.");
      return;
    }

    if (selectedItemCount === 0) {
      setCheckoutError("Please select at least one product before proceeding to checkout.");
      return;
    }

    setCheckoutError("");
    setCheckoutMessage("");
    setBatchOrderForm({
      phone: profileForm.phone || user?.phone || "",
      shipping_address: normalizeAddress(
        [profileForm.street_address || user?.street_address, profileForm.city || user?.city, profileForm.province || user?.province, profileForm.zip_code || user?.zip_code]
          .filter(Boolean)
          .join(", ")
      ),
      notes: "",
    });
    setActiveTab("products");
    setShowBatchOrderModal(true);
  };

  const closeBatchOrderModal = () => {
    setShowBatchOrderModal(false);
    setShowBatchOrderConfirmModal(false);
    setBatchOrderAgreed(false);
    setActiveTab("cart");
  };

  const handleOpenPaymentProofForm = (orderId) => {
    setPaymentProofOpenOrderId(orderId);
    setPaymentProofError("");
    setPaymentProofLoading(false);
    setPaymentProofForm({ amount: "", fileName: "" });
  };

  const handleCancelRequest = (order) => {
    if (!order || String(order.status || "").toLowerCase() === "cancelled") return;
    setCancelRequestModal({ open: true, order });
  };

  const confirmCancelRequest = async () => {
    if (!cancelRequestModal.order || String(cancelRequestModal.order.status || "").toLowerCase() === "cancelled") {
      setCancelRequestModal({ open: false, order: null });
      return;
    }

    const orderIdentifier = cancelRequestModal.order._id || cancelRequestModal.order.id || cancelRequestModal.order.tracking;

    try {
      const response = await cancelCustomerOrder(orderIdentifier);
      const updatedOrder = response.order || {
        ...cancelRequestModal.order,
        status: "cancelled",
      };

      setOrders((prevOrders) =>
        prevOrders.map((order) => {
          const currentOrderId = order._id || order.id || order.tracking;
          return currentOrderId === orderIdentifier ? { ...order, ...updatedOrder, status: updatedOrder.status || "cancelled" } : order;
        })
      );

      setExpandedOrderId((prev) => (prev === orderIdentifier ? null : prev));
      setCancelRequestModal({ open: false, order: null });
      toast.success(response.message || "Order request cancelled.");
    } catch (error) {
      toast.error(error?.data?.message || error?.message || "Unable to cancel this order request.");
    }
  };

  const handlePaymentProofFileChange = (event) => {
    const file = event.target.files && event.target.files[0];
    setPaymentProofForm((prev) => ({
      ...prev,
      file,
      fileName: file ? file.name : "",
    }));
  };

  const submitPaymentProof = async (order) => {
    const normalizedAmount = Number(String(paymentProofForm.amount).replace(/[^\d.]/g, ""));

    if (!paymentProofForm.amount || !Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      setPaymentProofError("Please enter the amount you paid.");
      return;
    }

    const paymentSummary = getPaymentSummary(order);
    if (Math.round(normalizedAmount * 100) > Math.round(paymentSummary.remainingAmount * 100)) {
      setPaymentProofError(`Payment cannot exceed the remaining balance of ${formatRequiredPaymentAmount(paymentSummary.remainingAmount)}.`);
      return;
    }
    if (order.payment_proof_submitted_at && !isPaymentProofConfirmed(order)) {
      setPaymentProofError("Your previous payment is awaiting confirmation before another payment can be submitted.");
      return;
    }

    setPaymentProofLoading(true);
    setPaymentProofError("");

    const orderId = order?._id || order?.id || order?.tracking;

    try {
      let uploadedFileName = paymentProofForm.fileName || "";
      let uploadedFileUrl = "";

      if (paymentProofForm.file) {
        const uploadResult = await uploadFiles([paymentProofForm.file], undefined, { purpose: "payment-proofs" });
        const uploadedFile = uploadResult?.files?.[0];
        uploadedFileName = uploadedFile?.originalName || uploadedFile?.filename || paymentProofForm.fileName || "";
        uploadedFileUrl = uploadedFile?.url || "";
      }

      const response = await apiFetch(`/orders/${orderId}/payment-proof`, {
        method: "PUT",
        body: JSON.stringify({
          amount: normalizedAmount,
          payment_method: "Cash",
          proof_file_name: uploadedFileName,
          proof_file_url: uploadedFileUrl,
        }),
      });

      const savedOrder = response.order || {
        ...order,
        payment_status: paymentSummary.status.key,
        payment_proof_amount: normalizedAmount,
        payment_proof_file_name: uploadedFileName,
        payment_proof_file_url: uploadedFileUrl,
        payment_method: "Cash",
      };
      const savedPaymentStatus = savedOrder.payment_status || paymentSummary.status.key;

      setOrders((prev) =>
        prev.map((entry) => {
          const entryId = entry?._id || entry?.id || entry?.tracking;
          if (entryId === orderId) {
            return {
              ...entry,
              ...savedOrder,
              payment_status: savedPaymentStatus,
              payment_proof_amount: normalizedAmount,
              payment_proof_file_name: uploadedFileName,
              payment_proof_file_url: uploadedFileUrl,
              payment_method: savedOrder.payment_method || "Cash",
            };
          }
          return entry;
        })
      );

      if (selectedOrderForModal && (selectedOrderForModal?._id || selectedOrderForModal?.id || selectedOrderForModal?.tracking) === orderId) {
        setSelectedOrderForModal((prev) =>
          prev
            ? {
                ...prev,
                ...savedOrder,
                payment_status: savedPaymentStatus,
                payment_proof_amount: normalizedAmount,
                payment_proof_file_name: uploadedFileName,
                payment_proof_file_url: uploadedFileUrl,
                payment_method: savedOrder.payment_method || "Cash",
              }
            : prev
        );
      }

      setPaymentProofSuccessByOrder((prev) => ({
        ...prev,
        [orderId]: {
          amount: normalizedAmount,
          fileName: uploadedFileName,
          fileUrl: uploadedFileUrl,
        },
      }));

      toast.success(response.message || "Payment proof submitted successfully.");
      setPaymentProofOpenOrderId(null);
      setPaymentProofForm({ amount: "", fileName: "", file: null });
    } catch (error) {
      setPaymentProofError(error?.message || "Unable to submit payment proof.");
    } finally {
      setPaymentProofLoading(false);
    }
  };

  const handleCheckout = () => {
    if (cartItems.length === 0) {
      setCheckoutError("Your cart is empty.");
      return;
    }

    if (selectedItemCount === 0) {
      setCheckoutError("Please select at least one product before proceeding to checkout.");
      return;
    }

    setCheckoutError("");
    setCheckoutMessage("");
    setBatchOrderAgreed(false);
    setShowBatchOrderConfirmModal(true);
  };

  const handleConfirmBatchOrder = async () => {
    if (!batchOrderAgreed) return;
    setCheckoutLoading(true);
    let orderSubmitted = false;
    try {
      const orderItems = selectedCartItems.map((item) =>
        buildCustomerOrderItem(item, {
          quantity: item.quantity,
          width: item.dimensions?.width ?? item.width,
          height: item.dimensions?.height ?? item.height,
          measurementUnit: item.dimensions?.unit || item.measurementUnit || item.measurement_unit,
          customized: item.dimensions?.customized ?? item.customized ?? item.is_estimate,
          area: item.area,
          estimated_price: item.estimated_price,
          notes: batchOrderForm.notes.trim() || item.notes,
          is_estimate: item.is_estimate,
        })
      );

      if (orderItems.some((item) => !areOrderItemDimensionsValid(item.dimensions))) {
        setCheckoutError("Please provide valid product dimensions before submitting your order.");
        return;
      }

      const response = await createOrder({
        items: orderItems,
        shipping_address: normalizeAddress(batchOrderForm.shipping_address || buildFullAddress(user)),
        customer_phone: batchOrderForm.phone.trim(),
      });

      setCheckoutMessage(getOrderSubmissionMessage(response, "Order placed"));
      setCartItems((prev) => prev.filter((item) => !item.selected));
      addCreatedOrderToMyOrders(response.order);
      setShowBatchSuccessModal(true);
      setShowBatchOrderModal(false);
      setShowBatchOrderConfirmModal(false);
      setBatchOrderAgreed(false);
      orderSubmitted = true;
    } catch (error) {
      setCheckoutError(error.data?.message || error.message || "Failed to place order.");
    } finally {
      setCheckoutLoading(false);
    }
  };

  const getProductPrice = (product) => {
    if (!product) return "Contact us";
    const dimensions = getProductDefaultDimensions(product, 1);
    const price = getProductLineTotal(product, dimensions);
    return price > 0 ? formatCurrency(price) : "Contact us";
  };

  const getProductEstimateRate = (product) => {
    const pricingMethod = String(product?.pricing_method || "").toLowerCase();
    const legacyUnit = String(product?.unit || "").toLowerCase();
    if (pricingMethod === "sqft" || (!pricingMethod && legacyUnit === "per_sqft")) {
      return Number(product?.price_per_sqft) || undefined;
    }
    if (pricingMethod === "blade" || (!pricingMethod && legacyUnit === "per_blade")) {
      return Number(product?.price_per_blade) || undefined;
    }
    return undefined;
  };

  const getProductUnitRate = (product) => {
    const pricePerSqft = Number(product.price_per_sqft) || 0;
    const pricePerBlade = Number(product.price_per_blade) || 0;
    const unitPrice = Number(product.unit_price) || 0;
    const unitKey = product.unit || product.pricing_method || "unit";
    const unitLabels = {
      per_sqft: "sq ft",
      sqft: "sq ft",
      per_blade: "blade",
      blade: "blade",
      per_piece: "piece",
      piece: "piece",
      per_meter: "meter",
      meter: "meter",
      per_set: "set",
      set: "set",
    };
    const label = unitLabels[unitKey] || unitKey;

    if (product.pricing_method === "sqft" && pricePerSqft > 0) {
      return `₱${pricePerSqft.toLocaleString()} / ${label}`;
    }
    if (product.pricing_method === "blade" && pricePerBlade > 0) {
      return `₱${pricePerBlade.toLocaleString()} / ${label}`;
    }
    if (pricePerSqft > 0 && label === "sq ft") {
      return `₱${pricePerSqft.toLocaleString()} / ${label}`;
    }
    if (pricePerBlade > 0 && label === "blade") {
      return `₱${pricePerBlade.toLocaleString()} / ${label}`;
    }
    if (unitPrice > 0) {
      return `₱${unitPrice.toLocaleString()} / ${label}`;
    }
    return "Contact us";
  };

  const getCartItemMeasurementDetails = (item) => {
    const width = Number(item.width ?? item.dimensions?.width ?? 0);
    const height = Number(item.height ?? item.dimensions?.height ?? 0);
    const measurementUnit = item.measurementUnit || item.measurement_unit || item.dimensions?.unit || item.unit || "in";
    const rawArea = Number(item.area ?? item.dimensions?.area ?? 0);
    const estimatedPrice = Number(item.estimated_price || 0);
    const quantity = Number(item.quantity || 1);

    if (!width || !height) return null;

    const areaInSqFt =
      rawArea > 0
        ? rawArea
        : measurementUnit === "in"
          ? (width * height * quantity) / 144
          : measurementUnit === "ft"
            ? width * height * quantity
            : measurementUnit === "cm"
              ? (width * height * quantity) / 929.0304
              : measurementUnit === "m"
                ? (width * height * quantity) * 10.7639
                : width * height * quantity;

    const ratePerSqFt =
      Number(item.unit_price) > 0
        ? Number(item.unit_price)
        : areaInSqFt > 0
          ? estimatedPrice / areaInSqFt
          : 0;

    const unitSymbol = measurementUnit === "in" ? '"' : measurementUnit === "ft" ? "'" : measurementUnit === "cm" ? "cm" : measurementUnit === "m" ? "m" : "";

    return {
      dimensions: `${width}${unitSymbol} x ${height}${unitSymbol}`,
      area: `${areaInSqFt > 0 ? areaInSqFt.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "0"} sq.ft`,
      unitRate: `₱${Number(ratePerSqFt || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}/sq.ft`,
    };
  };

  const getProductImage = (product) => {
    let candidate = null;
    if (product?.image_url) candidate = product.image_url;
    if (!candidate && product?.image) candidate = product.image;
    if (!candidate && product?.images && typeof product.images === "object") {
      const images = Object.values(product.images).flat().filter(Boolean);
      if (images.length > 0) candidate = images[0];
    }
    return ensureAbsoluteUrl(candidate);
  };

  const getProductImages = (product) => {
    if (!product) return [{ url: PRODUCT_IMAGE_PLACEHOLDER, label: "Main photo" }];

    const images = [];
    const seen = new Set();
    const addImage = (value, label) => {
      if (Array.isArray(value)) {
        value.forEach((item) => addImage(item, label));
        return;
      }
      const rawUrl = typeof value === "object" && value ? value.url : value;
      if (typeof rawUrl !== "string" || !rawUrl.trim()) return;
      const url = ensureAbsoluteUrl(rawUrl);
      if (seen.has(url) || url === PRODUCT_IMAGE_PLACEHOLDER) return;
      seen.add(url);
      images.push({ url, label });
    };

    addImage(product.image_url, "Main photo");
    addImage(product.image, "Main photo");
    if (product.images && typeof product.images === "object") {
      Object.entries(product.images).forEach(([key, value]) => {
        const label = key === "main" ? "Main photo" : `${key.charAt(0).toUpperCase()}${key.slice(1)} angle`;
        addImage(value, label);
      });
    }

    return images.length ? images : [{ url: PRODUCT_IMAGE_PLACEHOLDER, label: "Product photo" }];
  };

  function getOrderItemImage(item) {
    if (!item) return PRODUCT_IMAGE_PLACEHOLDER;
    let candidate = null;
    if (item.image_url) candidate = item.image_url;
    if (!candidate && item.image) candidate = item.image;
    const productReference = item.product_id || item.product;
    const productId = typeof productReference === "object"
      ? productReference?._id || productReference?.id
      : productReference;
    const product = typeof productReference === "object"
      ? productReference
      : products.find((entry) => String(entry._id || entry.id) === String(productId));
    if (!candidate && product) candidate = getProductImage(product);
    return ensureAbsoluteUrl(candidate);
  }

  function formatCurrency(amount) {
    return `₱${Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function formatRequiredPaymentAmount(amount) {
    const roundedAmount = Math.round(Number(amount || 0) * 100) / 100;
    return `₱${roundedAmount.toLocaleString(undefined, {
      minimumFractionDigits: Number.isInteger(roundedAmount) ? 0 : 2,
      maximumFractionDigits: 2,
    })}`;
  }

  function getItemPriceValue(item) {
    if (!item) return 0;

    if (item.cartId) {
      return getProductLineTotal(item, item);
    }
    if (Number(item.line_total) > 0) {
      return Number(item.line_total);
    }

    const quantity = Number(item.quantity || item.qty || 1) || 1;
    const normalizedArea = Number(item.area || 0) || 0;
    const itemHeight = Number(item.height ?? item.dimensions?.height ?? 0) || 0;
    const itemWidth = Number(item.width ?? item.dimensions?.width ?? 0) || 0;
    const derivedArea = normalizedArea || (itemWidth && itemHeight ? itemWidth * itemHeight / 144 : 0);
    const productRate = Number(
      item.price_per_sqft ??
      item.product?.price_per_sqft ??
      item.product_id?.price_per_sqft ??
      0
    ) || 0;
    const productUnitPrice = Number(
      item.unit_price ??
      item.price ??
      item.amount ??
      item.product?.unit_price ??
      item.product_id?.unit_price ??
      0
    ) || 0;

    if (item.is_estimate && Number(item.estimated_price || item.manual_estimated_total || 0) > 0) {
      return Number(item.estimated_price || item.manual_estimated_total || 0);
    }

    if (Number(item.amount || item.total_price || 0) > 0) {
      return Number(item.amount || item.total_price || 0);
    }

    if (productRate > 0 && derivedArea > 0) {
      return productRate * derivedArea * quantity;
    }

    if (productUnitPrice > 0) {
      return productUnitPrice * quantity;
    }

    if (Number(item.unit_price || 0) > 0) {
      return Number(item.unit_price || 0) * quantity;
    }

    return 0;
  }

  function getOrderTotalValue(order) {
    if (!order) return 0;

    const savedTotal = Number(order.contract_amount || order.total_amount || 0);
    if (savedTotal > 0) return savedTotal;

    const orderItems = Array.isArray(order.items) ? order.items : [];
    if (orderItems.length > 0) {
      return orderItems.reduce((sum, item) => sum + getItemPriceValue(item), 0);
    }

    return Number(order.total_amount || 0);
  };

  const getConfirmationItemDimensionText = (item) => {
    return formatOrderItemMeasurements(item);
  };

  const getOrderMeasurementRows = (order) => {
    if (!order || !Array.isArray(order.items)) return [];

    return order.items.map((item, index) => {
      const dimensions = item?.dimensions || {};
      const width = Number(dimensions.width ?? item.width ?? 0) || 0;
      const height = Number(dimensions.height ?? item.height ?? 0) || 0;
      const quantity = Number(item.quantity || item.qty || 1) || 1;
      const unit = String(dimensions.unit || item.measurement_unit || item.measurementUnit || "in");
      const area = Number(item.area || (width * height * quantity) || 0) || 0;
      const label = item.name || item.product_name || item.product?.name || `Project item ${index + 1}`;

      return {
        label,
        quantity,
        width,
        height,
        unit,
        area,
      };
    }).filter((row) => row.width > 0 || row.height > 0);
  };

  const buildContractDataFromOrder = (order) => {
    if (!order) return null;

    const amount = Number(order.contract_amount || order.total_amount || 0);
    const downPayment = Math.round((amount * 0.5) * 100) / 100;
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

    const contractStatusRaw = String(order.contract_status || "").trim();
    const orderStatusKey = normalizeOrderStatusKey(order?.status);
    const contractStatus = contractStatusRaw
      ? contractStatusRaw.replace(/_/g, " ")
      : (["contract_sent", "contract_accepted", "contract_declined"].includes(orderStatusKey))
        ? String(order.status).replace(/_/g, " ")
        : "No contract yet";

    const accepted = order.acceptedByCustomer === true || normalizeOrderStatusKey(order?.contract_status) === "accepted" || orderStatusKey === "contract_accepted";

    return {
      orderNumber: order.tracking || order._id || "N/A",
      contractDate: formatDateToMMMDDYYYY(order.updatedAt || order.createdAt) || "N/A",
      orderDate: formatDateToMMMDDYYYY(order.createdAt) || "N/A",
      status: order.status?.replace(/_/g, " ") || "Pending",
      orderStatus: order.status || "",
      rawContractStatus: order.contract_status || "",
      contractStatus,
      customerName: order.customer?.first_name || order.customer_name || "Customer",
      customerEmail: order.customer?.email || order.customer_email || "N/A",
      customerPhone: order.customer?.phone || order.customer_phone || "N/A",
      projectLocation: order.shipping_address || "N/A",
      siteInspectionDate: formatDateToMMMDDYYYY(order.inspection_date) || "TBD",
      paymentTerms: order.payment_terms || "Standard payment terms apply.",
      contractTerms: order.contract_terms || "",
      subtotal: amount,
      totalProjectCost: amount,
      downPayment,
      items,
      accepted,
      acceptanceMethod: accepted ? order.acceptanceMethod || (order.acceptance_method === "walk_in_signed_contract" ? "Walk-in Signed Contract" : "Online Acceptance") : null,
      acceptanceDate: accepted && (order.acceptedAt || order.contract_signed_date || order.updatedAt)
        ? formatDateTimeToMMMDDYYYY(order.acceptedAt || order.contract_signed_date || order.updatedAt)
        : null,
      acceptedBy: order.customer?.first_name || order.customer_name || "Customer",
      contractId: order.tracking || order._id || "N/A",
      customerAccountId: order.customer?._id || order.customer || "N/A",
    };
  };

  const openContractModal = (order) => {
    if (!order || !canShowContractForOrder(order)) return;
    setContractPreviewOrder(order);
    setShowContractModal(true);
  };

  const closeContractModal = () => {
    setShowContractModal(false);
    setContractPreviewOrder(null);
  };

  const contractPreviewData = contractPreviewOrder
    ? buildContractDataFromOrder(contractPreviewOrder)
    : null;
  const isContractAccepted = contractPreviewOrder?.acceptedByCustomer === true || normalizeOrderStatusKey(contractPreviewOrder?.status) === "contract_accepted"
    || normalizeOrderStatusKey(contractPreviewOrder?.contract_status) === "accepted";

  const createContractExportClone = () => {
    const element = document.getElementById("contract-content");
    if (!element) return null;

    const clone = element.cloneNode(true);
    clone.style.width = `${element.scrollWidth}px`;
    clone.style.height = "auto";
    clone.style.maxHeight = "none";
    clone.style.overflow = "visible";
    clone.style.position = "relative";

    const wrapper = document.createElement("div");
    wrapper.style.position = "fixed";
    wrapper.style.left = "-9999px";
    wrapper.style.top = "0";
    wrapper.style.opacity = "0";
    wrapper.style.pointerEvents = "none";
    wrapper.appendChild(clone);
    document.body.appendChild(wrapper);

    return { wrapper, clone };
  };

  const downloadAcceptedContractPNG = async () => {
    const exportClone = createContractExportClone();
    if (!exportClone) {
      toast.error("Unable to locate the accepted contract.");
      return;
    }

    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const dataUrl = await toPng(exportClone.clone, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: "#ffffff",
      });
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `accepted-contract-${contractPreviewOrder?.tracking || contractPreviewOrder?._id || "export"}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error("Failed to export accepted contract PNG", error);
      toast.error("Failed to save the accepted contract as PNG.");
    } finally {
      exportClone.wrapper.remove();
    }
  };

  const printAcceptedContract = async () => {
    const exportClone = createContractExportClone();
    if (!exportClone) {
      toast.error("Unable to locate the accepted contract.");
      return;
    }

    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const dataUrl = await toPng(exportClone.clone, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: "#ffffff",
      });
      const printWindow = window.open("", "_blank");
      if (!printWindow) {
        toast.error("Please allow popups to print the accepted contract.");
        return;
      }
      printWindow.document.write(`<!doctype html><html><head><title>Accepted Contract</title><style>html,body{margin:0;padding:0;background:#fff;}body{padding:12mm;}img{width:100%;height:auto;display:block;}@media print{body{padding:0;}}</style></head><body><img src="${dataUrl}" alt="Accepted contract" /></body></html>`);
      printWindow.document.close();
      printWindow.focus();
      printWindow.onload = () => printWindow.print();
    } catch (error) {
      console.error("Failed to print accepted contract", error);
      toast.error("Failed to print the accepted contract.");
    } finally {
      exportClone.wrapper.remove();
    }
  };

  const getContractStatusLabel = (order) => {
    const contractStatus = normalizeOrderStatusKey(order?.contract_status);
    const orderStatus = normalizeOrderStatusKey(order?.status);

    if (contractStatus === "sent" || orderStatus === "contract_sent") return "Needs Your Response";
    if (contractStatus === "accepted" || orderStatus === "contract_accepted") return "Accepted";
    if (contractStatus === "declined" || orderStatus === "contract_declined") return "Declined";
    return normalizeOrderStatus(order?.contract_status) || normalizeOrderStatus(order?.status) || "Unknown";
  };

  const getOrderProgressPercent = (order) => {
    if (!order || normalizeOrderStatusKey(order?.status) === "cancelled") return 0;

    const steps = buildOrderTimelineStages(order).filter((step) => step.key !== "installation_agreement");
    return calculateStageProgressPercent(steps);
  };

  const activeOrdersCount = orders.filter((order) => {
    const status = normalizeOrderStatus(order?.status);
    return status !== "completed" && status !== "cancelled";
  }).length;
  const pendingContractsCount = orders.filter((order) => {
    const status = normalizeOrderStatus(order?.status);
    return ["contract sent", "contract accepted"].includes(status);
  }).length;
  const completedProjectsCount = orders.filter((order) => normalizeOrderStatus(order?.status) === "completed").length;
  const cancelledProjectsCount = orders.filter((order) => normalizeOrderStatus(order?.status) === "cancelled").length;

  const getOrderIdentifier = (order, fallback = "") => {
    const id = order?._id ?? order?.id ?? order?.tracking ?? fallback;
    return typeof id === "string" && id.trim() ? id : fallback || "unknown-order";
  };

  const filteredOrders = orders.filter((order) => {
    // If tracking number is entered, filter by tracking ID only
    if (trackingNumber.trim()) {
      return order.tracking.toUpperCase().includes(trackingNumber.trim().toUpperCase());
    }

    const status = normalizeOrderStatus(order?.status);

    // Otherwise, apply status filter
    if (orderFilter === "all") return true;
    if (orderFilter === "order") return !["installation", "completed", "cancelled"].includes(status);
    if (orderFilter === "review") return isOrderCompletedAndReviewable(order) && !hasOrderReview(order);
    if (orderFilter === "reviewed") return hasAnyOrderReview(order);
    if (orderFilter === "completed") return status === "completed" && (hasOrderReview(order) || !isOrderCompletedAndReviewable(order));
    if (orderFilter === "cancel") return status === "cancelled";
    return true;
  });

  const ORDER_PAGE_SIZE = 5;
  const orderPageCount = Math.max(1, Math.ceil(filteredOrders.length / ORDER_PAGE_SIZE));
  const safeOrderPage = Math.min(Math.max(1, orderPage), orderPageCount);
  const pageStart = (safeOrderPage - 1) * ORDER_PAGE_SIZE;
  const pagedFilteredOrders = filteredOrders.slice(pageStart, pageStart + ORDER_PAGE_SIZE);
  const displayedOrders = isMobile ? filteredOrders : pagedFilteredOrders;

  const openOrderDetailsFromNotification = (order, notificationId = null) => {
    const orderIdentifier = getOrderIdentifier(order);
    markCustomerNotificationRead(notificationId);
    const myOrders = orders.filter((entry) =>
      !["installation", "completed", "cancelled"].includes(normalizeOrderStatus(entry?.status)),
    );
    const targetOrders = myOrders.some((entry) => getOrderIdentifier(entry) === orderIdentifier)
      ? myOrders
      : orders;
    const orderIndex = targetOrders.findIndex(
      (entry) => getOrderIdentifier(entry) === orderIdentifier,
    );

    setTrackingNumber("");
    setOrderFilter(targetOrders === myOrders ? "order" : "all");
    setOrderPage(orderIndex >= 0 ? Math.floor(orderIndex / ORDER_PAGE_SIZE) + 1 : 1);
    setSelectedOrderForModal(null);
    setExpandedOrderId(orderIdentifier);
    setHighlightedOrderId(orderIdentifier);
    setActiveTab("orders");
  };

  useEffect(() => {
    if (!highlightedOrderId) return undefined;
    if (activeTab !== "orders") {
      setHighlightedOrderId(null);
      return undefined;
    }

    let attempts = 0;
    const scrollInterval = window.setInterval(() => {
      const target = Array.from(document.querySelectorAll("[data-notification-record-id]"))
        .find((element) => element.dataset.notificationRecordId === highlightedOrderId);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        window.clearInterval(scrollInterval);
      } else if (attempts >= 20) {
        window.clearInterval(scrollInterval);
      }
      attempts += 1;
    }, 100);
    const timeoutId = window.setTimeout(() => setHighlightedOrderId(null), 5000);

    return () => {
      window.clearInterval(scrollInterval);
      window.clearTimeout(timeoutId);
    };
  }, [highlightedOrderId, activeTab]);

  const orderViewClass = orderViewMode === "view2"
    ? "grid gap-5 sm:grid-cols-2 xl:grid-cols-3"
    : orderViewMode === "view3"
      ? "grid gap-5 lg:grid-cols-3"
      : "space-y-6";
  const orderFilterOptions = [
    { value: "all", label: "All Orders" },
    { value: "order", label: "My Orders" },
    { value: "review", label: "To Review" },
    { value: "completed", label: "Completed" },
    { value: "reviewed", label: "Reviewed Product" },
    { value: "cancel", label: "Cancelled" },
  ];

  const estimateWidth = Number(estimateForm.width) || 0;
  const estimateHeight = Number(estimateForm.height) || 0;
  const estimateQuantity = Math.max(1, Number(estimateForm.quantity) || 1);
  const selectedUnitLabel = estimateForm.unit === 'in' ? 'in' : estimateForm.unit === 'ft' ? 'ft' : estimateForm.unit === 'cm' ? 'cm' : 'm';
  const selectedAreaUnitLabel = estimateForm.unit === 'in' ? 'in²' : estimateForm.unit === 'ft' ? 'ft²' : estimateForm.unit === 'cm' ? 'cm²' : 'm²';
  const estimateAreaSelectedUnit = estimateWidth && estimateHeight ? estimateWidth * estimateHeight : 0;
  const estimateTotalAreaSelectedUnit = estimateAreaSelectedUnit * estimateQuantity;
  
  // Use comprehensive calculateEstimate like admin does
  const rawEstimateResult = cartDecisionProduct ? calculateEstimate({
    productName: cartDecisionProduct.product_name || cartDecisionProduct.name,
    categoryKey: cartDecisionProduct.product_type || cartDecisionProduct.category,
    variantName: cartDecisionProduct.variant,
    width: estimateWidth,
    height: estimateHeight,
    measurementUnit: estimateForm.unit,
    quantity: estimateQuantity,
    blade_count: cartDecisionProduct.blade_count || 0,
    base_price: cartDecisionProduct.base_price || undefined,
    overrideRate: getProductEstimateRate(cartDecisionProduct),
    customization: cartDecisionProduct.customization || false,
    customization_fee: cartDecisionProduct.customization_fee || 0,
  }) : { estimated_area: 0, estimated_price: 0, rate: 0, areaDisplay: '—', rateNote: '' };
  const estimateResult = cartDecisionProduct
    ? {
        ...rawEstimateResult,
        estimated_price: getProductLineTotal(cartDecisionProduct, {
          width: estimateWidth,
          height: estimateHeight,
          measurement_unit: estimateForm.unit,
          quantity: estimateQuantity,
          customized: true,
        }),
      }
    : rawEstimateResult;

  const productEstimatorWidth = Number(productEstimatorForm.width) || 0;
  const productEstimatorHeight = Number(productEstimatorForm.height) || 0;
  const rawProductEstimatorResult = selectedProduct ? calculateEstimate({
    productName: selectedProduct.product_name || selectedProduct.name,
    categoryKey: selectedProduct.product_type || selectedProduct.category,
    variantName: selectedProduct.variant,
    width: productEstimatorWidth,
    height: productEstimatorHeight,
    measurementUnit: productEstimatorForm.unit,
    quantity: 1,
    blade_count: selectedProduct.blade_count || 0,
    base_price: selectedProduct.base_price || undefined,
    overrideRate: getProductEstimateRate(selectedProduct),
    customization: selectedProduct.customization || false,
    customization_fee: selectedProduct.customization_fee || 0,
  }) : null;
  const productEstimatorResult = selectedProduct
    ? {
        ...rawProductEstimatorResult,
        estimated_price: getProductLineTotal(selectedProduct, {
          width: productEstimatorWidth,
          height: productEstimatorHeight,
          measurement_unit: productEstimatorForm.unit,
          quantity: 1,
          customized: true,
        }),
      }
    : null;

  const estimateArea = estimateResult.estimated_area || 0;
  const estimateTotalArea = estimateArea;
  const estimateUnitRate = estimateResult.rate || 0;
  const estimateTotalCost = estimateResult.estimated_price || 0;
  const orderReviewMeasurementText = reviewOrderMode === "orderNow"
    ? (() => {
        if (!orderNowProduct) return `Qty: ${Math.max(1, Number(orderNowQuantity) || 1)}`;
        const defaultDims = getProductDefaultDimensions(orderNowProduct, Math.max(1, Number(orderNowQuantity) || 1));
        if (!defaultDims || Number(defaultDims.width) <= 0 || Number(defaultDims.height) <= 0) {
          return `Qty: ${Math.max(1, Number(orderNowQuantity) || 1)}`;
        }

        const quantity = Math.max(1, Number(orderNowQuantity) || 1);
        const unit = defaultDims.unit || "in";
        const area = Number(defaultDims.area) > 0
          ? Number(defaultDims.area)
          : unit === "in"
            ? (Number(defaultDims.width) * Number(defaultDims.height) * quantity) / 144
            : unit === "ft"
              ? Number(defaultDims.width) * Number(defaultDims.height) * quantity
              : unit === "cm"
                ? (Number(defaultDims.width) * Number(defaultDims.height) * quantity) / 929.0304
                : unit === "m"
                  ? Number(defaultDims.width) * Number(defaultDims.height) * quantity * 10.7639
                  : Number(defaultDims.width) * Number(defaultDims.height) * quantity;

        return getConfirmationItemDimensionText({
          width: Number(defaultDims.width),
          height: Number(defaultDims.height),
          quantity,
          measurementUnit: unit,
          area,
        });
      })()
    : getConfirmationItemDimensionText({
        width: estimateWidth,
        height: estimateHeight,
        quantity: estimateQuantity,
        measurementUnit: estimateForm.unit,
        area: estimateArea,
      });
  const estimateCustomizationFee = cartDecisionProduct?.customization ? Number(cartDecisionProduct.customization_fee || 0) : 0;
  const estimateInstallationFee = Number(cartDecisionProduct?.installation_fee || 0);
  const estimateSubtotal = Math.max(0, estimateTotalCost - estimateCustomizationFee);
  const estimateGrandTotal = estimateTotalCost + estimateInstallationFee;
  const orderNowSubtotal = orderNowProduct
    ? getProductLineTotal(orderNowProduct, {
        ...getProductDefaultDimensions(orderNowProduct, Math.max(1, Number(orderNowQuantity) || 1)),
        quantity: Math.max(1, Number(orderNowQuantity) || 1),
      })
    : 0;
  const orderNowAdditionalCharges = Number(orderNowProduct?.customization_fee || 0);
  const orderNowInstallationFee = Number(orderNowProduct?.installation_fee || 0);
  const orderNowGrandTotal = orderNowSubtotal + orderNowAdditionalCharges + orderNowInstallationFee;
  const orderNowTotal = orderNowGrandTotal;
  const confirmProduct = deliveryConfirmMode === "orderNow" ? orderNowProduct : cartDecisionProduct;
  const confirmQuantity = deliveryConfirmMode === "orderNow" ? Math.max(1, Number(orderNowQuantity) || 1) : estimateQuantity;
  const orderNowDimensions = orderNowProduct
    ? getProductDefaultDimensions(orderNowProduct, confirmQuantity)
    : null;
  const confirmWidth = deliveryConfirmMode === "orderNow"
    ? orderNowDimensions?.width
      ? `${orderNowDimensions.width} ${orderNowDimensions.unit || "in"}`
      : "—"
    : estimateWidth ? `${estimateWidth} ${selectedUnitLabel}` : "—";
  const confirmHeight = deliveryConfirmMode === "orderNow"
    ? orderNowDimensions?.height
      ? `${orderNowDimensions.height} ${orderNowDimensions.unit || "in"}`
      : "—"
    : estimateHeight ? `${estimateHeight} ${selectedUnitLabel}` : "—";
  const confirmPrice = deliveryConfirmMode === "orderNow" ? orderNowSubtotal : estimateTotalCost;
  const confirmSubtotal = deliveryConfirmMode === "orderNow" ? orderNowSubtotal : estimateSubtotal;
  const confirmAdditionalCharges = deliveryConfirmMode === "orderNow" ? orderNowAdditionalCharges : estimateCustomizationFee;
  const confirmInstallationFee = deliveryConfirmMode === "orderNow" ? orderNowInstallationFee : estimateInstallationFee;
  const confirmGrandTotal = deliveryConfirmMode === "orderNow" ? orderNowGrandTotal : estimateGrandTotal;
  const isDeliveryConfirmValid = Boolean(
    deliveryConfirmForm.phone.trim() &&
    deliveryConfirmForm.street_address.trim()
  );

  const cartQuantity = cartItems.reduce((sum, item) => sum + (item.quantity || 0), 0);
  const showFeaturedSection = activeTab === "home";
  const sectionTextClass = darkMode ? "text-slate-100" : "text-slate-900";
  const sectionMutedTextClass = darkMode ? "text-slate-300" : "text-slate-600";
  const panelClass = darkMode ? "bg-slate-800 border-slate-700" : "bg-white border-slate-200";
  const selectedProductImages = getProductImages(selectedProduct);
  const activeProductImage = selectedProductImages[Math.min(selectedProductImageIndex, selectedProductImages.length - 1)];
  const selectedProductDimensions = selectedProduct
    ? selectedProduct.dimensions || selectedProduct.standard_size || (
      selectedProduct.width > 0 || selectedProduct.height > 0
        ? `${selectedProduct.width || 0}" x ${selectedProduct.height || 0}"`
        : "N/A"
    )
    : "N/A";
  const profileDisplayName = `${profileForm.first_name || user?.first_name || ""} ${profileForm.last_name || user?.last_name || ""}`.trim() || "Customer";
  const profileInitials = profileDisplayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "C";
  const profileEmail = profileForm.email || user?.email || "";

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="h-12 w-12 rounded-full border-4 border-red-600 border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className={`admin-theme-shell relative flex min-h-screen flex-col overflow-x-clip pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-0 ${darkMode
      ? "admin-theme-dark"
      : "admin-theme-light"
    }`}>
      <div className="admin-shell-drawing" aria-hidden="true">
        <div className="admin-shell-circle admin-shell-circle-top" />
        <div className="admin-shell-circle admin-shell-circle-top-small" />
        <div className="admin-shell-circle admin-shell-circle-middle" />
        <div className="admin-shell-circle admin-shell-circle-middle-small" />
        <div className="admin-shell-circle admin-shell-circle-bottom" />
        <div className="admin-shell-circle admin-shell-circle-bottom-small" />
      </div>
      <Toaster position="bottom-right" />
      {permissionNotice && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-[2px]">
          <div
            className={`w-full max-w-md rounded-3xl border border-amber-200 bg-white p-6 text-center shadow-2xl transition-all duration-300 ${
              permissionNotice.closing ? "translate-y-2 scale-95 opacity-0" : "translate-y-0 scale-100 opacity-100"
            }`}
            role="alertdialog"
            aria-live="assertive"
            aria-label="Permission notice"
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <Info size={24} />
            </div>
            <h2 className="mt-4 text-lg font-black text-slate-900">{permissionNotice.maintenance ? "System Under Maintenance" : "Access Restricted"}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{permissionNotice.message}</p>
            {permissionNotice.maintenance ? (
              <button type="button" onClick={handleLogoutConfirm} className="mt-5 rounded-xl bg-red-700 px-6 py-2.5 text-sm font-bold text-white transition hover:bg-red-800">Logout ({maintenanceCountdown})</button>
            ) : (
              <button type="button" onClick={() => setPermissionNotice(null)} className="mt-5 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800">Close</button>
            )}
          </div>
        </div>
      )}
      <div className={`${darkMode ? "bg-slate-900/90 border-b border-slate-700 shadow-lg shadow-slate-950/20" : "bg-white/90 border-b border-slate-200 shadow-sm"} sticky top-0 z-50`}>
        <div className="flex w-full items-center justify-between gap-2 px-3 py-2.5 sm:px-4 lg:gap-4">
          <button
            type="button"
            onClick={() => setActiveTab("home")}
            className="flex min-w-0 items-center gap-2 px-1 py-0.5 text-left transition duration-200 sm:gap-3 sm:px-1.5"
            aria-label="Go to ACGC Services home"
          >
            <img src={logo} alt="ACGC Aluminum Services" className="h-8 w-8 shrink-0 object-contain sm:h-12 sm:w-12 lg:h-14 lg:w-14" />
            <div className="min-w-0">
              <h1 className="truncate text-sm font-bold text-red-500 sm:text-lg lg:text-xl">
                ACGC Services
              </h1>
              <p className={`hidden truncate text-[10px] font-bold sm:block sm:text-xs lg:text-sm ${darkMode ? "text-slate-300" : "text-slate-700"}`}>
                Aluminum & Glass Services
              </p>
            </div>
          </button>

          <div className="flex shrink-0 items-center gap-0.5 sm:gap-1 lg:gap-2">
            {canRequestOrders && (
              <button
                onClick={() => setActiveTab("cart")}
                className={`order-1 relative hidden p-2.5 text-sm font-semibold transition lg:inline-flex ${
                  activeTab === "cart" || cartQuantity > 0
                    ? darkMode
                      ? "text-white"
                      : "text-slate-700"
                    : darkMode
                      ? "text-slate-200 hover:text-white"
                      : "text-slate-700 hover:text-slate-900"
                }`}
                aria-label="Cart"
                title="Cart"
              >
                <ShoppingCart className="h-6 w-6 lg:h-8 lg:w-8" strokeWidth={2.2} />
                {cartQuantity > 0 && (
                  <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 animate-pulse items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white shadow-md shadow-red-500/40">
                    {cartQuantity}
                  </span>
                )}
              </button>
            )}
            <button
              onClick={() => setActiveTab("products")}
                className={`order-3 hidden rounded-full px-4 py-2 text-base font-semibold transition lg:inline-flex ${
                activeTab === "products"
                  ? darkMode
                    ? "border border-slate-700 bg-slate-800 text-white shadow-sm"
                    : "border border-slate-200 bg-slate-100 text-red-600 shadow-sm"
                  : darkMode
                    ? "text-slate-200 hover:bg-slate-800"
                    : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              Browse Products
            </button>
            <button
              onClick={() => setActiveTab("orders")}
                className={`order-4 hidden rounded-full px-4 py-2 text-base font-semibold transition lg:inline-flex ${
                activeTab === "orders"
                  ? darkMode
                    ? "border border-slate-700 bg-slate-800 text-white shadow-sm"
                    : "border border-slate-200 bg-slate-100 text-red-600 shadow-sm"
                  : darkMode
                    ? "text-slate-200 hover:bg-slate-800"
                    : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              Your Orders
            </button>
            <button
              onClick={() => setActiveTab("about")}
                className={`order-5 hidden rounded-full px-4 py-2 text-base font-semibold transition lg:inline-flex ${
                activeTab === "about"
                  ? darkMode
                    ? "border border-slate-700 bg-slate-800 text-white shadow-sm"
                    : "border border-slate-200 bg-slate-100 text-red-600 shadow-sm"
                  : darkMode
                    ? "text-slate-200 hover:bg-slate-800"
                    : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              About Us
            </button>
            <button
              type="button"
              onClick={toggleDarkMode}
                className={`order-7 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition focus:outline-none focus:ring-2 focus:ring-red-500/40 sm:h-10 sm:w-10 ${
                darkMode
                  ? "text-slate-200 hover:bg-slate-800"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
              aria-label={darkMode ? "Switch to day mode" : "Switch to night mode"}
              aria-pressed={darkMode}
              title={darkMode ? "Switch to day mode" : "Switch to night mode"}
            >
              {darkMode
                ? <Moon size={22} strokeWidth={1.8} className="text-sky-300" />
                : <Sun size={22} strokeWidth={1.8} className="text-amber-500" />}
            </button>
            <div className="relative order-6">
              <button
                onClick={() => setNotificationsOpen((s) => !s)}
                className={`relative p-2.5 text-sm font-semibold transition ${
                  darkMode ? "text-slate-200" : "text-slate-700"
                }`}
                aria-haspopup="menu"
                aria-expanded={notificationsOpen}
                aria-label="Notifications"
                title="Notifications"
              >
                <Bell size={22} strokeWidth={2.2} />
                {unreadNotificationCount > 0 && (
                  <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 animate-pulse items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white shadow-md shadow-red-500/40">
                    {unreadNotificationCount}
                  </span>
                )}
              </button>

              {notificationsOpen && (
                <div className={`fixed inset-x-3 top-[calc(4.0625rem+env(safe-area-inset-top))] z-20 mt-1 max-h-[calc(100dvh-5.5rem)] w-auto overflow-y-auto overscroll-contain rounded-2xl border shadow-xl lg:absolute lg:inset-x-auto lg:right-0 lg:top-auto lg:mt-2 lg:max-h-[min(36rem,calc(100vh-6rem))] lg:w-96 ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-white"}`}>
                  <div className={`flex items-center justify-between border-b px-4 py-3 ${darkMode ? "border-slate-700" : "border-slate-100"}`}>
                    <div>
                      <p className={`text-sm font-bold ${darkMode ? "text-white" : "text-slate-950"}`}>Project updates</p>
                      <p className="mt-0.5 text-xs text-slate-400">Your latest order activity</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {unreadNotificationCount > 0 && <span className="rounded-full bg-red-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-red-600">{unreadNotificationCount} new</span>}
                      <button
                        type="button"
                        onClick={markAllCustomerNotificationsRead}
                        disabled={unreadNotificationCount === 0}
                        className={`inline-flex items-center gap-1 text-xs font-semibold transition ${unreadNotificationCount === 0 ? "cursor-not-allowed text-slate-400" : darkMode ? "text-red-300 hover:text-white" : "text-red-600 hover:text-red-700"}`}
                      >
                        <CheckCheck size={14} />
                        Mark all as read
                      </button>
                    </div>
                  </div>

                  <div className={`flex gap-1 border-b px-3 py-2 ${darkMode ? "border-slate-700" : "border-slate-100"}`}>
                    {[
                      ["all", "All", orders.length],
                      ["unread", "Unread", unreadNotificationCount],
                      ["read", "Read", readNotificationCount],
                    ].map(([filter, label, count]) => (
                      <button
                        key={filter}
                        type="button"
                        onClick={() => setNotificationFilter(filter)}
                        className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition ${
                          notificationFilter === filter
                            ? darkMode
                              ? "bg-slate-950 text-white"
                              : "bg-slate-100 text-slate-950"
                            : darkMode
                              ? "text-slate-300 hover:bg-slate-700"
                              : "text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {label} ({count})
                      </button>
                    ))}
                  </div>

                  {ordersLoading ? (
                    <div className={`px-4 py-8 text-center text-sm ${darkMode ? "text-slate-300" : "text-slate-500"}`}>Loading your updates...</div>
                  ) : filteredNotifications.length === 0 ? (
                    <div className={`px-4 py-6 text-center ${darkMode ? "text-slate-300" : "text-gray-600"}`}>
                      <Bell size={22} className="mx-auto mb-2 text-slate-400" />
                      <p>{notificationFilter === "all" ? "No project updates yet" : `No ${notificationFilter} notifications`}</p>
                    </div>
                  ) : (
                    <div className={darkMode ? "max-h-96 divide-y divide-slate-700 overflow-y-auto" : "max-h-96 divide-y divide-slate-200 overflow-y-auto"}>
                      {[...filteredNotifications]
                        .sort(sortCustomerNotificationsNewestFirst)
                        .slice(0, 5)
                        .map((order) => {
                          const product = order.items?.[0] || {};
                          const isRead = readNotificationIds.has(order.notificationId);
                          const status = normalizeOrderStatusKey(order?.status);
                          const contractStatus = normalizeOrderStatusKey(order?.contract_status);
                          const isPaymentNotification = ["payment", "payment_confirmed"].includes(order.notificationType);
                          const isPaymentConfirmationNotification = order.notificationType === "payment_confirmed";
                          const isDelayNotification = order.notificationType === "delay";
                          const isContractReady =
                            status === "contract_sent" ||
                            (status === "site_inspection" && contractStatus === "sent") ||
                            contractStatus === "sent";
                          const notificationDetails = () => {
                            if (isDelayNotification) {
                              return {
                                title: "Project delay reported",
                                message: getDelayNotificationMessage(order),
                                color: "text-amber-600",
                              };
                            }
                            if (isPaymentNotification) {
                              if (isPaymentConfirmationNotification) {
                                return {
                                  title: "Payment confirmed",
                                  message: `Your payment of ${formatCurrency(order.payment_proof_amount)} has been confirmed by our team.`,
                                  color: "text-emerald-600",
                                };
                              }
                              return {
                                title: "Payment proof submitted",
                                message: `Your payment proof for ${formatCurrency(order.payment_proof_amount)} has been sent for confirmation.`,
                                color: "text-emerald-600",
                              };
                            }
                            if (contractStatus === "accepted" || status === "contract_accepted") {
                              return { title: "Contract accepted", message: "Your contract has been accepted. Work can now move forward.", color: "text-emerald-600" };
                            }
                            if (contractStatus === "declined" || status === "contract_declined" || status === "cancelled") {
                              return { title: "Order update", message: "Your contract or order was declined or cancelled.", color: "text-red-600" };
                            }
                            if (isContractReady) {
                              return { title: "Contract ready", message: "Review and respond to your project contract.", color: "text-blue-600" };
                            }

                            switch (status) {
                              case "order_submitted":
                                return { title: "Order submitted", message: "Your order is waiting for admin review.", color: "text-blue-600" };
                              case "admin_review":
                                return { title: "Order under review", message: "Our team is reviewing your project request.", color: "text-amber-600" };
                              case "site_inspection":
                                return { title: "Site inspection", message: "Your project is ready for site inspection.", color: "text-amber-600" };
                              case "fabrication":
                                return { title: "Fabrication started", message: "Your project is currently being fabricated.", color: "text-indigo-600" };
                              case "installation":
                                return { title: "Installation in progress", message: "Your project installation is underway.", color: "text-violet-600" };
                              case "completed":
                                return { title: "Project completed", message: "Your project has been completed successfully.", color: "text-emerald-600" };
                              default:
                                return { title: "Project update", message: `Your order is now ${getOrderStatusLabel(order.status).toLowerCase()}.`, color: "text-amber-600" };
                            }
                          };
                          const details = notificationDetails();
                          const hasContractBeenSent =
                            status === "contract_sent" ||
                            contractStatus === "sent" ||
                            (status === "site_inspection" && contractStatus === "sent");
                          const isContractNotification = !isPaymentNotification && !isDelayNotification && (
                            order.notificationType === "contract" ||
                            hasContractBeenSent ||
                            ["contract_accepted"].includes(status) ||
                            ["accepted"].includes(contractStatus)
                          );
                          const NotificationIcon = isPaymentConfirmationNotification
                            ? CheckCircle
                            : order.notificationType === "payment"
                              ? CreditCard
                              : isDelayNotification
                                ? AlertTriangle
                                : isContractNotification
                                  ? FileText
                                  : Bell;

                          return (
                            <button
                              key={order.notificationId}
                              onClick={() => {
                                openOrderDetailsFromNotification(order, order.notificationId);
                                setNotificationsOpen(false);
                              }}
                              className={`w-full border-l-2 px-4 py-3 text-left transition ${
                                isRead
                                  ? darkMode ? "border-transparent bg-slate-800/60 hover:bg-slate-800" : "border-transparent bg-white hover:bg-slate-50"
                                  : darkMode ? "border-red-400/70 bg-slate-800/90 hover:bg-slate-800" : "border-red-400/70 bg-red-50/40 hover:bg-red-50/70"
                              }`}
                            >
                              <div className="flex gap-3">
                                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${darkMode ? "bg-slate-700" : "bg-slate-100"}`}>
                                  <NotificationIcon size={17} className={details.color} />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="flex min-w-0 items-center gap-2">
                                      <p className={`truncate text-sm ${isRead ? "font-medium" : "font-bold"} ${darkMode ? isRead ? "text-slate-300" : "text-white" : isRead ? "text-slate-600" : "text-slate-950"}`}>{details.title}</p>
                                      {!isRead && <span className="shrink-0 rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-red-700">New</span>}
                                    </div>
                                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${getOrderStatusClasses(isDelayNotification ? "Delayed" : order.status)}`}>{isDelayNotification ? "Delayed" : getOrderStatusLabel(order.status)}</span>
                                  </div>
                                  <p className={`mt-0.5 text-xs ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                                    {details.message}
                                  </p>
                                  <p className={`mt-1 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                                    {product.name || "Project"} · {order.tracking || "Order update"} · <span title={formatDateTimeToMMMDDYYYY(order.notificationDate) || undefined}>{formatTimeAgo(order.notificationDate)}</span>
                                  </p>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      <button
                        onClick={() => {
                          setActiveTab("notifications");
                          setNotificationsOpen(false);
                        }}
                        className={`w-full px-4 py-2 text-center text-sm font-semibold ${darkMode ? "text-red-300 hover:bg-slate-700" : "text-red-600 hover:bg-gray-50"}`}
                      >
                        View All
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="relative order-8 hidden lg:block">
              <button
                onClick={() => setActiveTab("profile")}
                className={`flex h-9 w-9 items-center justify-center rounded-full p-2 text-base font-semibold transition sm:h-10 sm:w-auto sm:gap-2 sm:px-4 sm:py-2 ${
                  activeTab === "profile"
                    ? darkMode
                      ? "border border-slate-700 bg-slate-800 text-white shadow-sm"
                      : "border border-slate-200 bg-slate-100 text-red-600 shadow-sm"
                    : darkMode
                      ? "text-slate-200 hover:bg-slate-800"
                      : "text-slate-700 hover:bg-slate-100"
                }`}
                aria-current={activeTab === "profile" ? "page" : undefined}
                aria-label="Profile"
                title="Profile"
              >
                <User size={20} className="sm:h-6 sm:w-6" />
                <span className="sr-only sm:not-sr-only">Profile</span>
              </button>

              {confirmOpen && createPortal(
                <div className="fixed inset-0 z-[100] flex min-h-screen items-center justify-center p-4">
                  <div className="logout-modal-backdrop-in absolute inset-0 bg-black/45 backdrop-blur-md" onClick={() => setConfirmOpen(false)} />
                  <div className={`logout-modal-in relative z-40 w-full max-w-sm rounded-2xl p-6 text-center shadow-2xl ${darkMode ? "bg-slate-800 text-white" : "bg-white text-slate-900"}`}>
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
                      <LogOut size={22} />
                    </div>
                    <h3 className="mt-4 text-lg font-semibold">Confirm Logout</h3>
                    <p className={`mt-2 text-sm ${darkMode ? "text-slate-300" : "text-gray-600"}`}>Are you sure you want to log out?</p>
                    <div className="mt-5 flex justify-center gap-2">
                      <button
                        onClick={() => setConfirmOpen(false)}
                        className={`rounded-lg px-3 py-1 ${darkMode ? "bg-slate-700 text-slate-100 hover:bg-slate-600" : "bg-gray-100 hover:bg-gray-200"}`}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleLogoutConfirm}
                        className="rounded-lg bg-red-600 px-3 py-1 text-white hover:bg-red-700"
                      >
                        Confirm
                      </button>
                    </div>
                  </div>
                </div>,
                document.body
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setConfirmOpen(true);
              }}
              className={`order-9 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition sm:h-10 sm:w-auto sm:gap-2 sm:px-3 ${darkMode ? "border-red-500/40 text-red-300 hover:bg-red-500/10" : "border-red-200 text-red-700 hover:bg-red-50"}`}
              aria-label="Log out"
              title="Log out"
            >
              <LogOut size={17} aria-hidden="true" />
              <span className="sr-only sm:not-sr-only">Log out</span>
            </button>
          </div>
        </div>
      </div>

      <nav
        aria-label="Customer navigation"
        className={`fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-[60] flex items-center justify-around rounded-[22px] border px-2 py-2 shadow-lg backdrop-blur-xl lg:hidden ${darkMode ? "border-slate-700 bg-slate-900/95 shadow-black/30" : "border-slate-200 bg-white/95 shadow-slate-900/15"}`}
      >
        {[
          { label: "Home", tab: "home", Icon: Home },
          { label: "Products", tab: "products", Icon: Package },
          { label: "Orders", tab: "orders", Icon: ClipboardList },
          ...(canRequestOrders ? [{ label: "Cart", tab: "cart", Icon: ShoppingCart }] : []),
          { label: "Profile", tab: "profile", Icon: User },
        ].map(({ label, tab, Icon }) => {
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => {
                setNotificationsOpen(false);
                setActiveTab(tab);
              }}
              aria-label={tab === "cart" && cartQuantity > 0 ? `Cart, ${cartQuantity} ${cartQuantity === 1 ? "item" : "items"}` : label}
              aria-current={isActive ? "page" : undefined}
              title={label}
              className={`flex h-12 min-w-12 flex-1 flex-col items-center justify-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${isActive ? darkMode ? "text-red-300" : "text-red-700" : darkMode ? "text-slate-300 hover:bg-slate-800" : "text-slate-600 hover:bg-slate-100"}`}
            >
              <span className="relative inline-flex">
                <Icon size={21} strokeWidth={isActive ? 2.3 : 1.8} aria-hidden="true" />
                {tab === "cart" && cartQuantity > 0 && (
                  <span
                    aria-hidden="true"
                    className={`absolute -right-2 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full border px-1 text-[9px] font-bold leading-none ${darkMode ? "border-slate-900 bg-red-500 text-white" : "border-white bg-red-600 text-white"}`}
                  >
                    {cartQuantity > 99 ? "99+" : cartQuantity}
                  </span>
                )}
              </span>
              <span className={`mt-1 h-0.5 w-4 rounded-full ${isActive ? "bg-current" : "bg-transparent"}`} aria-hidden="true" />
            </button>
          );
        })}
      </nav>

      {activeTab === "home" && (
        <>
          <section className="relative overflow-hidden bg-[#941d24] text-white">
            <div className="relative mx-auto flex min-h-[360px] max-w-7xl items-center justify-center px-6 py-16 text-center">
              <div className="max-w-2xl">
                <p className="text-sm font-semibold uppercase tracking-[0.28em] text-red-100">ACGC Services</p>
                <h2 className="mt-4 text-4xl font-black leading-tight sm:text-6xl">Custom Glass & Aluminum Solutions</h2>
                <p className="mx-auto mt-5 max-w-xl text-base leading-7 text-red-100 sm:text-lg">
                  Professional fabrication and installation of glass windows, doors, partitions, and aluminum works for your space.
                </p>
                <div className="mt-8 flex flex-wrap justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => setActiveTab("products")}
                    className="rounded-xl bg-white px-5 py-3 text-sm font-bold text-red-700 shadow-lg transition hover:bg-red-50"
                  >
                    Browse Products
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("orders")}
                    className="rounded-xl border border-white/70 px-5 py-3 text-sm font-bold text-white transition hover:bg-white/10"
                  >
                    View My Orders
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="relative z-10 mx-auto -mt-8 max-w-5xl px-6">
            <div className={`grid gap-6 rounded-3xl px-6 py-8 text-center shadow-xl sm:grid-cols-3 sm:px-10 ${darkMode ? "bg-slate-800 text-slate-100" : "bg-white text-slate-900"}`}>
              <div className="flex flex-col items-center">
                <ShieldCheck className={`h-12 w-12 ${darkMode ? "text-slate-100" : "text-slate-900"}`} strokeWidth={1.7} />
                <h3 className={`mt-4 text-xl font-black ${darkMode ? "text-white" : "text-slate-900"}`}>Quality Guaranteed</h3>
                <p className={`mt-2 text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`}>Premium materials and careful workmanship.</p>
              </div>
              <div className="flex flex-col items-center">
                <Clock3 className={`h-12 w-12 ${darkMode ? "text-slate-100" : "text-slate-900"}`} strokeWidth={1.7} />
                <h3 className={`mt-4 text-xl font-black ${darkMode ? "text-white" : "text-slate-900"}`}>Fast Turnaround</h3>
                <p className={`mt-2 text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`}>Efficient production for your project timeline.</p>
              </div>
              <div className="flex flex-col items-center">
                <Wrench className={`h-12 w-12 ${darkMode ? "text-slate-100" : "text-slate-900"}`} strokeWidth={1.7} />
                <h3 className={`mt-4 text-xl font-black ${darkMode ? "text-white" : "text-slate-900"}`}>Expert Installation</h3>
                <p className={`mt-2 text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`}>Professional site inspection and installation.</p>
              </div>
            </div>
          </section>
        </>
      )}

      {showFeaturedSection && (
        <div className={`max-w-7xl mx-auto px-6 py-8 ${darkMode ? "bg-slate-900" : "bg-gray-100"}`}>
          <div className={`rounded-[24px] border p-5 shadow-[0_14px_35px_rgba(148,163,184,0.12)] ${darkMode ? "border-slate-700 bg-slate-800" : "border-red-100 bg-white"}`}>
            <div className="mb-5 flex items-center justify-between gap-4">
              <div className="text-left">
                <h2 className={`text-3xl font-black leading-tight sm:text-5xl sm:leading-none ${darkMode ? "text-white" : "text-slate-900"}`}>
                  Featured <span className="text-red-500">Products</span>
                </h2>
                <p className={`mt-3 max-w-3xl text-sm leading-6 sm:mt-6 sm:text-lg sm:leading-normal ${darkMode ? "text-slate-300" : "text-slate-500"}`}>
                  Discover premium aluminum and glass solutions crafted for modern residential and commercial projects.
                </p>
              </div>
            </div>

            {featuredProductsError ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                {featuredProductsError}
              </div>
            ) : featuredProductsLoading ? (
              <div className="grid gap-4 md:grid-cols-3">
                {[...Array(3)].map((_, index) => (
                  <div key={index} className="h-72 animate-pulse rounded-[20px] bg-slate-100" />
                ))}
              </div>
            ) : featuredProducts.length === 0 ? (
              <div className={`rounded-2xl border border-dashed p-8 text-center ${darkMode ? "border-slate-600 bg-slate-700 text-slate-300" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
                No featured products are available right now.
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-3">
                {featuredProducts.map((product) => {
                  const reviewStats = productReviewStats[product._id || product.id] || { averageRating: 0, ratingsCount: 0 };
                  const averageRating = Number(reviewStats.averageRating) || 0;
                  const reviewsCount = Number(reviewStats.ratingsCount) || 0;

                  return (
                    <div
                      key={product._id || product.name}
                      className={`group overflow-hidden rounded-[20px] border shadow-[0_8px_22px_rgba(15,23,42,0.05)] ${
                        darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-slate-50"
                      }`}
                    >
                      <div className={`relative h-44 overflow-hidden ${darkMode ? "bg-slate-800" : "bg-slate-100"}`}>
                        <img
                          src={getProductImage(product)}
                          alt={product.name}
                          className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                        />
                        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-slate-900/25 to-transparent" />
                      </div>

                      <div className="space-y-3 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <span className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-[0.18em] ${
                            darkMode ? "bg-red-950/60 text-red-300" : "bg-red-50 text-red-700"
                          }`}>
                            {product.category || "Product"}
                          </span>
                          <span className="text-m font-bold text-red-500">{getProductPrice(product)}</span>
                        </div>

                        <div>
                          <h3 className={`text-xl font-bold leading-tight ${darkMode ? "text-white" : "text-slate-900"}`}>{product.name}</h3>
                          <p className={`mt-1 text-xs leading-5 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                            {product.description || "Premium aluminum and glass solution for modern spaces."}
                          </p>
                        </div>

                        {canUploadFeedback && canShowRatings && <div className="flex items-center justify-between gap-3 pt-1">
                          <div className="flex min-w-0 flex-col">
                            <div className="flex items-center gap-1 text-amber-500">
                              {renderRatingStars(averageRating, 14)}
                            </div>
                            <span className={`mt-1 text-[11px] font-medium ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                              {averageRating > 0 ? `${averageRating.toFixed(1)} (${reviewsCount} review${reviewsCount === 1 ? "" : "s"})` : "No reviews yet"}
                            </span>
                          </div>
                        </div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {canShowRatings && canUploadFeedback && <section className={`mt-8 rounded-3xl px-6 py-8 shadow-sm sm:px-10 ${darkMode ? "bg-slate-800 text-slate-100" : "bg-white text-slate-900"}`}>
            <h2 className={`text-center text-3xl font-black ${darkMode ? "text-white" : "text-slate-900"}`}>Customer Ratings</h2>
            <div className="mt-8 grid gap-8 md:grid-cols-[220px_1fr] md:items-center">
              <div className="text-center">
                <p className={`text-6xl font-black leading-none ${darkMode ? "text-white" : "text-slate-950"}`}>
                  {featuredRatingStats.average.toFixed(1)}
                </p>
                <div className="mt-3 flex justify-center gap-1 text-amber-500">
                  {renderRatingStars(featuredRatingStats.average, 22)}
                </div>
                <p className={`mt-3 text-sm font-semibold ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                  Average Rating ({featuredRatingStats.total} review{featuredRatingStats.total === 1 ? "" : "s"})
                </p>
              </div>

              <div className="space-y-3">
                {[5, 4, 3, 2, 1].map((star) => {
                  const count = featuredRatingStats.counts[star] || 0;
                  const percentage = featuredRatingStats.total
                    ? Math.round((count / featuredRatingStats.total) * 100)
                    : 0;
                  return (
                    <div key={star} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 text-sm">
                      <span className={`font-semibold ${darkMode ? "text-slate-300" : "text-slate-600"}`}>{star}</span>
                      <div className={`h-3 overflow-hidden rounded-full ${darkMode ? "bg-slate-700" : "bg-slate-100"}`}>
                        <div
                          className="h-full rounded-full bg-amber-400 transition-all"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                      <span className={`w-12 text-right font-semibold ${darkMode ? "text-slate-300" : "text-slate-500"}`}>{percentage}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>}
        </div>
      )}

      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col p-3 sm:p-4 md:p-6">
        {activeTab === "products" && (
          <>
            <div>
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6">
                <div>
                  <h2 className={`text-3xl font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>Products</h2>
                  <p className={darkMode ? "text-slate-300" : "text-gray-500"}>Browse available aluminum & glass products</p>
                </div>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-end w-full max-w-3xl">
                  <div className="relative w-full sm:w-80">
                    <Search size={18} className="absolute left-3 top-3 text-gray-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search products..."
                      className={`w-full pl-10 pr-4 py-3 border rounded-2xl ${darkMode ? "border-slate-700 bg-slate-800 text-white placeholder:text-slate-400" : "border-slate-200 bg-white text-slate-900"}`}
                    />
                  </div>
                  <div className="w-full sm:w-56">
                    <select
                      value={categoryFilter}
                      onChange={(e) => setCategoryFilter(e.target.value)}
                      className={`w-full border rounded-2xl py-3 px-4 ${darkMode ? "border-slate-700 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-900"}`}
                    >
                      <option value="All">All categories</option>
                        <option value="Windows">Windows</option>
                        <option value="Doors">Doors</option>
                        <option value="Cabinets">Cabinets</option>
                        <option value="Shower Enclosures">Shower Enclosures</option>
                        <option value="Aluminum">Aluminum</option>
                        <option value="Glass">Glass</option>
                        <option value="Accessories">Accessories</option>
                    </select>
                  </div>
                </div>
              </div>

              {productError && <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">{productError}</div>}

              {isLoadingProducts ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">{[...Array(6)].map((_, i) => <div key={i} className="animate-pulse bg-white rounded-3xl p-6 h-96" />)}</div>
              ) : products.length === 0 ? (
                <div className={`rounded-3xl p-10 text-center shadow ${darkMode ? "bg-slate-800 text-slate-200" : "bg-white text-gray-600"}`}><p className={darkMode ? "text-slate-300" : "text-gray-600"}>No products matched your search.</p></div>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
                    {displayedProducts.map((product) => (
                      <div
                        key={product._id || product.name}
                        className={`group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-2xl border shadow-[0_12px_30px_rgba(15,23,42,0.12)] transition duration-300 ease-out hover:-translate-y-1 ${
                          darkMode
                            ? "border-slate-700 bg-slate-800/95 hover:border-red-400/60 hover:shadow-[0_22px_45px_rgba(15,23,42,0.55)]"
                            : "border-slate-200 bg-white hover:border-red-200 hover:shadow-[0_22px_45px_rgba(127,29,29,0.16)]"
                        }`}
                        onClick={() => handleViewProduct(product)}
                      >
                      <div className="relative h-64 overflow-hidden bg-slate-100">
                        <img src={getProductImage(product)} alt={product.name} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
                        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/45 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                          <span className="rounded-full border border-white/40 bg-white/95 px-4 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-slate-900 shadow-lg">
                            Click to see product details
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-1 flex-col justify-between gap-5 p-5">
                        <div className="space-y-3">
                          <span className={`inline-flex items-center rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${darkMode ? "bg-red-950/70 text-red-300" : "bg-red-50 text-red-700"}`}>
                            {product.category ? product.category.charAt(0).toUpperCase() + product.category.slice(1) : "General"}
                          </span>
                          <div>
                            <h3 className={`text-xl font-black leading-tight ${darkMode ? "text-white" : "text-slate-900"}`}>{product.name}</h3>
                            <p className={`mt-1.5 text-xs font-medium uppercase tracking-[0.12em] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{product.product_type || product.category || "General"}</p>
                          </div>
                          {canUploadFeedback && <div className={`flex items-center gap-2 text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                            {renderRatingStars(productReviewStats[product._id || product.id]?.averageRating || 0, 16)}
                            <span className={darkMode ? "font-medium text-slate-200" : "font-medium text-slate-700"}>
                              {productReviewStats[product._id || product.id]?.averageRating > 0
                                ? `${productReviewStats[product._id || product.id].averageRating.toFixed(1)} (${productReviewStats[product._id || product.id].ratingsCount} rating${productReviewStats[product._id || product.id].ratingsCount === 1 ? "" : "s"})`
                                : "No ratings yet"}
                            </span>
                          </div>}
                          <div className={`space-y-2 text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                            {product.dimensions ? (
                              <p><span className={darkMode ? "font-medium text-white" : "font-medium text-slate-900"}>Dimensions:</span> {product.dimensions}</p>
                            ) : product.standard_size ? (
                              <p><span className={darkMode ? "font-medium text-white" : "font-medium text-slate-900"}>Dimensions:</span> {product.standard_size}</p>
                            ) : product.width && product.height ? (
                              <p><span className={darkMode ? "font-medium text-white" : "font-medium text-slate-900"}>Dimensions:</span> {product.width} × {product.height}</p>
                            ) : null}
                            <p><span className={darkMode ? "font-medium text-white" : "font-medium text-slate-900"}>Unit Rate:</span> {getProductUnitRate(product)}</p>
                          </div>
                        </div>
                        <div className="mt-auto space-y-3">
                          <div className={`border-t pt-4 ${darkMode ? "border-slate-700" : "border-slate-100"}`}>
                            <p className="text-2xl font-black text-red-500">{getProductPrice(product)}</p>
                          </div>
                          {canRequestOrders && <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openOrderNowModal(product);
                              }}
                              className={`inline-flex items-center justify-center gap-1 rounded-xl border bg-transparent px-2 py-2 text-[11px] font-bold shadow-sm transition ${darkMode ? "border-red-400/50 text-red-300 hover:border-red-300 hover:bg-red-900/40 hover:text-red-200" : "border-red-200 text-red-700 hover:bg-red-100"}`}
                              aria-label="Place order"
                              title="Place order"
                            >
                              <Package size={28} />
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleAddToCart(product);
                              }}
                              className={`inline-flex items-center justify-center gap-1 rounded-xl border bg-transparent px-2 py-2 text-[11px] font-bold shadow-sm transition ${darkMode ? "border-slate-600 text-slate-200 hover:bg-slate-700 hover:text-white" : "border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900"}`}
                              aria-label="Add to cart"
                              title="Add to cart"
                            >
                              <ShoppingCart size={28} />
                            </button>
                          </div>}
                        </div>
                      </div>
                    </div>
                    ))}
                  </div>

                  {products.length > 0 && !isMobile && (
                    <div className={`mt-8 grid gap-4 rounded-[20px] border p-4 shadow-[0_12px_30px_rgba(15,23,42,0.06)] md:grid-cols-[1fr_auto_1fr] md:items-center ${
                      darkMode ? "border-slate-700 bg-slate-800" : "border-red-100 bg-white"
                    }`}>
                      <div className={`flex items-center gap-3 text-sm font-medium ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                        <span>Items per page</span>
                        <select
                          value={productsPerPage}
                          onChange={(event) => setProductsPerPage(Number(event.target.value))}
                          className={`rounded-xl border px-3 py-2 text-sm font-semibold outline-none transition ${
                            darkMode
                              ? "border-slate-600 bg-slate-700 text-slate-100 focus:border-red-400 focus:ring-2 focus:ring-red-500/30"
                              : "border-red-200 bg-red-50 text-slate-800 focus:border-red-300 focus:ring-2 focus:ring-red-100"
                          }`}
                        >
                          <option value={4}>4</option>
                          <option value={8}>8</option>
                          <option value={12}>12</option>
                          <option value={16}>16</option>
                        </select>
                      </div>

                      {products.length > 0 && (
                        <div className="flex items-center justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => setProductPage((page) => Math.max(1, page - 1))}
                            disabled={paginatedProducts.currentPage === 1}
                            className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                              darkMode
                                ? "border-slate-600 bg-slate-700 text-slate-100 hover:border-red-400 hover:text-red-300 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
                                : "border-slate-200 bg-white text-slate-700 hover:border-red-200 hover:text-red-600 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                            }`}
                          >
                            Previous
                          </button>

                          <div className="flex items-center gap-1">
                            {Array.from({ length: Math.max(1, paginatedProducts.totalPages) }, (_, index) => index + 1).map((pageNumber) => (
                              <button
                                key={pageNumber}
                                type="button"
                                onClick={() => setProductPage(pageNumber)}
                                className={`h-9 min-w-9 rounded-xl px-2 text-sm font-bold transition ${
                                  pageNumber === paginatedProducts.currentPage
                                    ? "bg-red-600 text-white shadow-sm"
                                    : darkMode
                                      ? "border border-slate-600 bg-slate-700 text-slate-100 hover:border-red-400 hover:text-red-300"
                                      : "border border-slate-200 bg-white text-slate-700 hover:border-red-200 hover:text-red-600"
                                }`}
                              >
                                {pageNumber}
                              </button>
                            ))}
                          </div>

                          <button
                            type="button"
                            onClick={() => setProductPage((page) => Math.min(Math.max(1, paginatedProducts.totalPages), page + 1))}
                            disabled={paginatedProducts.currentPage >= paginatedProducts.totalPages}
                            className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                              darkMode
                                ? "border-slate-600 bg-slate-700 text-slate-100 hover:border-red-400 hover:text-red-300 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
                                : "border-slate-200 bg-white text-slate-700 hover:border-red-200 hover:text-red-600 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                            }`}
                          >
                            Next
                          </button>
                        </div>
                      )}

                      <div className={`text-right text-sm font-medium ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                        Showing {paginatedProducts.items.length ? (paginatedProducts.currentPage - 1) * productsPerPage + 1 : 0}
                        {paginatedProducts.items.length ? `-${Math.min(paginatedProducts.currentPage * productsPerPage, products.length)}` : ""} of {products.length} products
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {selectedProduct && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-4">
                <div className={`order-flow-modal relative flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ${darkMode ? "order-flow-modal-dark" : ""}`}>
                  {/* Header with cleaner elevated styling */}
                  {!isProductModalReadOnly && (
                    <div className="flex-shrink-0 border-b border-red-500/30 bg-gradient-to-r from-red-600 via-red-600 to-red-700 px-5 py-4 shadow-[0_12px_24px_rgba(220,38,38,0.18)] sm:px-6">
                      <div className="flex min-w-0 items-center justify-between gap-4">
                        <div className="flex min-w-0 items-center gap-3 text-white">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/12 ring-1 ring-white/20 backdrop-blur-sm">
                            <Package size={20} aria-hidden="true" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-red-100/90">Product details</p>
                            <h3 className="truncate text-lg font-black sm:text-2xl">{selectedProduct.name}</h3>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={closeProductModal}
                          aria-label="Close product details"
                          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-white/60"
                        >
                          <X size={20} aria-hidden="true" />
                        </button>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-white/25 bg-white/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-red-50">
                          {selectedProduct.category || selectedProduct.product_type || "General"}
                        </span>
                        <span className="text-xs text-red-100/90">Ready for inquiry</span>
                      </div>
                    </div>
                  )}
                  {isProductModalReadOnly && (
                    <button
                      type="button"
                      onClick={closeProductModal}
                      aria-label="Close product details"
                      className={`absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full shadow-md transition ${darkMode ? "bg-slate-800 text-slate-200 hover:bg-slate-700" : "bg-white text-slate-700 hover:bg-slate-100"}`}
                    >
                      <X size={18} aria-hidden="true" />
                    </button>
                  )}

                  {/* Scrollable Content */}
                  <div className="flex-1 overflow-y-auto">
                    <div className={`grid items-start gap-5 p-4 sm:p-5 ${isProductModalReadOnly ? "md:grid-cols-[minmax(0,1.1fr)_minmax(300px,0.9fr)] lg:gap-8 lg:p-7" : "md:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.9fr)] lg:gap-7 lg:p-6"}`}>
                      {/* Left: Product Image & Description */}
                      <div className={`min-w-0 space-y-4 ${isProductModalReadOnly ? darkMode ? "rounded-xl bg-slate-800 p-2" : "rounded-xl bg-slate-50 p-2" : ""}`}>
                        <div className="space-y-2">
                          <div className="overflow-hidden rounded-2xl bg-slate-100 shadow-sm">
                            <img
                              src={activeProductImage.url}
                              alt={`${selectedProduct.name} - ${activeProductImage.label}`}
                              className="aspect-[4/3] max-h-[300px] w-full object-cover"
                              onError={(event) => {
                                event.currentTarget.onerror = null;
                                event.currentTarget.src = PRODUCT_IMAGE_PLACEHOLDER;
                              }}
                            />
                          </div>
                          {selectedProductImages.length > 1 && (
                            <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Product photo angles">
                              {selectedProductImages.map((image, index) => (
                                <button
                                  key={`${image.url}-${index}`}
                                  type="button"
                                  onClick={() => setSelectedProductImageIndex(index)}
                                  aria-label={`View ${image.label}`}
                                  aria-pressed={selectedProductImageIndex === index}
                                  className={`h-16 w-20 shrink-0 overflow-hidden rounded-lg border-2 transition ${selectedProductImageIndex === index ? "border-red-600" : "border-transparent hover:border-red-300"}`}
                                >
                                  <img src={image.url} alt="" className="h-full w-full object-cover" />
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        {!isProductModalReadOnly && <>
                        <div className={`rounded-2xl border p-4 ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-slate-50"}`}>
                            <h4 className={`text-base font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>Product Details</h4>
                            <p className={`mt-1.5 text-sm leading-6 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                              {selectedProduct.description || "No description available."}
                            </p>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-3">
                          <div className={`min-w-0 rounded-xl border p-3 ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-white"}`}>
                            <p className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Type</p>
                            <p className={`mt-1 truncate text-sm font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>{selectedProduct.type || selectedProduct.product_type || "N/A"}</p>
                          </div>
                          <div className={`min-w-0 rounded-xl border p-3 ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-white"}`}>
                            <p className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Dimensions</p>
                            <p className={`mt-1 truncate text-sm font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>
                              {selectedProduct.dimensions
                                ? selectedProduct.dimensions
                                : selectedProduct.standard_size
                                ? selectedProduct.standard_size
                                : selectedProduct.width > 0 || selectedProduct.height > 0
                                ? `${selectedProduct.width || 0}" x ${selectedProduct.height || 0}"`
                                : "N/A"}
                            </p>
                          </div>
                          <div className={`min-w-0 rounded-xl border p-3 ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-white"}`}>
                            <p className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Unit Rate</p>
                            <p className={`mt-1 truncate text-sm font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>{getProductUnitRate(selectedProduct)}</p>
                          </div>
                        </div>
                        </>}
                      </div>

                      {/* Right: Action Buttons & Info */}
                      <div className={`min-w-0 space-y-3 ${isProductModalReadOnly ? darkMode ? "rounded-xl bg-slate-900 p-4 sm:p-5" : "rounded-xl bg-white p-4 sm:p-5" : ""}`}>
                        {isProductModalReadOnly && (
                          <>
                            <div className="flex flex-wrap items-center gap-2 pr-10">
                              <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${darkMode ? "bg-red-950/60 text-red-300" : "bg-red-50 text-red-800"}`}>
                                {selectedProduct.product_type || selectedProduct.type || "Glass & Aluminum"}
                              </span>
                              <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600"}`}>
                                {selectedProduct.category || "General"}
                              </span>
                            </div>
                            <h3 className={`text-2xl font-black leading-tight ${darkMode ? "text-white" : "text-slate-900"}`}>
                              {selectedProduct.name}
                            </h3>
                            <p className={`text-xl font-black ${darkMode ? "text-white" : "text-slate-900"}`}>
                              {getProductUnitRate(selectedProduct)}
                            </p>
                            <div className={`border-t pt-4 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                              <p className={`text-sm font-medium ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                                {selectedProductDimensions}
                              </p>
                              <p className={`mt-4 whitespace-pre-line text-sm leading-6 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                                {selectedProduct.description || "No description available."}
                              </p>
                            </div>
                            {!canRequestOrders && (
                              <div className={`flex items-center justify-center gap-2 border-y py-4 text-xs ${darkMode ? "border-slate-700 text-slate-400" : "border-slate-100 text-slate-400"}`}>
                                <Phone size={14} aria-hidden="true" />
                                <span>Call for inquiries: <strong className={darkMode ? "text-slate-300" : "text-slate-600"}>09123456789</strong></span>
                              </div>
                            )}
                          </>
                        )}
                        {/* Price Card */}
                        {!isProductModalReadOnly && <div className={`rounded-2xl border p-4 ${darkMode ? "border-red-900 bg-red-950/40" : "border-red-200 bg-red-50"}`}>
                          <p className={`text-[10px] font-bold uppercase tracking-[0.18em] ${darkMode ? "text-red-200" : "text-slate-500"}`}>Starting from</p>
                          <p className={`mt-1 text-3xl font-black ${darkMode ? "text-white" : "text-red-700"}`}>{getProductPrice(selectedProduct)}</p>
                          <p className={`mt-1 text-[11px] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Price may vary based on specifications</p>
                        </div>}

                        {canEstimatePricing && <section className={`overflow-hidden rounded-xl border border-t-2 p-3.5 ${darkMode ? "border-slate-700 border-t-red-500 bg-slate-900" : "border-slate-200 border-t-red-600 bg-white"}`} aria-labelledby="product-estimator-title">
                          <div className="flex items-center gap-2">
                            <Ruler size={16} className="text-red-600" aria-hidden="true" />
                            <h4 id="product-estimator-title" className={`text-sm font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>Price Estimator</h4>
                          </div>
                          <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_minmax(88px,0.8fr)]">
                            <label className="min-w-0">
                              <span className={`mb-1 block text-[9px] font-bold uppercase tracking-wider ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Width</span>
                              <input
                                type="number"
                                min="0"
                                step="any"
                                value={productEstimatorForm.width}
                                onChange={(event) => setProductEstimatorForm((current) => ({ ...current, width: event.target.value }))}
                                className={`h-9 w-full rounded-lg border px-2 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/15 ${darkMode ? "border-slate-600 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-900"}`}
                              />
                            </label>
                            <span className={`mt-6 text-sm ${darkMode ? "text-slate-500" : "text-slate-400"}`} aria-hidden="true">×</span>
                            <label className="min-w-0">
                              <span className={`mb-1 block text-[9px] font-bold uppercase tracking-wider ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Height</span>
                              <input
                                type="number"
                                min="0"
                                step="any"
                                value={productEstimatorForm.height}
                                onChange={(event) => setProductEstimatorForm((current) => ({ ...current, height: event.target.value }))}
                                className={`h-9 w-full rounded-lg border px-2 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/15 ${darkMode ? "border-slate-600 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-900"}`}
                              />
                            </label>
                            <label className="col-span-3 min-w-0 sm:col-span-1">
                              <span className={`mb-1 block text-[9px] font-bold uppercase tracking-wider ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Unit</span>
                              <select
                                value={productEstimatorForm.unit}
                                onChange={(event) => setProductEstimatorForm((current) => ({ ...current, unit: event.target.value }))}
                                className={`h-9 w-full rounded-lg border px-2 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/15 ${darkMode ? "border-slate-600 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-900"}`}
                              >
                                <option value="in">in</option>
                                <option value="cm">cm</option>
                                <option value="m">m</option>
                              </select>
                            </label>
                          </div>
                          {productEstimatorWidth > 0 && productEstimatorHeight > 0 ? (
                            <div className={`mt-4 space-y-3 text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`} aria-live="polite">
                              <div className="flex items-center justify-between gap-3">
                                <span className="inline-flex items-center gap-2"><Ruler size={13} aria-hidden="true" />Area</span>
                                <span className={`font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>
                                  {Number(productEstimatorResult?.estimated_area) > 0
                                    ? `${Number(productEstimatorResult.estimated_area).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} sq ft`
                                    : productEstimatorResult?.areaDisplay || "—"}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-3">
                                <span>Base Rate</span>
                                <span className={`font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>
                                  {Number(productEstimatorResult?.rate) > 0
                                    ? `${formatCurrency(productEstimatorResult.rate)} / ${productEstimatorResult?.areaDisplay?.includes("blade") ? "blade" : Number(productEstimatorResult?.estimated_area) > 0 ? "sq ft" : "unit"}`
                                    : "Contact us"}
                                </span>
                              </div>
                              <div className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-3 ${darkMode ? "border-red-900 bg-slate-800 text-red-300" : "border-red-100 bg-white text-red-800"}`}>
                                <span className="font-bold">Estimated Total</span>
                                <span className="text-base font-black">
                                  {Number(productEstimatorResult?.estimated_price) > 0
                                    ? formatCurrency(productEstimatorResult.estimated_price)
                                    : "Contact us"}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-3 px-1">
                                <span>50% Downpayment</span>
                                <span className={`font-bold ${darkMode ? "text-red-300" : "text-red-800"}`}>
                                  {Number(productEstimatorResult?.estimated_price) > 0
                                    ? formatCurrency(productEstimatorResult.estimated_price * 0.5)
                                    : "Contact us"}
                                </span>
                              </div>
                            </div>
                          ) : (
                            <div className={`mt-3 flex min-h-12 items-center justify-center rounded-lg px-3 py-2.5 text-center text-xs ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-50 text-slate-500"}`}>
                              Enter width &amp; height to calculate your estimate.
                            </div>
                          )}
                          <p className={`mt-2 text-[11px] font-bold leading-4 ${darkMode ? "text-slate-500" : "text-slate-700"}`}>
                            Final pricing is subject to negotiation during shop discussion or on-site inspection.
                          </p>
                        </section>}

                        {/* Action Buttons */}
                        {canRequestOrders && <>
                        <button
                          type="button"
                          onClick={() => {
                            const hasEstimate =
                              Number(productEstimatorForm.width) > 0 &&
                              Number(productEstimatorForm.height) > 0 &&
                              Number(productEstimatorResult?.estimated_price) > 0;
                            if (hasEstimate) {
                              openEstimatedProductOrder(selectedProduct);
                            } else {
                              openOrderNowModal(selectedProduct);
                            }
                            closeProductModal();
                          }}
                          className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-red-700"
                        >
                          <Package size={20} />
                          Place Order
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            const hasEstimate =
                              Number(productEstimatorForm.width) > 0 &&
                              Number(productEstimatorForm.height) > 0 &&
                              Number(productEstimatorResult?.estimated_price) > 0;

                            if (hasEstimate) {
                              if (!canEstimatePricing) {
                                showPermissionNotice("Pricing estimates are disabled for your account.");
                                return;
                              }
                              handleAddEstimateToCart({
                                product: selectedProduct,
                                width: productEstimatorForm.width,
                                height: productEstimatorForm.height,
                                quantity: 1,
                                notes: "",
                                measurementUnit: productEstimatorForm.unit,
                              });
                            } else {
                              if (!canRequestOrders) {
                                showPermissionNotice("Order requests are disabled for your account.");
                                return;
                              }
                              handleAddToCart(selectedProduct);
                            }
                            closeProductModal();
                          }}
                          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#101114] py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#050608]"
                        >
                          <ShoppingCart size={20} />
                          Add to Cart
                        </button>
                        </>}

                        {canUploadFeedback && (
                          <>
                            <button
                              type="button"
                              onClick={openProductReviewModal}
                              aria-label={`View customer reviews for ${selectedProduct?.name || "this product"}`}
                              className={`group mt-2 w-full rounded-xl border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-md ${darkMode ? "border-slate-700 bg-slate-800 hover:border-slate-600" : "border-slate-200 bg-white hover:border-slate-300"}`}
                            >
                              <div className="flex min-w-0 items-center gap-3">
                                <div className={`h-12 w-12 shrink-0 overflow-hidden rounded-lg border ${darkMode ? "border-slate-600 bg-slate-700" : "border-slate-200 bg-slate-50"}`}>
                                  <img src={getProductImage(selectedProduct)} alt={selectedProduct?.name || "Product"} className="h-full w-full object-cover" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <p className={`text-[10px] font-bold uppercase tracking-[0.16em] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Customer Reviews</p>
                                    <ArrowRight size={15} className={`shrink-0 transition-transform group-hover:translate-x-0.5 ${darkMode ? "text-slate-400" : "text-slate-500"}`} aria-hidden="true" />
                                  </div>
                                  <div className="mt-1 flex items-center gap-2">
                                    <span className="inline-flex items-center gap-0.5">{renderRatingStars(averageProductReviewRating, 14)}</span>
                                    <span className={`text-sm font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>
                                      {productReviewAverageRating ? `${productReviewAverageRating} / 5` : "— / 5"}
                                    </span>
                                  </div>
                                  <p className={`mt-1 truncate text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                                    {productReviews[0]?.title || (totalRatedReviews ? "Read the latest customer feedback" : "No reviews yet")}
                                  </p>
                                </div>
                              </div>
                              <div className={`mt-3 flex items-center justify-between gap-3 border-t pt-2.5 text-xs ${darkMode ? "border-slate-700 text-slate-300" : "border-slate-100 text-slate-600"}`}>
                                <span className={`rounded-full border px-2.5 py-1 font-medium ${darkMode ? "border-slate-600 bg-slate-700" : "border-slate-200 bg-slate-50"}`}>
                                  {totalRatedReviews} rating{totalRatedReviews === 1 ? "" : "s"}
                                </span>
                                <span className={`font-semibold ${darkMode ? "text-white" : "text-slate-900"}`}>
                                  View reviews
                                </span>
                              </div>
                            </button>
                            {!canRequestOrders && (
                              <div className={`mt-2 flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-semibold ${darkMode ? "border-slate-700 bg-slate-800 text-slate-300" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
                                <Phone size={14} aria-hidden="true" />
                                <span>Call for inquiries: <strong className={darkMode ? "text-slate-100" : "text-slate-900"}>09123456789</strong></span>
                              </div>
                            )}
                          </>
                        )}
                        {!canUploadFeedback && (
                          <div className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-xs ${darkMode ? "border-slate-700 bg-slate-800 text-slate-400" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
                            <Info size={14} aria-hidden="true" />
                            <span>Customer feedback and reviews will be available soon.</span>
                          </div>
                        )}

                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {showCartDecisionModal && canRequestOrders && cartDecisionProduct && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4">
                <div className={`order-flow-modal w-full max-h-[95vh] max-w-4xl rounded-3xl bg-white shadow-2xl overflow-hidden flex flex-col ${darkMode ? "order-flow-modal-dark" : ""}`}>
                  {/* Sticky Header with Gradient */}
                  <div className="flex-shrink-0 bg-gradient-to-r from-red-600 to-red-700 px-6 py-5">
                    <div className="flex items-center justify-between gap-4">
                      <div className="text-white">
                        <h3 className="text-2xl font-bold flex items-center gap-2">
                          <ShoppingCart size={28} />
                          {cartDecisionStep === "choice" ? "Choose Your Option" : "Get an Estimate"}
                        </h3>
                        <p className="text-red-100 mt-1">{cartDecisionStep === "choice" ? "Decide how to add this product to your cart" : "Enter measurements for a personalized estimate"}</p>
                      </div>
                      <button onClick={closeCartDecisionModal} className="text-white hover:bg-red-800 p-2 rounded-full transition">
                        <span className="text-3xl">×</span>
                      </button>
                    </div>
                  </div>

                  {/* Scrollable Content */}
                  <div className="flex-1 overflow-y-auto">
                    {cartDecisionStep === "choice" ? (
                      // CHOICE STEP
                      <div className="px-6 py-8 space-y-6">
                        {/* Product Preview Card */}
                        <div className="rounded-2xl border-2 border-white-200 bg-gray-100 p-6">
                          <div className="flex items-center gap-4">
                            <img src={getProductImage(cartDecisionProduct)} alt={cartDecisionProduct.name} className="w-28 h-28 rounded-2xl object-cover bg-white shadow-md flex-shrink-0" />
                            <div className="flex-1">
                              <p className="text-sm text-slate-600 font-medium">Selected Product</p>
                              <h4 className="text-2xl font-bold text-slate-900 mt-1">{cartDecisionProduct.name}</h4>
                              <p className="text-lg text-red-600 font-bold mt-2">{getProductPrice(cartDecisionProduct)}</p>
                            </div>
                          </div>
                        </div>

                        {/* Option Cards */}
                        <div className={`grid gap-4 ${canEstimatePricing ? "sm:grid-cols-1 lg:grid-cols-2" : "grid-cols-1"}`}>
                          {/* Estimate Option */}
                          {canEstimatePricing && <button
                            onClick={handleCartDecisionEstimate}
                            className="group relative rounded-2xl overflow-hidden transition-all duration-300 hover:shadow-xl"
                          >
                            <div className="absolute inset-0 bg-gray-600 transition" />
                            <div className="relative px-6 py-8 text-left text-white">
                              <div className="flex items-start justify-between mb-3">
                                <Ruler size={32} className="text-white" />
                                <ArrowRight size={24} className="text-white" />
                              </div>
                              <p className="text-xl font-bold mb-2">Estimate First</p>
                              <p className="text-sm text-red-50 leading-relaxed">Enter your measurements to get an accurate price before adding to cart</p>
                            </div>
                          </button>}

                          {/* Add to Cart Option */}
                          <button
                            onClick={handleCartDecisionNoAdd}
                            className="group relative rounded-2xl overflow-hidden transition-all duration-300 hover:shadow-xl"
                          >
                            <div className="absolute inset-0 bg-[#101114] transition" />
                            <div className="relative px-6 py-8 text-left text-white">
                              <div className="flex items-start justify-between mb-3">
                                <CheckCircle size={32} className="text-white" />
                                <ArrowRight size={24} className="text-white" />
                              </div>
                              <p className="text-xl font-bold mb-2">Add to Cart Now</p>
                              <p className="text-sm text-slate-200 leading-relaxed">Skip the estimate and add this product at the standard price</p>
                            </div>
                          </button>
                        </div>

                        {/* Cancel */}
                        <button
                          onClick={closeCartDecisionModal}
                          className="w-full rounded-2xl border-2 border-gray-200 bg-white text-gray-700 font-semibold py-3 hover:bg-gray-50 transition"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      // ESTIMATE STEP
                      <div className="px-6 py-8 space-y-6">
                        {/* Product Compact Card */}
                        <div className="flex items-center gap-3 rounded-xl bg-gray-50 p-4 border border-gray-200">
                          <img src={getProductImage(cartDecisionProduct)} alt={cartDecisionProduct.name} className="w-16 h-16 rounded-lg object-cover bg-white" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-600">Estimating for</p>
                            <p className="font-semibold text-gray-900 truncate">{cartDecisionProduct.name}</p>
                          </div>
                          <button
                            onClick={() => setCartDecisionStep("choice")}
                            className="text-red-600 hover:text-red-700 text-sm font-medium whitespace-nowrap ml-2"
                          >
                            Change
                          </button>
                        </div>

                        {/* Input Form - Card Based */}
                        <div className="grid gap-6 lg:grid-cols-2">
                          {/* Left: Input Fields */}
                          <div className="space-y-5">
                            <div>
                              <label className="block">
                                <div className="flex items-center gap-2 mb-2">
                                  <Ruler size={39} className="text-red-600" />
                                  <span className="text-sm font-semibold text-gray-700">Measurement Unit</span>
                                </div>
                                <select
                                  name="unit"
                                  value={estimateForm.unit}
                                  onChange={handleEstimateFormChange}
                                  className="w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-200 transition text-lg"
                                >
                                  <option value="in">Inches (in)</option>
                                  <option value="ft">Feet (ft)</option>
                                  <option value="cm">Centimeters (cm)</option>
                                  <option value="m">Meters (m)</option>
                                </select>
                              </label>
                            </div>

                            <div>
                              <label className="block">
                                <div className="flex items-center gap-2 mb-2">
                                  <Ruler size={39} className="text-red-600" />
                                  <span className="text-sm font-semibold text-gray-700">Width ({estimateForm.unit})</span>
                                </div>
                                <input
                                  type="number"
                                  name="width"
                                  min="0"
                                  value={estimateForm.width}
                                  onChange={handleEstimateFormChange}
                                  placeholder="0"
                                  className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-200 transition text-lg"
                                />
                                {estimateFormErrors.width && <p className="mt-2 text-sm text-red-600">{estimateFormErrors.width}</p>}
                              </label>
                            </div>

                            <div>
                              <label className="block">
                                <div className="flex items-center gap-2 mb-2">
                                  <Ruler size={39} className="text-red-600 rotate-90" />
                                  <span className="text-sm font-semibold text-gray-700">Height ({estimateForm.unit})</span>
                                </div>
                                <input
                                  type="number"
                                  name="height"
                                  min="0"
                                  value={estimateForm.height}
                                  onChange={handleEstimateFormChange}
                                  placeholder="0"
                                  className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-200 transition text-lg"
                                />
                                {estimateFormErrors.height && <p className="mt-2 text-sm text-red-600">{estimateFormErrors.height}</p>}
                              </label>
                            </div>

                            <div>
                              <label className="block">
                                <div className="flex items-center gap-2 mb-2">
                                  <Package size={39} className="text-red-600" />
                                  <span className="text-sm font-semibold text-gray-700">Quantity</span>
                                </div>
                                <input
                                  type="number"
                                  name="quantity"
                                  value={estimateForm.quantity}
                                  min="1"
                                  onChange={handleEstimateFormChange}
                                  className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-200 transition text-lg"
                                />
                              </label>
                            </div>

                            <div>
                              <label className="block">
                                <div className="flex items-center gap-2 mb-2">
                                  <Info size={39} className="text-yellow-600" />
                                  <span className="text-sm font-semibold text-gray-700 ">Notes (optional)</span>
                                </div>
                                <textarea
                                  name="notes"
                                  value={estimateForm.notes}
                                  onChange={handleEstimateFormChange}
                                  placeholder="Add any special instructions or details..."
                                  className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 min-h-[100px] focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-200 transition resize-none"
                                />
                              </label>
                            </div>
                          </div>

                          {/* Right: Calculation Display */}
                          <div className="space-y-4">
                            {/* Measurements Summary */}
                            <div className="rounded-2xl bg-white-100 border-2 border-gray-200 p-5">
                              <div className="flex items-center gap-2 mb-3">
                                <Ruler size={20} className="text-black-600" />
                                <h4 className="font-bold text-black-900">Measurements</h4>
                              </div>
                              <div className="space-y-3 text-sm">
                                <div className="flex justify-between items-center p-3 bg-white rounded-lg">
                                  <span className="text-black-600">Selected Unit</span>
                                  <span className="font-bold text-black-900">{estimateForm.unit === 'in' ? 'Inches' : estimateForm.unit === 'ft' ? 'Feet' : estimateForm.unit === 'cm' ? 'Centimeters' : 'Meters'}</span>
                                </div>
                                <div className="flex justify-between items-center p-3 bg-white rounded-lg">
                                  <span className="text-black-600">Width</span>
                                  <span className="font-bold text-black-900">{estimateForm.width ? `${estimateForm.width} ${estimateForm.unit}` : '—'}</span>
                                </div>
                                <div className="flex justify-between items-center p-3 bg-white rounded-lg">
                                  <span className="text-black-600">Height</span>
                                  <span className="font-bold text-black-900">{estimateForm.height ? `${estimateForm.height} ${estimateForm.unit}` : '—'}</span>
                                </div>
                                <div className="flex justify-between items-center p-3 bg-white rounded-lg">
                                  <span className="text-black-600">Area per unit</span>
                                  <span className="font-bold text-black-900">{estimateAreaSelectedUnit ? `${estimateAreaSelectedUnit.toFixed(2)} ${selectedAreaUnitLabel}` : '—'}</span>
                                </div>
                                <div className="flex justify-between items-center p-3 bg-white rounded-lg">
                                  <span className="text-black-600">Total Quantity</span>
                                  <span className="font-bold text-black-900">{estimateQuantity}</span>
                                </div>
                                <div className="flex justify-between items-center p-3 bg-gradient-to-r from-yellow-400 to-yellow-500 text-yellow-900 font-bold rounded-lg">
                                  <span className="text-black font-semibold">Total Area</span>
                                  <span className="font-bold text-black-900 text-lg">{estimateTotalAreaSelectedUnit ? `${estimateTotalAreaSelectedUnit.toFixed(2)} ${selectedAreaUnitLabel}` : '—'}</span>
                                </div>
                              </div>
                            </div>

                            {/* Price Summary */}
                            <div className="rounded-2xl bg-white border-2 border-green-200 p-5">
                              <div className="flex items-center gap-3 mb-3">
                                <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white-100 text-2xl font-bold text-green-600">₱</span>
                                <h4 className="font-bold text-black-900">Price Summary</h4>
                              </div>
                              <div className="space-y-3 text-sm">
                                <div className="p-3 bg-white rounded-lg">
                                  <p className="text-xs text-black-500 mb-1">Rate per Sq Ft</p>
                                  <p className="font-bold text-gray-900">{estimateUnitRate ? `₱${estimateUnitRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "Contact us"}</p>
                                </div>
                                <div className="p-3 bg-white rounded-lg">
                                  <p className="text-xs text-black-500 mb-1">Calculation</p>
                                  <p className="text-sm font-semibold text-gray-900">
                                    {estimateWidth && estimateHeight
                                      ? `₱${estimateUnitRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} × ${estimateTotalArea.toFixed(2)} sq ft`
                                      : "Fill measurements"}
                                  </p>
                                </div>
                              </div>
                            </div>

                            {/* Final Cost - Highlighted */}
                            <div className="rounded-2xl bg-gradient-to-br from-red-600 to-red-700 p-5 text-white">
                              <p className="text-sm text-red-100 mb-2">Total Estimated Cost</p>
                              <p className="text-4xl font-bold">
                                {estimateWidth && estimateHeight
                                  ? `₱${estimateTotalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                  : "—"}
                              </p>
                              <p className="text-xs text-red-100 mt-2">*Final price may vary based on final specifications</p>
                            </div>
                          </div>
                        </div>

                        {cartActionError && (
                          <div className="rounded-xl border-2 border-red-300 bg-red-50 p-4 text-sm text-red-700 flex items-start gap-3">
                            <Info size={18} className="flex-shrink-0 mt-0.5" />
                            <div>{cartActionError}</div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Sticky Footer */}
                  <div className="flex-shrink-0 px-6 py-4">
                    {cartDecisionStep === "choice" ? null : (
                      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                        <button
                          onClick={closeCartDecisionModal}
                          className="rounded-xl border-2 border-gray-300 bg-white text-gray-700 font-semibold py-3 px-6 hover:bg-gray-50 transition"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleEstimateAfterEstimation}
                          disabled={
                            orderRequestLoading ||
                            !canRequestOrders ||
                            !estimateForm.width ||
                            !estimateForm.height ||
                            Number(estimateForm.width) <= 0 ||
                            Number(estimateForm.height) <= 0
                          }
                          className={`rounded-xl text-white font-semibold py-3 px-6 transition shadow-lg flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed ${
                            estimateFlowType === "add_to_cart_estimate"
                              ? "bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800"
                              : "bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800"
                          }`}
                        >
                          <CheckCircle size={20} />
                          {estimateFlowType === "add_to_cart_estimate"
                            ? orderRequestLoading
                              ? "Adding..."
                              : canRequestOrders ? "Add to Cart" : "Orders Disabled"
                            : orderRequestLoading
                              ? "Requesting..."
                              : canRequestOrders ? "Request Order" : "Orders Disabled"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {showDeliveryConfirmModal && canRequestOrders && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 backdrop-blur-sm sm:p-4">
                <div className={`order-flow-modal flex max-h-[calc(100dvh-1rem)] w-full max-w-4xl flex-col overflow-hidden rounded-3xl shadow-2xl sm:max-h-[88vh] ${darkMode ? "order-flow-modal-dark bg-slate-900" : "bg-white"}`}>
                  <div className={`flex-shrink-0 border-b px-4 py-3 sm:px-5 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
                    <div className="flex items-center justify-between gap-4">
                      <button
                        type="button"
                        onClick={handleCancelDeliveryConfirm}
                        className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold transition ${darkMode ? "text-slate-200 hover:bg-slate-800" : "text-slate-700 hover:bg-slate-100"}`}
                      >
                        <ArrowLeft size={15} />
                        Back to Product
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelDeliveryConfirm}
                        className={`rounded-full border p-2 transition ${darkMode ? "border-slate-600 text-slate-300 hover:bg-slate-800" : "border-slate-200 text-slate-500 hover:bg-slate-100"}`}
                        aria-label="Close place order request"
                      >
                        <X size={18} />
                      </button>
                    </div>
                    <div className="mt-1">
                      <h3 className={`text-2xl font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>Place Order Request</h3>
                      <p className={`mt-1 text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`}>Review your details and submit your request.</p>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto">
                    <div className={`grid gap-5 p-5 min-h-0 lg:grid-cols-[1.2fr_0.9fr] ${darkMode ? "bg-slate-950" : "bg-slate-50"}`}>
                      <div className={`space-y-4 rounded-3xl border p-5 shadow-sm ${darkMode ? "border-slate-700 bg-slate-900" : "border-gray-200 bg-white"}`}>
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <h4 className={`text-lg font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}>Customer Information</h4>
                            <p className={`text-sm mt-1 ${darkMode ? "text-slate-400" : "text-gray-500"}`}>Review your details before submitting your request.</p>
                          </div>
                          {!isDeliveryConfirmValid && (
                            <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">Incomplete required fields</span>
                          )}
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <label className={`text-xs font-semibold uppercase tracking-[0.2em] ${darkMode ? "text-slate-400" : "text-gray-500"}`}>Full Name</label>
                            <p className={`mt-2 ${darkMode ? "text-white" : "text-gray-900"}`}>{`${profileForm.first_name || user?.first_name || ""} ${profileForm.last_name || user?.last_name || ""}`.trim() || "N/A"}</p>
                          </div>
                          <div>
                            <label className={`text-xs font-semibold uppercase tracking-[0.2em] ${darkMode ? "text-slate-400" : "text-gray-500"}`}>Email Address</label>
                            <p className={`mt-2 ${darkMode ? "text-white" : "text-gray-900"}`}>{profileForm.email || user?.email || "N/A"}</p>
                          </div>
                        </div>

                        <div className={`rounded-3xl border p-4 ${darkMode ? "border-slate-700 bg-slate-800" : "border-gray-200 bg-gray-50"}`}>
                          <h4 className={`text-sm font-semibold uppercase tracking-[0.2em] ${darkMode ? "text-slate-400" : "text-gray-500"}`}>Contact &amp; Installation Details</h4>
                          <div className="mt-4 grid gap-4 sm:grid-cols-2">
                            <div className="sm:col-span-2">
                              <label className={`text-xs font-semibold uppercase tracking-[0.2em] ${darkMode ? "text-slate-400" : "text-gray-500"}`}>Contact Number <span className="text-red-600">*</span></label>
                              <input
                                name="phone"
                                type="text"
                                value={deliveryConfirmForm.phone}
                                onChange={handleDeliveryConfirmChange}
                                className={`mt-2 w-full rounded-2xl border px-4 py-3 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100 ${darkMode ? "border-slate-700 bg-slate-900 text-white" : "border-gray-300 bg-white text-gray-900"}`}
                              />
                            </div>
                            <div className="sm:col-span-2">
                              <label className={`text-xs font-semibold uppercase tracking-[0.2em] ${darkMode ? "text-slate-400" : "text-gray-500"}`}>Street Address <span className="text-red-600">*</span></label>
                              <input
                                name="street_address"
                                type="text"
                                value={deliveryConfirmForm.street_address}
                                onChange={handleDeliveryConfirmChange}
                                className={`mt-2 w-full rounded-2xl border px-4 py-3 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100 ${darkMode ? "border-slate-700 bg-slate-900 text-white" : "border-gray-300 bg-white text-gray-900"}`}
                              />
                            </div>
                          </div>
                        </div>

                        <div>
                          <label className={`text-xs font-semibold uppercase tracking-[0.2em] ${darkMode ? "text-slate-400" : "text-gray-500"}`}>Special Instructions / Engineering Notes (Optional)</label>
                          <textarea
                            value={deliveryConfirmNotes}
                            onChange={(event) => setDeliveryConfirmNotes(event.target.value)}
                            placeholder="Add notes about structure elevations, framing colors, glass thickness preferences, etc."
                            className={`mt-2 min-h-[92px] w-full resize-none rounded-2xl border px-4 py-3 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100 ${darkMode ? "border-slate-700 bg-slate-900 text-white placeholder:text-slate-500" : "border-gray-300 bg-white text-gray-900"}`}
                          />
                        </div>

                        {deliveryConfirmError && (
                          <div className={`rounded-2xl border p-4 text-sm ${darkMode ? "border-red-800 bg-red-950/40 text-red-200" : "border-red-300 bg-red-50 text-red-700"}`}>
                            Please complete your delivery information before proceeding.
                          </div>
                        )}
                      </div>

                      <div className={`rounded-3xl border p-5 shadow-sm ${darkMode ? "border-slate-700 bg-slate-900" : "border-gray-200 bg-white"}`}>
                        <div className="flex items-start gap-4">
                          <div className="h-24 w-24 overflow-hidden rounded-3xl border border-gray-200 bg-gray-100">
                            <img
                              src={getProductImage(confirmProduct)}
                              alt={confirmProduct?.name || "Product preview"}
                              className="h-full w-full object-cover"
                            />
                          </div>
                          <div className="flex-1">
                            <p className={`text-sm uppercase tracking-[0.2em] ${darkMode ? "text-slate-400" : "text-gray-500"}`}>Order Summary</p>
                            <h4 className={`text-xl font-semibold mt-2 ${darkMode ? "text-white" : "text-gray-900"}`}>{confirmProduct?.name || "Product details"}</h4>
                            <p className={`mt-1 text-sm ${darkMode ? "text-slate-400" : "text-gray-600"}`}>{confirmProduct?.product_type || confirmProduct?.category || "Product"}</p>
                          </div>
                        </div>

                        <div className="mt-6 space-y-4">
                          <div className={`rounded-3xl p-4 border ${darkMode ? "border-slate-700 bg-slate-800" : "bg-slate-50 border-slate-200"}`}>
                            <p className={`text-sm font-semibold mb-3 ${darkMode ? "text-slate-200" : "text-gray-700"}`}>Product Details</p>
                            <div className={`grid gap-3 text-sm sm:grid-cols-2 ${darkMode ? "text-slate-300" : "text-gray-700"}`}>
                              <div>
                                <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Quantity</p>
                                <p className={`mt-2 font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}>{confirmQuantity}</p>
                              </div>
                              <div>
                                <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Unit Price</p>
                                <p className={`mt-2 font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}>{formatCurrency(deliveryConfirmMode === "orderNow" ? Number(orderNowProduct?.unit_price || orderNowProduct?.price_per_sqft || 0) : estimateUnitRate)}</p>
                              </div>
                              <div>
                                <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Width</p>
                                <p className={`mt-2 font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}>{confirmWidth}</p>
                              </div>
                              <div>
                                <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Height</p>
                                <p className={`mt-2 font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}>{confirmHeight}</p>
                              </div>
                              <div className="sm:col-span-2">
                                <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Color / Variant</p>
                                <p className={`mt-2 font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}>{confirmProduct?.variant || confirmProduct?.color || "Standard"}</p>
                              </div>
                            </div>
                          </div>

                          <div className={`rounded-3xl p-4 border ${darkMode ? "border-slate-700 bg-slate-800" : "bg-slate-50 border-slate-200"}`}>
                            <p className={`text-sm font-semibold mb-3 ${darkMode ? "text-slate-200" : "text-gray-700"}`}>Pricing Breakdown</p>
                            <div className={`space-y-3 text-sm ${darkMode ? "text-slate-300" : "text-gray-700"}`}>
                              <div className="flex items-center justify-between">
                                <span>Subtotal</span>
                                <span className={`font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}>{formatCurrency(confirmSubtotal)}</span>
                              </div>
                              
                              <div className={`border-t pt-3 flex items-center justify-between text-base font-semibold ${darkMode ? "border-slate-700 text-white" : "border-gray-200 text-gray-900"}`}>
                                <span>Total</span>
                                <span>{formatCurrency(confirmGrandTotal)}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className={`sticky bottom-0 z-10 flex flex-col-reverse gap-2 border-t px-4 py-3 sm:flex-row sm:justify-end sm:gap-3 sm:px-5 ${darkMode ? "border-slate-700 bg-slate-900" : "border-gray-200 bg-gray-50"}`}>
                    <button
                      type="button"
                      onClick={handleCancelDeliveryConfirm}
                      className={`w-full rounded-xl border px-5 py-3 text-sm font-semibold transition sm:w-auto ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"}`}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmAndContinue}
                      disabled={!isDeliveryConfirmValid || orderRequestLoading}
                      className="w-full rounded-xl bg-gradient-to-r from-red-600 to-red-700 px-5 py-3 text-sm font-semibold text-white transition shadow-lg hover:from-red-700 hover:to-red-800 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                    >
                      Submit Order Request
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showOrderNowModal && canRequestOrders && orderNowProduct && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                <div className={`order-flow-modal w-full max-w-3xl rounded-3xl bg-white shadow-2xl overflow-hidden ${darkMode ? "order-flow-modal-dark" : ""}`}>
                  <div className="border-b px-6 py-5 bg-red-600 text-white">
                    <div className="flex flex-col gap-1">
                      <h3 className="text-xl font-bold">Place Order</h3>
                      <p className="text-sm text-red-100">Review product details, set quantity, and continue to the order summary.</p>
                    </div>
                  </div>

                  <div className="grid gap-6 p-6 lg:grid-cols-[1.4fr_0.8fr]">
                    <div className="space-y-6 rounded-[32px] border border-gray-200 bg-gray-50 p-6 shadow-sm">
                      <div className="flex flex-col gap-4 rounded-3xl bg-white p-4 shadow-sm border border-gray-200">
                        <div className="flex items-center gap-4">
                          <div className="h-24 w-24 overflow-hidden rounded-3xl border border-gray-200 bg-gray-100">
                            <img
                              src={getProductImage(orderNowProduct)}
                              alt={orderNowProduct.name}
                              className="h-full w-full object-cover"
                            />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs uppercase tracking-[0.24em] text-gray-500">Selected Product</p>
                            <p className="mt-2 text-2xl font-bold text-gray-900 truncate">{orderNowProduct.name}</p>
                            <p className="mt-1 text-sm text-gray-600">{orderNowProduct.product_type || orderNowProduct.category || "Product"}</p>
                          </div>
                        </div>
                        <p className="text-lg font-semibold text-red-600">{getProductPrice(orderNowProduct)}</p>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-3xl bg-white p-4 border border-gray-200">
                          <p className="text-xs uppercase tracking-[0.24em] text-gray-500">Unit Rate</p>
                          <p className="mt-2 text-lg font-semibold text-gray-900">{orderNowProduct ? getProductUnitRate(orderNowProduct) : "Contact us"}</p>
                        </div>
                        <div className="rounded-3xl bg-white p-4 border border-gray-200">
                          <p className="text-xs uppercase tracking-[0.24em] text-gray-500">Unit</p>
                          <p className="mt-2 text-lg font-semibold text-gray-900">{orderNowProduct.unit || "piece"}</p>
                        </div>
                        <div className="rounded-3xl bg-white p-4 border border-gray-200">
                          <p className="text-xs uppercase tracking-[0.24em] text-gray-500">Variant</p>
                          <p className="mt-2 text-lg font-semibold text-gray-900">{orderNowProduct.variant || "Standard"}</p>
                        </div>
                          <div className="rounded-3xl bg-white p-4 border border-gray-200">
                            <p className="text-xs uppercase tracking-[0.24em] text-gray-500">Dimensions</p>
                            <p className="mt-2 text-lg font-semibold text-gray-900">
                              {orderNowProduct.width && orderNowProduct.height
                                ? `${orderNowProduct.width}" × ${orderNowProduct.height}"`
                                : orderNowProduct.dimensions || orderNowProduct.standard_size || orderNowProduct.size || "—"}
                            </p>
                          </div>
                        </div>

                        <div className="rounded-3xl bg-white p-5 border border-gray-200">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-semibold text-gray-700">Quantity</p>
                            <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white px-3 py-2">
                              <button
                                type="button"
                                onClick={() => handleOrderNowQuantityChange(-1)}
                                className="rounded-2xl bg-gray-100 p-3 text-gray-700 hover:bg-gray-200 transition"
                              >
                                <Minus size={18} />
                              </button>
                              <span className="text-2xl font-semibold text-gray-900">{orderNowQuantity}</span>
                              <button
                                type="button"
                                onClick={() => handleOrderNowQuantityChange(1)}
                                className="rounded-2xl bg-gray-100 p-3 text-gray-700 hover:bg-gray-200 transition"
                              >
                                <Plus size={18} />
                              </button>
                            </div>
                          </div>
                          <p className="mt-3 text-sm text-gray-500">Adjust the number of units before moving to the summary page.</p>
                        </div>
                        </div>

                    <div className="space-y-6 rounded-[32px] border border-gray-200 bg-white p-6 shadow-sm">
                      <div className="rounded-3xl bg-gradient-to-r from-red-600 to-red-700 p-5 text-white">
                        <p className="text-sm uppercase tracking-[0.24em] text-red-100">Order snapshot</p>
                        <p className="mt-3 text-3xl font-bold">{formatCurrency(orderNowSubtotal)}</p>
                      </div>

                      <div className="grid gap-3">
                        <div className="rounded-3xl bg-gray-50 p-4 border border-gray-200">
                          <p className="text-xs uppercase tracking-[0.24em] text-gray-500">Estimated total</p>
                          <p className="mt-2 text-lg font-semibold text-gray-900">{formatCurrency(orderNowSubtotal)}</p>
                        </div>
                        <div className="rounded-3xl bg-gray-50 p-4 border border-gray-200">
                          <p className="text-xs uppercase tracking-[0.24em] text-gray-500">Downpayment</p>
                          <p className="mt-2 text-lg font-semibold text-gray-900">{formatCurrency(orderNowSubtotal * 0.5)}</p>
                        </div>
                      </div>

                      <div className="rounded-3xl bg-red-50 p-4 border border-red-200">
                        <p className="text-sm font-semibold text-red-700">Need help?</p>
                        <p className="mt-2 text-sm text-slate-600">Use the estimate tool to calculate custom pricing based on your measurements.</p>
                      </div>

                      {cartActionError && (
                        <div className="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-700">
                          {cartActionError}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 border-t border-gray-200 bg-gray-50 px-6 py-4 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      onClick={closeOrderNowModal}
                      className="rounded-xl border border-gray-300 bg-white px-5 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-100 transition"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={openOrderNowReviewModal}
                      disabled={orderRequestLoading}
                      className="rounded-xl bg-gradient-to-r from-red-600 to-red-700 px-5 py-3 text-sm font-semibold text-white hover:from-red-700 hover:to-red-800 transition shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      Continue to Summary
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showBatchOrderModal && canRequestOrders && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 backdrop-blur-sm sm:p-4">
                <div className={`order-flow-modal flex max-h-[calc(100dvh-1rem)] w-full max-w-4xl flex-col overflow-hidden rounded-3xl shadow-2xl sm:max-h-[88vh] ${darkMode ? "order-flow-modal-dark bg-slate-900" : "bg-white"}`}>
                  <div className={`flex-shrink-0 border-b px-4 py-3 sm:px-5 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
                    <div className="flex items-center justify-between gap-4">
                      <button
                        type="button"
                        onClick={closeBatchOrderModal}
                        className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold transition ${darkMode ? "text-slate-200 hover:bg-slate-800" : "text-slate-700 hover:bg-slate-100"}`}
                      >
                        <ArrowLeft size={16} />
                        Back to Cart
                      </button>
                      <button
                        type="button"
                        onClick={closeBatchOrderModal}
                        aria-label="Close order request"
                        className={`rounded-full border p-2 transition ${darkMode ? "border-slate-600 text-slate-300 hover:bg-slate-800" : "border-slate-200 text-slate-500 hover:bg-slate-100"}`}
                      >
                        <X size={18} />
                      </button>
                    </div>
                    <h3 className={`text-2xl font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>
                      {selectedItemCount === 1 ? "Place Order Request" : "Place Batch Order Request"}
                    </h3>
                    <p className={`mt-1 text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                      {selectedItemCount === 1
                        ? "Review your contact data and selected item before submitting your request."
                        : "Review your contact data and selected items to compile requests."}
                    </p>
                  </div>

                  <div className={`min-h-0 flex-1 overflow-y-auto p-4 sm:p-5 ${darkMode ? "bg-slate-950" : "bg-slate-50"}`}>
                    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)] xl:gap-6">
                      <div className="flex flex-col gap-5">
                        <div className={`space-y-4 rounded-3xl border p-5 shadow-sm ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
                          <div>
                            <h4 className={`text-lg font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}>Customer Information</h4>
                            <p className={`mt-1 text-sm ${darkMode ? "text-slate-400" : "text-gray-500"}`}>Review your details before submitting your request.</p>
                          </div>

                          <div className="space-y-4">
                            <div>
                              <label className={`mb-2 block text-sm font-medium ${darkMode ? "text-slate-300" : "text-slate-600"}`}>Full Name</label>
                              <input
                                value={`${profileForm.first_name || user?.first_name || ""} ${profileForm.last_name || user?.last_name || ""}`.trim() || ""}
                                readOnly
                                className={`w-full cursor-not-allowed rounded-xl border px-3 py-3 outline-none ${darkMode ? "border-slate-700 bg-slate-900 text-slate-400" : "border-slate-200 bg-slate-100 text-slate-500"}`}
                              />
                            </div>
                            <div>
                              <label className={`mb-2 block text-sm font-medium ${darkMode ? "text-slate-300" : "text-slate-600"}`}>Email Address</label>
                              <input
                                value={profileForm.email || user?.email || ""}
                                readOnly
                                className={`w-full cursor-not-allowed rounded-xl border px-3 py-3 outline-none ${darkMode ? "border-slate-700 bg-slate-900 text-slate-400" : "border-slate-200 bg-slate-100 text-slate-500"}`}
                              />
                            </div>
                            <div>
                              <label className={`mb-2 block text-sm font-medium ${darkMode ? "text-slate-300" : "text-slate-600"}`}>Phone Number *</label>
                              <input
                                name="phone"
                                type="tel"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={batchOrderForm.phone}
                                onChange={(event) => setBatchOrderForm((current) => ({ ...current, phone: event.target.value.replace(/\D/g, "") }))}
                                className={`w-full rounded-xl border px-3 py-3 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100 ${darkMode ? "border-slate-700 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-800"}`}
                              />
                            </div>
                            <div>
                              <label className={`mb-2 block text-sm font-medium ${darkMode ? "text-slate-300" : "text-slate-600"}`}>Complete Installation Address *</label>
                              <input
                                name="shipping_address"
                                value={batchOrderForm.shipping_address}
                                onChange={(event) => setBatchOrderForm((current) => ({ ...current, shipping_address: event.target.value }))}
                                className={`w-full rounded-xl border px-3 py-3 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100 ${darkMode ? "border-slate-700 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-800"}`}
                              />
                            </div>
                            <div>
                              <label className={`mb-2 block text-sm font-medium ${darkMode ? "text-slate-300" : "text-slate-600"}`}>Special Instructions / Engineering Notes (Optional)</label>
                              <textarea
                                name="notes"
                                value={batchOrderForm.notes}
                                onChange={(event) => setBatchOrderForm((current) => ({ ...current, notes: event.target.value }))}
                                className={`min-h-[100px] w-full resize-none rounded-xl border px-3 py-3 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100 ${darkMode ? "border-slate-700 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-800"}`}
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col gap-5">
                        <div className={`space-y-4 rounded-3xl border p-5 shadow-sm ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
                          <div className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.2em] text-red-600">
                            <ClipboardList size={16} />
                            {selectedItemCount === 1 ? "Order Review (1 item)" : `Batch Review (${selectedItemCount} items)`}
                          </div>

                          <div className={`max-h-[320px] space-y-3 overflow-y-auto pr-2`}>
                            {selectedCartItems.map((item) => (
                              <div key={item.cartId || item._id} className={`rounded-xl border p-3 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
                                <div className="flex items-start gap-3">
                                  <div className={`h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-slate-100"}`}>
                                    <img
                                      src={getProductImage(item)}
                                      alt={item.name || "Product"}
                                      className="h-full w-full object-cover"
                                    />
                                  </div>
                                  <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className={`truncate text-base font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>{item.name}</div>
                                      <div className={`mt-1 text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                                        {item.is_estimate && item.width && item.height
                                          ? `${item.width} x ${item.height} = ${Number(item.area || ((Number(item.width) * Number(item.height)) / 144)).toLocaleString(undefined, { maximumFractionDigits: 2 })} sq.ft`
                                          : item.dimensions?.width && item.dimensions?.height
                                            ? `${item.dimensions.width} x ${item.dimensions.height} = ${Number(item.dimensions.area || ((Number(item.dimensions.width) * Number(item.dimensions.height)) / 144)).toLocaleString(undefined, { maximumFractionDigits: 2 })} sq.ft`
                                            : "Customized measurement"}
                                      </div>
                                    </div>
                                    <div className="flex-shrink-0 text-right">
                                      <div className="text-base font-bold text-red-600">{formatCurrency(getItemPriceValue(item))}</div>
                                      <div className={`text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>x{item.quantity}</div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>

                          <div className={`mt-5 rounded-xl border p-4 ${darkMode ? "border-red-900 bg-red-950/50" : "border-red-200 bg-red-50"}`}>
                            <div className={`flex items-center justify-between text-base font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>
                              <span>Grand Estimated Total</span>
                              <span className="text-red-600">₱{Number(selectedSubtotal || 0).toLocaleString()}</span>
                            </div>
                            <div className={`mt-3 flex items-center justify-between text-sm ${darkMode ? "text-slate-300" : "text-slate-700"}`}>
                              <span>50% Requred Downpayment</span>
                              <span>₱{Number((selectedSubtotal || 0) * 0.5).toLocaleString()}</span>
                            </div>
                          </div>

                          <div className={`mt-5 rounded-xl border p-3 text-sm ${darkMode ? "border-slate-700 bg-slate-900 text-slate-300" : "border-slate-200 bg-white text-slate-600"}`}>
                            Final pricing will be confirmed during shop discussion or site inspection. Contact: 09123456789
                          </div>
                        </div>

                      </div>
                    </div>
                  </div>

                  <div className={`sticky bottom-0 z-10 flex flex-shrink-0 flex-col-reverse gap-2 border-t px-4 py-3 sm:flex-row sm:justify-end sm:gap-3 sm:px-5 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-slate-50"}`}>
                    <button
                      type="button"
                      onClick={closeBatchOrderModal}
                      className={`w-full rounded-xl border px-5 py-3 text-sm font-semibold transition sm:w-auto ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}`}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleCheckout}
                      disabled={checkoutLoading || selectedItemCount === 0}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-red-600 to-red-700 px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:from-red-700 hover:to-red-800 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                    >
                      <CheckCircle size={18} />
                      {selectedItemCount === 1 ? "Submit Order Request" : "Submit Order Requests"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showBatchOrderConfirmModal && canRequestOrders && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
                <div className={`w-full max-w-xl overflow-hidden rounded-2xl shadow-2xl ${darkMode ? "bg-slate-900" : "bg-white"}`}>
                  <div className={`flex items-center gap-3 border-b px-5 py-4 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                    <CheckCircle size={20} className="text-red-600" />
                    <h3 className={`text-lg font-bold ${darkMode ? "text-white" : "text-slate-800"}`}>
                      {selectedItemCount === 1 ? "Confirm Order Request" : "Confirm Batch Order Request"}
                    </h3>
                  </div>

                  <div className={`max-h-[calc(100vh-190px)] space-y-5 overflow-y-auto px-5 py-4 text-sm ${darkMode ? "text-slate-200" : "text-slate-700"}`}>
                    <section>
                      <h4 className="border-b border-red-100 pb-2 text-xs font-bold uppercase tracking-wide text-red-700">Customer Information</h4>
                      <div className="mt-3 space-y-3">
                        <p className="flex items-center gap-2"><User size={14} className="text-slate-400" />{`${profileForm.first_name || user?.first_name || ""} ${profileForm.last_name || user?.last_name || ""}`.trim() || "N/A"}</p>
                        <p className="flex items-center gap-2"><Mail size={14} className="text-slate-400" />{profileForm.email || user?.email || "N/A"}</p>
                        <p className="flex items-center gap-2"><Phone size={14} className="text-slate-400" />{batchOrderForm.phone || "N/A"}</p>
                        <p className="flex items-start gap-2"><MapPin size={14} className="mt-0.5 shrink-0 text-slate-400" />{normalizeAddress(batchOrderForm.shipping_address) || "N/A"}</p>
                      </div>
                    </section>

                    <section>
                      <h4 className="border-b border-red-100 pb-2 text-xs font-bold uppercase tracking-wide text-red-700">
                        {selectedItemCount === 1 ? "Selected Product (1)" : `Selected Products (${selectedItemCount})`}
                      </h4>
                      <div className="mt-3 space-y-2">
                        {selectedCartItems.map((item) => (
                          <div key={item.cartId || item._id || item.name} className={`flex items-center justify-between gap-3 rounded-sm border px-3 py-2 ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200"}`}>
                            <div className="min-w-0">
                              <p className={`truncate font-semibold ${darkMode ? "text-white" : "text-slate-800"}`}>{item.name}</p>
                              <p className={`text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                                {getConfirmationItemDimensionText(item)}
                              </p>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className={`text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>x{item.quantity || 1}</p>
                              <p className={`font-semibold ${darkMode ? "text-slate-200" : "text-slate-700"}`}>{formatCurrency(getItemPriceValue(item))}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section>
                      <h4 className="border-b border-red-100 pb-2 text-xs font-bold uppercase tracking-wide text-red-700">Pricing Compilation</h4>
                      <div className="mt-3 space-y-2">
                        <div className={`flex items-center justify-between rounded-sm px-3 py-2 font-bold ${darkMode ? "bg-red-950/50" : "bg-red-50"}`}>
                          <span>Est. Grand Total</span>
                          <span className="text-red-700">{formatCurrency(selectedSubtotal)}</span>
                        </div>
                        <div className={`flex items-center justify-between px-3 py-1 font-semibold ${darkMode ? "text-slate-200" : ""}`}>
                          <span>50% Downpayment</span>
                          <span className="text-red-700">{formatCurrency(selectedSubtotal * 0.5)}</span>
                        </div>
                      </div>
                    </section>

                    <label className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-3 text-sm ${darkMode ? "border-slate-700 bg-slate-800 text-slate-200" : "border-slate-200 bg-white text-slate-700"}`}>
                      <input
                        type="checkbox"
                        checked={batchOrderAgreed}
                        onChange={(event) => setBatchOrderAgreed(event.target.checked)}
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 accent-red-600 focus:ring-red-500"
                      />
                      <span>I understand the 50% downpayment policy and agree to proceed.</span>
                    </label>

                    <div className={`rounded-md border px-3 py-2 text-xs ${darkMode ? "border-amber-700 bg-amber-950/40 text-amber-100" : "border-amber-300 bg-amber-50 text-slate-600"}`}>
                      <p>Final pricing will be confirmed during shop discussion or site inspection.</p>
                      <p className="mt-1">Contact: <span className="font-semibold">09123456789</span></p>
                    </div>

                    {checkoutError && (
                      <div className="rounded-md border border-red-300 bg-red-950/40 px-3 py-2 text-sm text-red-200">
                        {checkoutError}
                      </div>
                    )}
                  </div>

                  <div className={`flex justify-end gap-2 border-t px-5 py-3 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200"}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setShowBatchOrderConfirmModal(false);
                        setBatchOrderAgreed(false);
                      }}
                      disabled={checkoutLoading}
                      className={`rounded-lg border px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmBatchOrder}
                      disabled={checkoutLoading || !batchOrderAgreed}
                      className="inline-flex items-center gap-2 rounded-lg bg-red-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <CheckCircle size={16} />
                      {checkoutLoading ? "Submitting..." : "Proceed"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showBatchSuccessModal && (
              <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
                <div className={`w-full max-w-md rounded-[26px] border p-6 shadow-[0_24px_80px_rgba(15,23,42,0.18)] ${darkMode ? "border-slate-700 bg-slate-900" : "border-transparent bg-white"}`}>
                  <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full border-2 ${darkMode ? "border-green-800 bg-green-950/50" : "border-green-200 bg-green-50"}`}>
                    <CheckCircle className={`h-8 w-8 ${darkMode ? "text-green-400" : "text-green-700"}`} />
                  </div>

                  <h3 className={`mt-5 text-center text-2xl font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>Batch Requests Submitted!</h3>

                  <p className={`mt-4 text-center text-sm leading-6 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                    Thank you! Your architectural order requests have been received. Our estimating team will contact you shortly to schedule your site inspection and finalize quotation blueprints.
                  </p>

                  <p className={`mt-5 flex items-center justify-center gap-2 text-sm font-medium ${darkMode ? "text-slate-200" : "text-slate-700"}`}>
                    <Phone size={15} className={darkMode ? "text-slate-400" : "text-slate-500"} />
                    Questions? Call us at 09123456789
                  </p>

                  <div className="mt-6 flex gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setShowBatchSuccessModal(false);
                        setActiveTab("orders");
                      }}
                      className="flex-1 rounded-xl border border-red-600 bg-red-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-800"
                    >
                      View Your Orders
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowBatchSuccessModal(false);
                        setActiveTab("products");
                      }}
                      className={`flex-1 rounded-xl border px-4 py-3 text-sm font-semibold transition ${darkMode ? "border-red-500 bg-slate-900 text-red-300 hover:bg-red-950/50" : "border-red-600 bg-white text-red-700 hover:bg-red-50"}`}
                    >
                      Continue Browsing
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showOrderReviewModal && canRequestOrders && (cartDecisionProduct || orderNowProduct) && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
                <div className={`w-full max-w-xl overflow-hidden rounded-2xl shadow-2xl ${darkMode ? "bg-slate-900" : "bg-white"}`}>
                  <div className={`flex items-center gap-3 border-b px-5 py-4 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                    <CheckCircle size={20} className="text-red-600" />
                    <h3 className={`text-lg font-bold ${darkMode ? "text-white" : "text-slate-800"}`}>
                      Order Summary & Policy
                    </h3>
                  </div>

                  <div className={`max-h-[calc(100vh-190px)] space-y-5 overflow-y-auto px-5 py-4 text-sm ${darkMode ? "text-slate-200" : "text-slate-700"}`}>
                    <section>
                      <h4 className="border-b border-red-100 pb-2 text-xs font-bold uppercase tracking-wide text-red-700">Customer Information</h4>
                      <div className="mt-3 space-y-3">
                        <div className="flex items-center gap-2">
                          <User size={14} className="text-slate-400" />
                          <span>{`${profileForm.first_name || user?.first_name || ""} ${profileForm.last_name || user?.last_name || ""}`.trim() || "N/A"}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Mail size={14} className="text-slate-400" />
                          <span>{profileForm.email || user?.email || "N/A"}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Phone size={14} className="text-slate-400" />
                          <span>{deliveryConfirmForm.phone || profileForm.phone || user?.phone || "N/A"}</span>
                        </div>
                        <div className="flex items-start gap-2">
                          <MapPin size={14} className="mt-0.5 shrink-0 text-slate-400" />
                          <span>{normalizeAddress([
                            deliveryConfirmForm.street_address || profileForm.street_address,
                            deliveryConfirmForm.city || profileForm.city,
                            deliveryConfirmForm.province || profileForm.province,
                            deliveryConfirmForm.zip_code || profileForm.zip_code,
                          ].filter(Boolean).join(", ")) || "N/A"}</span>
                        </div>
                      </div>
                    </section>

                    <section>
                      <h4 className="border-b border-red-100 pb-2 text-xs font-bold uppercase tracking-wide text-red-700">Selected Product (1)</h4>
                      <div className={`mt-3 rounded-xl border px-3 py-3 ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-slate-50"}`}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className={`truncate font-semibold ${darkMode ? "text-white" : "text-slate-800"}`}>
                              {(reviewOrderMode === "orderNow" ? orderNowProduct : cartDecisionProduct)?.name || "Selected product"}
                            </p>
                            <p className={`mt-1 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                              {orderReviewMeasurementText}
                            </p>
                          </div>
                          <p className="shrink-0 text-base font-bold text-red-600">
                            {reviewOrderMode === "orderNow"
                              ? orderNowProduct
                                ? formatCurrency(orderNowSubtotal)
                                : "₱0.00"
                              : estimateTotalCost
                                ? `₱${estimateTotalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                : "₱0.00"}
                          </p>
                        </div>
                      </div>
                    </section>

                    <section>
                      <h4 className="border-b border-red-100 pb-2 text-xs font-bold uppercase tracking-wide text-red-700">Pricing Compilation</h4>
                      <div className="mt-3 space-y-2">
                        <div className={`flex items-center justify-between rounded-md px-3 py-2 font-bold ${darkMode ? "bg-red-950/50 text-white" : "bg-red-50 text-slate-800"}`}>
                          <span>Est. Grand Total</span>
                          <span className="text-red-600">
                            {reviewOrderMode === "orderNow"
                              ? orderNowProduct
                                ? formatCurrency(orderNowSubtotal)
                                : "₱0.00"
                              : estimateTotalCost
                                ? `₱${estimateTotalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                : "₱0.00"}
                          </span>
                        </div>
                        <div className={`flex items-center justify-between px-3 py-1 font-semibold ${darkMode ? "text-slate-200" : "text-slate-700"}`}>
                          <span>50% Downpayment</span>
                          <span className="text-red-600">
                            {reviewOrderMode === "orderNow"
                              ? orderNowProduct
                                ? formatCurrency(orderNowSubtotal * 0.5)
                                : "₱0.00"
                              : estimateTotalCost
                                ? `₱${(estimateTotalCost * 0.5).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                : "₱0.00"}
                          </span>
                        </div>
                      </div>
                    </section>

                    <div className={`rounded-md border px-3 py-3 text-xs ${darkMode ? "border-amber-700 bg-amber-950/40 text-amber-100" : "border-amber-300 bg-amber-50 text-slate-600"}`}>
                      <p>Final pricing will be confirmed during shop discussion or site inspection.</p>
                      <p className="mt-1">Contact: <span className="font-semibold">09123456789</span></p>
                    </div>

                    <div className={`rounded-xl border p-3 ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-slate-50"}`}>
                      <p className={`text-sm font-semibold ${darkMode ? "text-red-400" : "text-red-700"}`}>Payment Policy</p>
                      <p className={`mt-2 text-sm ${darkMode ? "text-slate-300" : "text-slate-700"}`}>
                        A 50% downpayment of the total order amount is required before proceeding with the order.
                      </p>
                    </div>

                    <label className={`flex items-start gap-3 rounded-lg border p-3 ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-slate-50"}`}>
                      <input
                        type="checkbox"
                        checked={orderReviewAgreed}
                        onChange={(e) => setOrderReviewAgreed(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                      />
                      <span className={darkMode ? "text-slate-200" : "text-slate-700"}>
                        I understand the 50% downpayment policy and agree to proceed.
                      </span>
                    </label>

                    {cartActionError && (
                      <div className="rounded-md border border-red-300 bg-red-950/40 px-3 py-2 text-sm text-red-200">
                        {cartActionError}
                      </div>
                    )}
                  </div>

                  <div className={`flex justify-end gap-2 border-t px-5 py-3 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-slate-50"}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setShowOrderReviewModal(false);
                        setCartActionError("");
                      }}
                      className={`rounded-lg border px-4 py-2.5 text-sm font-semibold transition ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}`}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSubmitOrderRequest}
                      disabled={!orderReviewAgreed || orderRequestLoading}
                      className="inline-flex items-center gap-2 rounded-lg bg-red-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <CheckCircle size={16} />
                      {orderRequestLoading ? "Submitting..." : "Proceed"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showOrderSuccessModal && orderSuccessData && (
              <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
                <div className={`w-full max-w-md rounded-[26px] border p-6 shadow-[0_24px_80px_rgba(15,23,42,0.18)] ${darkMode ? "border-slate-700 bg-slate-900" : "border-transparent bg-white"}`}>
                  <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full border-2 ${darkMode ? "border-emerald-700 bg-emerald-950/40" : "border-emerald-200 bg-emerald-50"}`}>
                    <CheckCircle className={`h-8 w-8 ${darkMode ? "text-emerald-400" : "text-emerald-600"}`} />
                  </div>

                  <h3 className={`mt-5 text-center text-2xl font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>Order Request Submitted!</h3>

                  <p className={`mt-4 text-center text-sm leading-6 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                    Thank you! Your order request has been received. Our estimating team will contact you shortly to confirm the details and finalize the quotation.
                  </p>

                  <p className={`mt-5 flex items-center justify-center gap-2 text-sm font-medium ${darkMode ? "text-slate-200" : "text-slate-700"}`}>
                    <Phone size={15} className={darkMode ? "text-slate-400" : "text-slate-500"} />
                    Questions? Call us at 09123456789
                  </p>

                  <div className="mt-6 flex gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setShowOrderSuccessModal(false);
                        setOrderSuccessData(null);
                        setActiveTab("orders");
                      }}
                      className="flex-1 rounded-xl border border-red-500 bg-red-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-700"
                    >
                      View Your Orders
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowOrderSuccessModal(false);
                        setOrderSuccessData(null);
                        setActiveTab("products");
                      }}
                      className="flex-1 rounded-xl border border-red-500 bg-transparent px-4 py-3 text-sm font-semibold text-red-400 transition hover:bg-red-950/30"
                    >
                      Continue Browsing
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === "orders" && (
          <>
            <div className="mb-5 flex flex-col gap-4 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className={`text-2xl font-black tracking-[-0.03em] ${darkMode ? "text-white" : "text-slate-900"}`}>My Orders</h2>
                <p className={`mt-1 text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Track progress, payments, and completed projects.</p>
              </div>
              <div className="w-full sm:w-auto lg:hidden">
                <select
                  aria-label="Filter orders"
                  value={orderFilter}
                  onChange={(event) => {
                    setOrderFilter(event.target.value);
                    setOrderPage(1);
                  }}
                  className={`w-full rounded-xl border px-3 py-2.5 text-sm font-semibold outline-none focus:ring-2 focus:ring-red-100 ${darkMode ? "border-slate-700 bg-slate-800 text-slate-100 focus:border-red-500" : "border-slate-200 bg-white text-slate-700 focus:border-red-500"}`}
                >
                  {orderFilterOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className={`hidden max-w-full overflow-x-auto rounded-xl border p-1 lg:block ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-slate-100"}`}>
                <div className="flex w-max items-center gap-1" role="group" aria-label="Filter orders">
                {orderFilterOptions.map((tab) => (
                  <button
                    key={tab.value}
                    type="button"
                    onClick={() => {
                      setOrderFilter(tab.value);
                      setOrderPage(1);
                    }}
                    aria-pressed={orderFilter === tab.value}
                    className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
                      orderFilter === tab.value 
                        ? "bg-red-700 text-white shadow-sm"
                        : darkMode
                          ? "text-slate-300 hover:bg-slate-700 hover:text-white"
                          : "text-slate-600 hover:bg-white hover:text-slate-900"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
                </div>
              </div>
            </div>


            {orderRequestMessage && (
              <div className={`mb-6 rounded-3xl border px-6 py-4 text-sm ${darkMode ? "border-emerald-800 bg-emerald-950/40 text-emerald-300" : "border-emerald-100 bg-emerald-50 text-emerald-700"}`}>
                {orderRequestMessage}
              </div>
            )}

            {ordersLoading ? (
              <div className="space-y-4">
                {[...Array(2)].map((_, index) => (
                  <div key={index} className={`h-20 animate-pulse rounded-xl border ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-white"}`} />
                ))}
              </div>
            ) : filteredOrders.length === 0 ? (
              <div className={`rounded-xl border border-dashed px-6 py-12 text-center ${darkMode ? "border-slate-700 bg-slate-800/60" : "border-slate-300 bg-white"}`}>
                <p className={`font-semibold ${darkMode ? "text-slate-200" : "text-slate-800"}`}>No orders found</p>
                <p className={`mt-1 text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Try another filter to see your orders.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {displayedOrders.map((order, index) => {
                  const orderId = getOrderIdentifier(order, `order-${index}`);
                  const product = order.items?.[0] || {};
                  const orderItems = Array.isArray(order.items) ? order.items : [];
                  const isOrderExpanded = expandedOrderId === orderId;
                  const orderTotal = getOrderTotalValue(order);
                  const paymentSummary = getPaymentSummary(order);
                  const downpaymentAmount = paymentSummary.paidAmount;
                  const requiredPaymentAmount = paymentSummary.requiredAmount;
                  const balanceAmount = paymentSummary.remainingAmount;
                  const isFullyPaid = paymentSummary.status.key === "paid";
                  const paymentStatusClasses = {
                    paid: darkMode ? "border border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border border-emerald-200 bg-emerald-50 text-emerald-700",
                    pending: darkMode ? "border border-amber-500/40 bg-amber-500/10 text-amber-200" : "border border-amber-200 bg-amber-50 text-amber-800",
                    partial_downpayment: darkMode ? "border border-amber-500/40 bg-amber-500/10 text-amber-200" : "border border-amber-200 bg-amber-50 text-amber-800",
                    downpayment: darkMode ? "border border-violet-500/40 bg-violet-500/10 text-violet-200" : "border border-violet-200 bg-violet-50 text-violet-800",
                    partial: darkMode ? "border border-sky-500/40 bg-sky-500/10 text-sky-200" : "border border-sky-200 bg-sky-50 text-sky-800",
                  };
                  const paymentStatus = {
                    label: paymentSummary.status.label,
                    className: paymentStatusClasses[paymentSummary.status.key],
                  };
                  const isBatchOrder = orderItems.length > 1;
                  const orderDisplayName = isBatchOrder ? "Batch Order" : product.name || product.product_name || "Project item";
                  const orderDisplayQuantity = isBatchOrder ? `${orderItems.length} items` : product.quantity ? `Qty ${product.quantity}` : "Qty 1";
                  const orderPreviewItem = isBatchOrder
                    ? orderItems.find((item) => getOrderItemImage(item) !== PRODUCT_IMAGE_PLACEHOLDER) || product
                    : product;
                  const orderDate = formatDateToMMMDDYYYY(order.updatedAt || order.createdAt) || "—";
                  const orderStatusLabel = getOrderStatusLabel(order.status);
                  const hasContractBeenSent =
                    normalizeOrderStatusKey(order?.status) === "contract_sent" ||
                    normalizeOrderStatusKey(order?.contract_status) === "sent" ||
                    (normalizeOrderStatusKey(order?.status) === "site_inspection" && normalizeOrderStatusKey(order?.contract_status) === "sent");
                  const isContractWaitingForCustomer =
                    hasContractBeenSent &&
                    order.order_type !== "walk_in_customer";
                  const isCustomerAcceptedContract = isCustomerContractAccepted(order);
                  const isOnlineContractAccepted = order.acceptedByCustomer === true || (order.contract_status === "accepted" && order.acceptance_method === "online");
                  const isProjectFinished = isOrderCompletedAndReviewable(order);
                  const isOrderCancelled = String(order.status || "").toLowerCase() === "cancelled";
                  const paymentProofSubmission = paymentProofSuccessByOrder[orderId];
                  const lastPaymentProofUrl = paymentProofSubmission?.fileUrl || order.payment_proof_file_url || order.proof_file_url || "";

                  return (
                    <div
                      key={orderId}
                      data-notification-record-id={orderId}
                      className={`overflow-hidden rounded-xl border shadow-sm transition hover:shadow-md ${highlightedOrderId === orderId ? "border-amber-500 bg-amber-50 ring-4 ring-amber-300" : darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-white"}`}
                    >
                      <div className="grid gap-3 p-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-4">
                        <div className="flex min-w-0 items-center gap-3">
                          {isBatchOrder ? (
                            <div className={`relative h-12 w-14 shrink-0 overflow-hidden rounded-[10px] border shadow-sm ${darkMode ? "border-slate-600 bg-slate-700" : "border-slate-200 bg-slate-100"}`}>
                              <img
                                src={getOrderItemImage(orderPreviewItem)}
                                alt={orderPreviewItem.name || orderPreviewItem.product_name || "Batch order preview"}
                                className="h-full w-full object-cover"
                                onError={(event) => {
                                  event.currentTarget.onerror = null;
                                  event.currentTarget.src = PRODUCT_IMAGE_PLACEHOLDER;
                                }}
                              />
                              <span
                                aria-label={`${orderItems.length} items in this batch order`}
                                className="absolute bottom-0.5 right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full border border-white bg-red-700 px-1 text-[10px] font-bold leading-none text-white shadow-sm"
                              >
                                {orderItems.length}
                              </span>
                            </div>
                          ) : (
                            <div className={`h-11 w-11 shrink-0 overflow-hidden rounded-[12px] border shadow-sm sm:h-12 sm:w-12 ${darkMode ? "border-slate-600 bg-slate-700" : "border-red-100 bg-red-50"}`}>
                              <img
                                src={getOrderItemImage(product)}
                                alt={product.name || product.product_name || "Product image"}
                                className="h-full w-full object-cover"
                                onError={(e) => {
                                  e.currentTarget.onerror = null;
                                  e.currentTarget.src = PRODUCT_IMAGE_PLACEHOLDER;
                                }}
                              />
                            </div>
                          )}

                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`text-sm font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>
                                {orderDisplayName}
                              </span>
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${getOrderStatusClasses(order.status)}`}>
                                {orderStatusLabel}
                              </span>
                            </div>
                            <div className={`mt-1 flex flex-wrap items-center gap-x-2 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                              <span>{order.tracking || order._id || "—"}</span>
                              <span aria-hidden="true">·</span>
                              <span>{orderDisplayQuantity}</span>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 sm:flex sm:justify-end sm:gap-5">
                          <div className="text-right sm:min-w-[110px]">
                            <p className={`text-[10px] font-semibold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Total</p>
                            <p className="mt-0.5 text-base font-bold text-red-600">{formatCurrency(orderTotal)}</p>
                          </div>
                          <div className="text-right sm:min-w-[90px]">
                            <p className={`text-[10px] font-semibold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Updated</p>
                            <p className={`mt-0.5 text-xs font-medium ${darkMode ? "text-slate-300" : "text-slate-600"}`}>{orderDate}</p>
                          </div>
                          <div className="col-span-2 flex justify-end sm:col-span-1">
                            <div className="flex items-center gap-2">
                              {canUploadFeedback && orderFilter === "review" && isProjectFinished && isOrderCompletedAndReviewable(order) && !isBatchOrder && !hasOrderReview(order) && (
                                <button
                                  type="button"
                                  onClick={() => openCustomerReviewModal(order)}
                                  className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border px-3 text-[10px] font-black leading-none tracking-[0.02em] shadow-sm transition-all duration-200 ${darkMode ? "border-amber-500/70 bg-amber-500/15 text-amber-200 hover:bg-amber-500/20 hover:text-amber-100 shadow-amber-500/10" : "border-amber-500 bg-amber-400 text-slate-950 hover:bg-amber-300 hover:shadow-amber-500/30"}`}
                                >
                                  <Star size={12} fill="currentColor" className="drop-shadow-[0_0_2px_rgba(0,0,0,0.12)]" aria-hidden="true" />
                                  <span className="whitespace-nowrap">Leave Feedback</span>
                                </button>
                              )}
                              {canUploadFeedback && orderFilter === "review" && isProjectFinished && isOrderCompletedAndReviewable(order) && isBatchOrder && !hasOrderReview(order) && (
                                <button
                                  type="button"
                                  onClick={() => openBatchOrderReviewModal(order)}
                                  className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border px-3 text-[10px] font-black leading-none shadow-sm ${darkMode ? "border-amber-500/70 bg-amber-500/15 text-amber-200" : "border-amber-500 bg-amber-400 text-slate-950"}`}
                                >
                                  <Star size={12} fill="currentColor" aria-hidden="true" />
                                  <span>Review products</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => setExpandedOrderId((prev) => (prev === orderId ? null : orderId))}
                                aria-expanded={isOrderExpanded}
                                className={`inline-flex w-[7.25rem] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition ${darkMode ? "bg-red-600 text-white hover:bg-red-500" : "bg-red-700 text-white hover:bg-red-800"}`}
                              >
                                {isOrderExpanded ? "Hide details" : "View details"}
                                {isOrderExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>

                      {isOrderExpanded && (
                        <div className={`border-t p-3 sm:p-4 ${darkMode ? "border-slate-700 bg-slate-900/60" : "border-slate-200 bg-slate-50"}`}>
                          <div className={`flex flex-col gap-2 pb-3 sm:flex-row sm:items-center sm:justify-between ${darkMode ? "border-b border-slate-700" : "border-b border-slate-200"}`}>
                            <div>
                              <h4 className={`text-base font-black ${darkMode ? "text-white" : "text-slate-900"}`}>
                                {isBatchOrder ? "Batch order" : orderDisplayName}
                              </h4>
                              <p className={`mt-1 text-xs ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                                {order.tracking || order._id || "—"} · {orderDate}
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end">
                              {isOnlineContractAccepted && (
                                <button
                                  type="button"
                                  onClick={() => openContractModal(order)}
                                  className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${darkMode ? "border-slate-600 text-slate-200 hover:bg-slate-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}`}
                                >
                                  View Contract
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => setSelectedOrderForModal(order)}
                                className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition shadow-sm ${darkMode ? "bg-green-600 text-slate-100 hover:bg-green-700" : "bg-green-600 text-white hover:bg-green-700"}`}
                              >
                                View Order Timeline
                              </button>
                            </div>
                          </div>

                          {isContractWaitingForCustomer && (
                            <section className={`mt-4 rounded-xl border p-4 ${darkMode ? "border-amber-500/30 bg-amber-500/10" : "border-amber-200 bg-amber-50"}`}>
                              <h4 className={`text-base font-black ${darkMode ? "text-amber-100" : "text-amber-900"}`}>Contract Acceptance</h4>
                              <p className={`mt-1 text-sm font-bold ${darkMode ? "text-amber-200" : "text-amber-800"}`}>Contract Sent to You</p>
                              <p className={`mt-1 text-sm ${darkMode ? "text-slate-300" : "text-slate-700"}`}>Please review the contract details before accepting.</p>
                              <div className="mt-4 flex flex-wrap gap-2">
                                <button type="button" onClick={() => openContractModal(order)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100">View Contract</button>
                                <button type="button" onClick={() => openContractConfirmModal("decline", orderId)} className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-50">Decline</button>
                                <button type="button" onClick={() => openContractConfirmModal("accept", orderId)} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700">Accept &amp; Sign Contract</button>
                              </div>
                            </section>
                          )}
                          {order.contract_status === "declined" && (
                            <div className={`mt-4 rounded-xl border p-4 ${darkMode ? "border-red-800 bg-red-950/40" : "border-red-200 bg-red-50"}`}>
                              <p className={`text-sm font-bold ${darkMode ? "text-red-300" : "text-red-700"}`}>Contract Declined</p>
                              <p className={`mt-1 text-sm ${darkMode ? "text-slate-300" : "text-slate-700"}`}>{order.contractDeclineReason || "No reason provided."}</p>
                            </div>
                          )}

                          <div className={`mt-4 overflow-hidden rounded-xl border ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-white"}`}>
                            <div className={`divide-y ${darkMode ? "divide-slate-700" : "divide-slate-200"}`}>
                              {orderItems.map((item, itemIndex) => (
                                <div key={`${orderId}-item-${itemIndex}`} className="flex items-center justify-between gap-3 px-3 py-3 sm:px-4">
                                  <div className="flex min-w-0 items-center gap-3">
                                    <div className={`h-12 w-12 shrink-0 overflow-hidden rounded-lg border ${darkMode ? "border-slate-600 bg-slate-700" : "border-slate-200 bg-slate-100"}`}>
                                      <img
                                        src={getOrderItemImage(item)}
                                        alt={item.name || item.product_name || `Product ${itemIndex + 1}`}
                                        className="h-full w-full object-cover"
                                        onError={(e) => {
                                          e.currentTarget.onerror = null;
                                          e.currentTarget.src = PRODUCT_IMAGE_PLACEHOLDER;
                                        }}
                                      />
                                    </div>
                                    <div className="min-w-0">
                                      <p className={`truncate text-sm font-semibold ${darkMode ? "text-white" : "text-slate-900"}`}>
                                        {item.name || item.product_name || `Product ${itemIndex + 1}`}
                                      </p>
                                      <p className={`mt-1 text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                                        {getConfirmationItemDimensionText(item)}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="text-right">
                                    <p className="text-sm font-bold text-red-600">
                                      {formatCurrency(getItemPriceValue(item))}
                                    </p>
                                    {canUploadFeedback && isProjectFinished && isOrderCompletedAndReviewable(order) && (
                                      orderFilter === "reviewed"
                                        ? getOrderItemReview(order, itemIndex)?.submittedAt && (
                                          <div className="mt-1 flex justify-end gap-1.5 sm:gap-3">
                                            <button
                                              type="button"
                                              onClick={() => openOrderReviewDetails(order, itemIndex)}
                                              aria-label={`View review for ${item.name || item.product_name || `Product ${itemIndex + 1}`}`}
                                              title="View review"
                                              className={`inline-flex size-8 items-center justify-center rounded-lg text-xs font-semibold sm:h-auto sm:w-auto sm:justify-start sm:rounded-none sm:p-0 sm:underline sm:underline-offset-2 ${darkMode ? "text-sky-300 hover:bg-slate-700 sm:hover:bg-transparent" : "text-sky-700 hover:bg-sky-50 sm:hover:bg-transparent"}`}
                                            >
                                              <Eye size={13} aria-hidden="true" />
                                              <span className="hidden sm:inline">View review</span>
                                            </button>
                                            {isOrderReviewEditable(order, itemIndex) && (
                                              <button
                                                type="button"
                                                onClick={() => openCustomerReviewModal(order, itemIndex)}
                                                aria-label={`Edit review for ${item.name || item.product_name || `Product ${itemIndex + 1}`}`}
                                                title="Edit review"
                                                className={`inline-flex size-8 items-center justify-center rounded-lg text-xs font-semibold sm:h-auto sm:w-auto sm:justify-start sm:rounded-none sm:p-0 sm:underline sm:underline-offset-2 ${darkMode ? "text-amber-300 hover:bg-slate-700 sm:hover:bg-transparent" : "text-amber-700 hover:bg-amber-50 sm:hover:bg-transparent"}`}
                                              >
                                                <Pencil size={12} aria-hidden="true" />
                                                <span className="hidden sm:inline">Edit review</span>
                                              </button>
                                            )}
                                          </div>
                                        )
                                        : isBatchOrder && (
                                          getOrderItemReview(order, itemIndex)?.submittedAt
                                            ? isOrderReviewEditable(order, itemIndex)
                                              ? (
                                                <button
                                                  type="button"
                                                  onClick={() => openCustomerReviewModal(order, itemIndex)}
                                                  className={`mt-1 text-xs font-semibold underline underline-offset-2 ${darkMode ? "text-amber-300" : "text-amber-700"}`}
                                                >
                                                  Edit review
                                                </button>
                                              )
                                              : <span className={`mt-1 block text-xs font-semibold ${darkMode ? "text-emerald-300" : "text-emerald-700"}`}>Reviewed</span>
                                            : (
                                              <button
                                                type="button"
                                                onClick={() => openCustomerReviewModal(order, itemIndex)}
                                                className={`mt-1 text-xs font-semibold underline underline-offset-2 ${darkMode ? "text-amber-300" : "text-amber-700"}`}
                                              >
                                                Review product
                                              </button>
                                            )
                                        )
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className={`mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-y py-4 sm:grid-cols-4 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                            <div className="flex flex-col gap-1">
                              <span className={`text-[10px] font-semibold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Grand total</span>
                              <span className="text-lg font-bold text-red-600">{formatCurrency(orderTotal)}</span>
                            </div>
                            <div className="flex flex-col gap-1">
                              <span className={`text-[10px] font-semibold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Amount paid</span>
                              <span className="text-lg font-bold text-emerald-600">{formatCurrency(downpaymentAmount)}</span>
                              <span className={`text-[10px] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Required downpayment: {formatCurrency(requiredPaymentAmount)}</span>
                            </div>
                            <div className="flex flex-col gap-1">
                              <span className={`text-[10px] font-semibold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Balance</span>
                              <span className={`text-lg font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>{formatCurrency(balanceAmount)}</span>
                            </div>
                            <div className="flex flex-col gap-1">
                              <span className={`text-[10px] font-semibold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Payment status</span>
                              <span className={`inline-flex items-center justify-center rounded-full px-3 py-2 text-xs font-black uppercase tracking-[0.08em] ${paymentStatus.className}`}>
                                {paymentStatus.label}
                              </span>
                            </div>
                          </div>

                          {isOrderCancelled ? (
                            <div className={`mt-6 rounded-xl border px-4 py-3 text-sm font-semibold ${darkMode ? "border-red-900/60 bg-red-950/30 text-red-200" : "border-red-200 bg-red-50 text-red-700"}`}>
                              This order was cancelled. Payment and cancellation actions are unavailable.
                            </div>
                          ) : !isProjectFinished ? <div className="mt-6 grid gap-3 sm:grid-cols-2">
                            {isFullyPaid ? (
                              <div className={`rounded-xl border px-4 py-3 text-sm font-bold sm:col-span-2 ${darkMode ? "border-emerald-800 bg-emerald-950/40 text-emerald-300" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
                                <p>Payment is fully paid. No additional payment submission is needed.</p>
                                {lastPaymentProofUrl && (
                                  <a
                                    href={ensureAbsoluteUrl(lastPaymentProofUrl)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className={`mt-2 inline-flex items-center gap-1.5 font-bold underline underline-offset-2 ${darkMode ? "text-emerald-200 hover:text-white" : "text-emerald-800 hover:text-emerald-950"}`}
                                  >
                                    <Paperclip size={14} aria-hidden="true" />
                                    View payment proof
                                  </a>
                                )}
                              </div>
                            ) : (paymentProofSubmission || lastPaymentProofUrl) && !isPaymentProofConfirmed(order) ? (
                              <div className={`rounded-xl border px-4 py-3 text-sm font-medium sm:col-span-2 ${darkMode ? "border-sky-800 bg-sky-950/50 text-sky-200" : "border-sky-200 bg-sky-50 text-sky-800"}`}>
                                <p>
                                  We've notified admin that you paid {formatCurrency(paymentProofSubmission?.amount ?? order.payment_proof_amount ?? 0)}. This is pending confirmation — we'll notify you here once it's verified.
                                </p>
                                {lastPaymentProofUrl && (
                                  <a
                                    href={ensureAbsoluteUrl(lastPaymentProofUrl)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className={`mt-2 inline-flex items-center gap-1.5 font-bold underline underline-offset-2 ${darkMode ? "text-sky-200 hover:text-white" : "text-sky-800 hover:text-sky-950"}`}
                                  >
                                    <Paperclip size={14} aria-hidden="true" />
                                    View your last uploaded proof
                                  </a>
                                )}
                              </div>
                            ) : paymentProofOpenOrderId === orderId ? (
                              <div className={`sm:col-span-2 rounded-xl border p-3 sm:p-4 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
                                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                                  <div>
                                    <label htmlFor={`payment-amount-${orderId}`} className={`mb-1.5 block text-xs font-bold ${darkMode ? "text-slate-200" : "text-slate-700"}`}>
                                      Amount paid <span className="text-red-500">(required)</span>
                                    </label>
                                    <p className={`mb-1.5 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                                      Required downpayment: {formatRequiredPaymentAmount(requiredPaymentAmount)}. Enter any amount up to {formatRequiredPaymentAmount(balanceAmount)}.
                                    </p>
                                    <input
                                      id={`payment-amount-${orderId}`}
                                      type="text"
                                      inputMode="decimal"
                                      value={paymentProofForm.amount}
                                      onChange={(event) => setPaymentProofForm((prev) => ({ ...prev, amount: event.target.value }))}
                                      placeholder="₱0.00"
                                      className={`w-full rounded-lg border px-3 py-2.5 text-sm font-semibold outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 ${darkMode ? "border-slate-600 bg-slate-800 text-white placeholder:text-slate-400" : "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400"}`}
                                    />
                                  </div>
                                  <div>
                                    <div className={`mb-1.5 text-xs font-bold ${darkMode ? "text-slate-200" : "text-slate-700"}`}>
                                      Payment proof <span className={`font-normal ${darkMode ? "text-slate-400" : "text-slate-500"}`}>(optional)</span>
                                    </div>
                                    <label
                                      htmlFor={`payment-proof-${orderId}`}
                                      className={`flex min-h-[42px] cursor-pointer items-center gap-2 rounded-lg border border-dashed px-3 py-2 transition focus-within:ring-2 focus-within:ring-emerald-500 ${darkMode ? "border-slate-600 bg-slate-800 hover:border-slate-500" : "border-slate-300 bg-slate-50 hover:border-emerald-400 hover:bg-emerald-50/50"}`}
                                    >
                                      <FileText size={17} className="shrink-0 text-emerald-600" aria-hidden="true" />
                                      <span className={`min-w-0 flex-1 truncate text-xs font-medium ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                                        {paymentProofForm.fileName || "Choose an image or PDF"}
                                      </span>
                                      <input
                                        id={`payment-proof-${orderId}`}
                                        type="file"
                                        accept="image/*,.pdf"
                                        onChange={handlePaymentProofFileChange}
                                        className="sr-only"
                                      />
                                    </label>
                                  </div>
                                </div>

                                {paymentProofError && (
                                  <p role="alert" className="mt-2 text-xs font-semibold text-red-600">{paymentProofError}</p>
                                )}

                                <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setPaymentProofOpenOrderId(null);
                                      setPaymentProofError("");
                                      setPaymentProofForm({ amount: "", fileName: "" });
                                    }}
                                    className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${darkMode ? "border-slate-600 text-slate-300 hover:bg-slate-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => submitPaymentProof(order)}
                                    disabled={paymentProofLoading}
                                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-70"
                                  >
                                    {paymentProofLoading ? "Submitting..." : "Submit Payment Info"}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => isCustomerAcceptedContract && handleOpenPaymentProofForm(orderId)}
                                disabled={!isCustomerAcceptedContract}
                                className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-base font-black text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-emerald-600"
                              >
                                {isCustomerAcceptedContract ? "I've already paid" : "Awaiting contract sign-off"}
                              </button>
                            )}

                            {!isCustomerAcceptedContract && (
                              <button
                                type="button"
                                onClick={() => handleCancelRequest(order)}
                                className={`w-full rounded-xl border px-4 py-3 text-base font-black transition ${darkMode ? "border-red-500/60 bg-red-500/10 text-red-400 hover:bg-red-500/20" : "border-red-500 bg-transparent text-red-600 hover:bg-red-50"}`}
                              >
                                Cancel request
                              </button>
                            )}
                          </div> : null}

                        </div>
                      )}
                    </div>
                  );
                })}

              </div>
            )}

            {!ordersLoading && !isMobile && (
              <div className={`mt-auto flex flex-wrap items-center justify-center gap-3 rounded-xl border px-3 py-2.5 ${darkMode ? "border-slate-700 bg-slate-800/90" : "border-slate-200 bg-white"}`}>
                <p className={`text-xs font-medium ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                  Showing {filteredOrders.length ? pageStart + 1 : 0}-{Math.min(pageStart + ORDER_PAGE_SIZE, filteredOrders.length)} of {filteredOrders.length} orders
                </p>
                <div className="flex items-center justify-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setOrderPage((page) => Math.max(1, page - 1))}
                    disabled={safeOrderPage === 1 || filteredOrders.length === 0}
                    className={`h-8 rounded-lg px-2.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${darkMode ? "bg-slate-700 text-slate-200 hover:bg-slate-600" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
                  >
                    Prev
                  </button>

                  {Array.from({ length: orderPageCount }, (_, index) => index + 1).map((pageNum) => (
                    <button
                      key={pageNum}
                      type="button"
                      onClick={() => setOrderPage(pageNum)}
                      aria-current={safeOrderPage === pageNum ? "page" : undefined}
                      className={`h-8 min-w-8 rounded-lg px-2 text-xs font-black transition ${safeOrderPage === pageNum
                        ? "bg-red-600 text-white shadow-sm shadow-red-200"
                        : darkMode
                          ? "bg-slate-700 text-slate-200 hover:bg-slate-600"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
                    >
                      {pageNum}
                    </button>
                  ))}

                  <button
                    type="button"
                    onClick={() => setOrderPage((page) => Math.min(orderPageCount, page + 1))}
                    disabled={safeOrderPage === orderPageCount || filteredOrders.length === 0}
                    className={`h-8 rounded-lg px-2.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${darkMode ? "bg-slate-700 text-slate-200 hover:bg-slate-600" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}

            {cancelRequestModal.open && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
                <div className={`w-full max-w-md rounded-2xl border p-6 shadow-2xl ${darkMode ? "border-slate-700 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-900"}`}>
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
                    <AlertTriangle size={22} />
                  </div>
                  <h3 className="mt-4 text-center text-xl font-black">Cancel request?</h3>
                  <p className={`mt-2 text-center text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                    This will mark the current order request as cancelled. You can still review it afterwards in your order list.
                  </p>

                  <div className="mt-6 flex gap-3">
                    <button
                      type="button"
                      onClick={() => setCancelRequestModal({ open: false, order: null })}
                      className={`flex-1 rounded-xl px-4 py-3 text-sm font-black transition ${darkMode ? "bg-slate-700 text-slate-100 hover:bg-slate-600" : "bg-slate-200 text-slate-700 hover:bg-slate-300"}`}
                    >
                      Keep request
                    </button>
                    <button
                      type="button"
                      onClick={confirmCancelRequest}
                      className="flex-1 rounded-xl bg-red-600 px-4 py-3 text-sm font-black text-white transition hover:bg-red-700"
                    >
                      Confirm cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {selectedOrderForModal && (
          <OrderTimelineModal
            key={selectedOrderForModal._id || selectedOrderForModal.id}
            order={selectedOrderForModal}
            darkMode={darkMode}
            onClose={() => setSelectedOrderForModal(null)}
            getItemImage={getOrderItemImage}
            getItemDimension={getConfirmationItemDimensionText}
            fallbackImage={PRODUCT_IMAGE_PLACEHOLDER}
          />
        )}

        {reviewDetailsOrder && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="customer-review-details-title"
              className={`flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border shadow-2xl ${darkMode ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}
            >
              <header className={`flex items-start justify-between gap-4 border-b px-5 py-4 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                <div className="min-w-0">
                  <h2 id="customer-review-details-title" className="text-lg font-bold">Your product review</h2>
                  <p className={`mt-1 truncate text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                    {reviewDetailsOrder.reviewProductName} · {reviewDetailsOrder.tracking || reviewDetailsOrder._id || reviewDetailsOrder.id || "Order"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setReviewDetailsOrder(null)}
                  aria-label="Close review details"
                  className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${darkMode ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                >
                  <X size={17} aria-hidden="true" />
                </button>
              </header>

              <div className="flex-1 space-y-4 overflow-y-auto p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1" aria-label={`${Number(reviewDetailsOrder.review?.rating || 0)} out of 5 stars`}>
                    {renderRatingStars(reviewDetailsOrder.review?.rating, 20)}
                    <span className={`ml-1 text-sm font-semibold ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                      {Number(reviewDetailsOrder.review?.rating || 0)}/5
                    </span>
                  </div>
                  <span className={`text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                    {reviewDetailsOrder.review?.submittedAt ? formatDateToMMMDDYYYY(reviewDetailsOrder.review.submittedAt) : "—"}
                  </span>
                </div>
                {reviewDetailsOrder.review?.title && <h3 className="text-base font-semibold">{reviewDetailsOrder.review.title}</h3>}
                <p className={`whitespace-pre-line break-words text-sm leading-6 ${darkMode ? "text-slate-300" : "text-slate-700"}`}>
                  {reviewDetailsOrder.review?.comment || "No written feedback."}
                </p>
                <section>
                  <h3 className={`mb-2 text-sm font-semibold ${darkMode ? "text-slate-200" : "text-slate-800"}`}>Photos</h3>
                  {(reviewDetailsOrder.review?.photos || []).length > 0 ? (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {reviewDetailsOrder.review.photos.map((photo, index) => (
                        <a
                          key={`${photo}-${index}`}
                          href={ensureAbsoluteUrl(photo)}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open review photo ${index + 1}`}
                          className={`aspect-square overflow-hidden rounded-lg border ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-slate-50"}`}
                        >
                          <img src={ensureAbsoluteUrl(photo)} alt={`Review photo ${index + 1}`} className="h-full w-full object-cover" />
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p className={`text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>No photos submitted.</p>
                  )}
                </section>
              </div>

              <footer className={`flex justify-end gap-2 border-t px-5 py-3 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-slate-50"}`}>
                <button
                  type="button"
                  onClick={() => setReviewDetailsOrder(null)}
                  className={`rounded-lg border px-4 py-2 text-sm font-semibold ${darkMode ? "border-slate-600 text-slate-200 hover:bg-slate-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}`}
                >
                  Close
                </button>
                {canUploadFeedback && isOrderReviewEditable(reviewDetailsOrder, reviewDetailsOrder.reviewItemIndex) && (
                  <button
                    type="button"
                    onClick={() => {
                      const order = reviewDetailsOrder;
                      setReviewDetailsOrder(null);
                      openCustomerReviewModal(order, order.reviewItemIndex);
                    }}
                    className="rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white hover:bg-red-800"
                  >
                    Edit Review
                  </button>
                )}
              </footer>
            </section>
          </div>
        )}

        {showCustomerReviewModal && canUploadFeedback && selectedReviewOrder && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3 backdrop-blur-sm">
            <div
              key={`${selectedReviewOrder._id || selectedReviewOrder.id}-${selectedReviewOrder.reviewItemIndex ?? "order"}`}
              role="dialog"
              aria-modal="true"
              aria-labelledby="customer-review-title"
              className={`flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl shadow-2xl ${darkMode ? "bg-slate-900" : "bg-white"}`}
            >
              <div className={`flex items-center justify-between border-b px-5 py-3.5 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                <div>
                  <h2 id="customer-review-title" className={`text-lg font-bold ${darkMode ? "text-white" : "text-slate-950"}`}>
                    {batchReviewSession
                      ? `Product ${batchReviewSession.currentPosition + 1} of ${batchReviewSession.itemIndexes.length}`
                      : hasOrderReview(selectedReviewOrder) ? "Edit Review" : "Write a Review"}
                  </h2>
                  <p className={`text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                    {batchReviewSession ? "Review each product in your batch order." : "Share your experience after your completed order."}
                  </p>
                  {selectedReviewOrder.reviewProductName && Array.isArray(selectedReviewOrder.items) && selectedReviewOrder.items.length > 1 && (
                    <p className={`mt-1 text-xs font-semibold ${darkMode ? "text-amber-300" : "text-amber-700"}`}>
                      Product: {selectedReviewOrder.reviewProductName}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={closeCustomerReviewModal}
                  aria-label="Close review form"
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-full border text-lg transition ${darkMode ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-slate-200 text-slate-600 hover:bg-slate-100"}`}
                >
                  ×
                </button>
              </div>
              <div className="flex-1 space-y-4 overflow-y-auto p-5">
                <div className="space-y-2">
                  <p className={`text-sm font-semibold ${darkMode ? "text-white" : "text-slate-900"}`}>Overall Rating</p>
                  <div className="flex gap-2" role="group" aria-label="Overall rating">
                    {Array.from({ length: 5 }).map((_, index) => {
                      const value = index + 1;
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => handleOrderReviewChange("rating", value)}
                          aria-label={`${value} star${value === 1 ? "" : "s"}`}
                          aria-pressed={orderReviewForm.rating === value}
                          className={`inline-flex h-10 w-10 items-center justify-center rounded-md transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${orderReviewForm.rating >= value ? "text-amber-400" : darkMode ? "text-slate-500 hover:text-amber-400" : "text-slate-400 hover:text-amber-400"}`}
                        >
                          <Star size={18} fill="currentColor" aria-hidden="true" />
                        </button>
                      );
                    })}
                  </div>
                  <p className={`mt-2 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Choose 1 to 5 stars.</p>
                </div>
                <div className="space-y-3">
                  <div>
                    <label htmlFor="review-template" className={`text-sm font-semibold ${darkMode ? "text-slate-200" : "text-slate-900"}`}>Review template</label>
                    <select
                      id="review-template"
                      defaultValue=""
                      onChange={(event) => {
                        const template = ORDER_REVIEW_TEMPLATES.find((entry) => entry.value === event.target.value);
                        if (!template) return;
                        setOrderReviewForm((current) => ({ ...current, title: template.title, comment: template.comment }));
                        setReviewFormError("");
                      }}
                      className={`mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:border-red-500 ${darkMode ? "border-slate-700 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-900"}`}
                    >
                      <option value="">Choose a starting point</option>
                      {ORDER_REVIEW_TEMPLATES.map((template) => (
                        <option key={template.value} value={template.value}>{template.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="review-title" className={`text-sm font-semibold ${darkMode ? "text-slate-200" : "text-slate-900"}`}>Review Title</label>
                    <input
                      id="review-title"
                      type="text"
                      value={orderReviewForm.title}
                      onChange={(e) => handleOrderReviewChange("title", e.target.value)}
                      placeholder="Excellent Service"
                      className={`mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:border-red-500 ${darkMode ? "border-slate-700 bg-slate-800 text-white placeholder:text-slate-500" : "border-slate-200 bg-white text-slate-900 placeholder:text-slate-400"}`}
                    />
                  </div>
                  <div>
                    <label htmlFor="review-comment" className={`text-sm font-semibold ${darkMode ? "text-slate-200" : "text-slate-900"}`}>Review Comment</label>
                    <textarea
                      id="review-comment"
                      value={orderReviewForm.comment}
                      onChange={(e) => handleOrderReviewChange("comment", e.target.value)}
                      placeholder="Tell us about the product quality, installation, and service experience."
                      rows={4}
                      maxLength={500}
                      className={`mt-1.5 w-full resize-y rounded-xl border px-3 py-2.5 text-sm outline-none focus:border-red-500 ${darkMode ? "border-slate-700 bg-slate-800 text-white placeholder:text-slate-500" : "border-slate-200 bg-white text-slate-900 placeholder:text-slate-400"}`}
                    />
                    <p className={`mt-1 flex justify-between text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                      <span>Required. 10–500 characters.</span>
                      <span>{orderReviewForm.comment.length}/500</span>
                    </p>
                  </div>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between gap-3">
                      <p className={`text-sm font-semibold ${darkMode ? "text-slate-200" : "text-slate-900"}`}>Upload Photos <span className={`font-normal ${darkMode ? "text-slate-400" : "text-slate-500"}`}>(optional)</span></p>
                      <span className={`text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{orderReviewForm.photos.length}/5</span>
                    </div>
                    <label
                      htmlFor="review-photos"
                      className={`flex cursor-pointer items-center gap-3 rounded-xl border border-dashed px-4 py-3 transition focus-within:ring-2 focus-within:ring-red-500 ${darkMode ? "border-slate-600 bg-slate-800 hover:border-slate-500" : "border-slate-300 bg-slate-50 hover:border-red-300 hover:bg-red-50/50"}`}
                    >
                      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${darkMode ? "bg-slate-700 text-red-300" : "bg-white text-red-600 shadow-sm"}`}>
                        <ImagePlus size={19} aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                        <span className={`block text-sm font-semibold ${darkMode ? "text-slate-100" : "text-slate-800"}`}>Choose project photos</span>
                        <span className={`mt-0.5 block text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Select up to 5 images from your device</span>
                      </span>
                      <input
                        id="review-photos"
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={handleOrderReviewPhotoChange}
                        className="sr-only"
                      />
                    </label>
                    {orderReviewForm.photoPreviews.length > 0 && (
                      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
                        {orderReviewForm.photoPreviews.map((src, index) => (
                          <div key={index} className="relative overflow-hidden rounded-lg border border-slate-200">
                            <img src={ensureAbsoluteUrl(src)} alt={`Preview ${index + 1}`} className="h-20 w-full object-cover" />
                            <button
                              type="button"
                              onClick={() => handleRemoveReviewPhoto(index)}
                              aria-label={`Remove photo ${index + 1}`}
                              className="absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-full bg-white text-slate-700 shadow"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {reviewFormError && (
                  <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{reviewFormError}</div>
                )}
              </div>
              <div className={`flex flex-col-reverse gap-2 border-t px-5 py-3 sm:flex-row sm:justify-end ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-slate-50"}`}>
                <button
                  type="button"
                  onClick={closeCustomerReviewModal}
                  className={`rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}`}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitCustomerReview}
                  disabled={reviewFormLoading}
                  className="rounded-xl bg-red-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {reviewFormLoading
                    ? "Submitting..."
                    : batchReviewSession
                      ? batchReviewSession.currentPosition < batchReviewSession.itemIndexes.length - 1
                        ? "Save & Next Product"
                        : "Save & Finish"
                      : hasOrderReview(selectedReviewOrder) ? "Update Review" : "Submit Review"}
                </button>
              </div>
            </div>
          </div>
        )}

        {showProductReviewModal && canUploadFeedback && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="product-reviews-title"
              className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200"
            >
              <div className="flex flex-col gap-3 border-b border-slate-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-red-600">Product feedback</p>
                  <h2 id="product-reviews-title" className="mt-1 text-xl font-black text-slate-950">Customer Reviews</h2>
                  <p className="mt-1 text-sm text-slate-600">{selectedProduct?.product_name || selectedProduct?.name || "Product"}</p>
                </div>
                <button
                  type="button"
                  onClick={closeProductReviewModal}
                  className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Close
                </button>
              </div>
              <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
                <section className="grid gap-5 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-[180px_minmax(0,1fr)] sm:p-5" aria-label="Product rating summary">
                  <div className="flex flex-col items-center justify-center text-center sm:border-r sm:border-slate-200 sm:pr-5">
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Average rating</p>
                    {totalRatedReviews > 0 ? (
                      <>
                        <p className="mt-2 text-5xl font-black leading-none text-slate-950">{productReviewAverageRating}</p>
                        <div className="mt-2 flex items-center gap-0.5 text-amber-500" aria-label={`${productReviewAverageRating} out of 5 stars`}>
                          {renderRatingStars(averageProductReviewRating, 16)}
                        </div>
                      </>
                    ) : (
                      <p className="mt-3 text-lg font-bold text-slate-700">No ratings yet</p>
                    )}
                    <p className="mt-2 text-xs font-medium text-slate-500">
                      {totalRatedReviews} rating{totalRatedReviews === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="flex flex-col justify-center gap-2.5">
                    {[5, 4, 3, 2, 1].map((star) => {
                      const count = reviewRatingCounts.find((entry) => entry.star === star)?.count || 0;
                      const percentage = totalRatedReviews ? Math.round((count / totalRatedReviews) * 100) : 0;
                      return (
                        <div key={star} className="grid grid-cols-[42px_minmax(0,1fr)_28px] items-center gap-3 text-xs">
                          <span className="inline-flex items-center gap-1 font-semibold text-slate-600">
                            {star}<Star size={12} fill="currentColor" className="text-amber-500" aria-hidden="true" />
                          </span>
                          <div className="h-2 overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
                            <div className="h-full rounded-full bg-amber-400 transition-[width]" style={{ width: `${percentage}%` }} />
                          </div>
                          <span className="text-right font-medium text-slate-500">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <div className="flex min-w-0 items-center justify-between gap-3">
                  <h3 className="shrink-0 text-sm font-bold text-slate-900">
                    Reviews <span className="font-medium text-slate-500">({productReviews.length})</span>
                  </h3>
                  <div className="flex min-w-0 flex-1 justify-end overflow-hidden">
                    <div className="flex w-max gap-1.5 overflow-x-auto pb-1" role="group" aria-label="Filter reviews by rating">
                      <button
                        type="button"
                        onClick={() => setSelectedReviewRatingTab(0)}
                        aria-pressed={selectedReviewRatingTab === 0}
                        className={`shrink-0 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                          selectedReviewRatingTab === 0
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        All
                      </button>
                      {reviewRatingCounts.map(({ star, count }) => (
                        <button
                          key={star}
                          type="button"
                          onClick={() => setSelectedReviewRatingTab(star)}
                          aria-pressed={selectedReviewRatingTab === star}
                          className={`shrink-0 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                            selectedReviewRatingTab === star
                              ? "border-amber-400 bg-amber-50 text-amber-900"
                              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          {star} star ({count})
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {filteredProductReviews.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 px-6 py-12 text-center">
                    <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-amber-50 text-amber-500">
                      <Star size={20} aria-hidden="true" />
                    </span>
                    <h3 className="mt-3 text-base font-bold text-slate-900">
                      {productReviews.length === 0 ? "No reviews yet" : `No ${selectedReviewRatingTab}-star reviews`}
                    </h3>
                    <p className="mx-auto mt-1 max-w-sm text-sm leading-5 text-slate-500">
                      {productReviews.length === 0
                        ? "Customer feedback for this product will appear here."
                        : "Try another rating filter to see more customer feedback."}
                    </p>
                    {productReviews.length > 0 && selectedReviewRatingTab > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedReviewRatingTab(0)}
                        className="mt-4 rounded-lg px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50"
                      >
                        Show all reviews
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
                    {filteredProductReviews.map((review, index) => (
                      <article key={`${review.orderId || index}-${review.submittedAt || index}`} className="p-4 sm:p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-slate-900">{review.customerName || "Anonymous"}</p>
                            <p className="mt-1 text-xs text-slate-500">{formatDateToMMMDDYYYY(review.submittedAt) || "Date unavailable"}</p>
                          </div>
                          <div className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-900">
                            {Number(review.rating) > 0 ? (
                              <>
                                <span className="inline-flex items-center gap-0.5 text-amber-500" aria-label={`${review.rating} out of 5 stars`}>
                                  {renderRatingStars(review.rating, 13)}
                                </span>
                                <span>{Number(review.rating).toFixed(1)}</span>
                              </>
                            ) : "No rating"}
                          </div>
                        </div>
                        <h4 className="mt-3 text-base font-bold text-slate-900">{review.title || "Customer review"}</h4>
                        <p className="mt-1.5 whitespace-pre-line text-sm leading-6 text-slate-600">{review.comment || "No review comment."}</p>
                        {review.photos?.length > 0 && (
                          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                            {review.photos.map((photo, photoIndex) => (
                              <img
                                key={photoIndex}
                                src={photo}
                                alt={`Review photo ${photoIndex + 1}`}
                                className="aspect-[4/3] w-full rounded-lg object-cover"
                              />
                            ))}
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === "cart" && canRequestOrders && (
          <div className={`flex min-h-0 flex-1 flex-col rounded-2xl border p-4 shadow-sm sm:p-6 ${darkMode ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}>
            <div className="flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className={`text-xs font-bold uppercase tracking-[0.16em] ${darkMode ? "text-red-300" : "text-red-700"}`}>Your order</p>
                <h2 className={`mt-1 text-2xl font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>Shopping Cart</h2>
              </div>
              <div className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold ${darkMode ? "bg-slate-800 text-slate-200" : "bg-slate-100 text-slate-700"}`}>
                <ShoppingCart size={16} aria-hidden="true" />
                {cartQuantity} item{cartQuantity === 1 ? "" : "s"}
              </div>
            </div>
            {!cartLoaded ? (
              <div className="mt-5 grid min-h-0 flex-1 gap-5 lg:grid-cols-[minmax(0,1fr)_280px] xl:gap-6" aria-live="polite" aria-busy="true">
                <section className="flex min-h-0 min-w-0 flex-col">
                  <div className={`flex min-h-[53px] items-center border-b pb-4 text-sm font-semibold ${darkMode ? "border-slate-700 text-slate-300" : "border-slate-200 text-slate-600"}`}>
                    Loading your cart...
                  </div>
                  <div className={`mt-1 flex h-[min(560px,60dvh)] flex-none items-center justify-center rounded-lg ${darkMode ? "bg-slate-800/50 text-slate-400" : "bg-slate-50 text-slate-500"}`}>
                    <span className="animate-pulse text-sm">Retrieving saved items</span>
                  </div>
                </section>
                <aside className={`min-h-[220px] rounded-2xl border p-5 ${darkMode ? "border-slate-700 bg-slate-800/50" : "border-slate-200 bg-slate-50"}`} aria-hidden="true">
                  <div className={`h-5 w-32 animate-pulse rounded ${darkMode ? "bg-slate-700" : "bg-slate-200"}`} />
                  <div className={`mt-6 h-4 animate-pulse rounded ${darkMode ? "bg-slate-700" : "bg-slate-200"}`} />
                  <div className={`mt-4 h-10 animate-pulse rounded ${darkMode ? "bg-slate-700" : "bg-slate-200"}`} />
                  <div className={`mt-5 h-11 animate-pulse rounded ${darkMode ? "bg-slate-700" : "bg-slate-200"}`} />
                </aside>
              </div>
            ) : cartItems.length === 0 ? (
              <div className="flex min-h-64 flex-col items-center justify-center py-12 text-center">
                <span className={`flex h-14 w-14 items-center justify-center rounded-full ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-500"}`}>
                  <ShoppingCart size={24} aria-hidden="true" />
                </span>
                <h3 className={`mt-4 text-lg font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>Your cart is empty</h3>
                <p className={`mt-1 text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Browse products and add something to get started.</p>
                <button
                  type="button"
                  onClick={() => setActiveTab("products")}
                  className="mt-5 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700"
                >
                  Browse Products
                </button>
              </div>
            ) : (<>
              <div className="mt-5 grid gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_280px] xl:gap-6">
                <section className="flex min-w-0 flex-col lg:min-h-0">
                  <div className={`flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                    <label className={`inline-flex items-center gap-3 text-sm font-semibold ${darkMode ? "text-slate-200" : "text-slate-700"}`}>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={(e) => handleSelectAllCartItems(e.target.checked)}
                        className="h-5 w-5 rounded border-gray-300 text-red-600 focus:ring-red-500"
                      />
                      Select All ({cartItems.length} Item{cartItems.length === 1 ? "" : "s"})
                    </label>
                    <div className={`text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                      {selectedItemCount} of {cartItems.length} selected
                    </div>
                  </div>

                  <div
                    className={`mt-1 divide-y overflow-x-hidden ${darkMode ? "divide-slate-700" : "divide-slate-200"} lg:h-[min(560px,60dvh)] lg:flex-none lg:overflow-y-auto lg:pr-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-slate-200 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-400 hover:[&::-webkit-scrollbar-thumb]:bg-slate-500 dark:[&::-webkit-scrollbar-track]:bg-slate-700 dark:[&::-webkit-scrollbar-thumb]:bg-slate-500 dark:hover:[&::-webkit-scrollbar-thumb]:bg-slate-400`}
                    style={{ scrollbarWidth: "thin", scrollbarColor: darkMode ? "#64748b #334155" : "#94a3b8 #e2e8f0" }}
                  >
                    {cartItems.map((item) => (
                      <article key={item.cartId || item._id || item.name} className="grid grid-cols-[auto_64px_minmax(0,1fr)] items-center gap-3 py-4 sm:grid-cols-[auto_72px_minmax(0,1fr)_auto] sm:gap-4">
                        <input
                          type="checkbox"
                          checked={Boolean(item.selected)}
                          onChange={() => handleToggleCartItem(item.cartId)}
                          aria-label={`Select ${item.name || "item"}`}
                          className="h-5 w-5 rounded border-gray-300 text-red-600 focus:ring-red-500"
                        />
                        <div className={`h-16 w-16 overflow-hidden rounded-xl border sm:h-[72px] sm:w-[72px] ${darkMode ? "border-slate-600 bg-slate-800" : "border-slate-200 bg-slate-100"}`}>
                          <img src={getProductImage(item)} alt={item.name} className="h-full w-full object-cover" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                            <p className={`min-w-0 truncate font-semibold ${darkMode ? "text-white" : "text-slate-900"}`}>{item.name}</p>
                            <p className="text-sm font-bold text-red-600">{formatCurrency(getItemPriceValue(item))}</p>
                          </div>
                          {(() => {
                            const measurementDetails = getCartItemMeasurementDetails(item);
                            if (measurementDetails) {
                              return (
                                <div className={`mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                                  <span>{measurementDetails.dimensions} · {measurementDetails.area}</span>
                                  {!item.is_estimate && <span>{measurementDetails.unitRate}</span>}
                                </div>
                              );
                            }

                            return (
                              <div className={`mt-1 flex flex-wrap items-center gap-3 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                                <span>Qty: {item.quantity}</span>
                                {item.is_estimate && item.width && item.height && (
                                  <span>{item.width} {item.measurementUnit || item.unit || ""} × {item.height} {item.measurementUnit || item.unit || ""}</span>
                                )}
                              </div>
                            );
                          })()}
                          {item.is_estimate && (
                            <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${darkMode ? "bg-amber-500/10 text-amber-300" : "bg-amber-50 text-amber-700"}`}>
                              Estimated price
                            </span>
                          )}
                        </div>
                        <div className="col-span-3 flex items-center justify-between gap-3 sm:col-span-1 sm:justify-end">
                          <div className={`inline-flex items-center overflow-hidden rounded-lg border ${darkMode ? "border-slate-600 bg-slate-800" : "border-slate-200 bg-white"}`}>
                            <button
                              type="button"
                              onClick={() => handleUpdateCartQuantity(item.cartId, -1)}
                              aria-label={`Decrease ${item.name || "item"} quantity`}
                              className={`inline-flex h-9 w-9 items-center justify-center transition ${darkMode ? "text-slate-200 hover:bg-slate-700" : "text-slate-700 hover:bg-slate-100"}`}
                            >
                              <Minus size={15} />
                            </button>
                            <div className={`min-w-9 text-center text-sm font-semibold ${darkMode ? "text-white" : "text-slate-900"}`}>
                              {item.quantity}
                            </div>
                            <button
                              type="button"
                              onClick={() => handleUpdateCartQuantity(item.cartId, 1)}
                              aria-label={`Increase ${item.name || "item"} quantity`}
                              className={`inline-flex h-9 w-9 items-center justify-center transition ${darkMode ? "text-slate-200 hover:bg-slate-700" : "text-slate-700 hover:bg-slate-100"}`}
                            >
                              <Plus size={15} />
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveFromCart(item.cartId)}
                            aria-label={`Remove ${item.name || "item"} from cart`}
                            title="Remove item"
                            className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border transition ${darkMode ? "border-red-900/70 text-red-300 hover:bg-red-950/50" : "border-red-200 text-red-600 hover:bg-red-50"}`}
                          >
                            <Trash2 size={16} aria-hidden="true" />
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>

                <aside className={`self-start rounded-2xl border p-4 shadow-lg sm:p-5 lg:sticky lg:top-24 lg:shadow-none ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-slate-50"}`}>
                  <h3 className={`text-lg font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>Order Summary</h3>

                  <div className={`mt-4 flex items-center justify-between gap-4 text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                    <span>{selectedItemCount} selected · {selectedQuantityTotal} total</span>
                    <span>{formatCurrency(selectedSubtotal)}</span>
                  </div>
                  <div className={`mt-3 border-t pt-4 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                    <div className={`flex items-center justify-between gap-4 font-semibold ${darkMode ? "text-white" : "text-slate-900"}`}>
                      <span>Estimated total</span>
                      <span className="text-lg font-bold text-red-600">{formatCurrency(selectedSubtotal)}</span>
                    </div>
                    <div className={`mt-2 flex items-center justify-between gap-4 text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                      <span>50% downpayment</span>
                      <span>{formatCurrency(selectedSubtotal * 0.5)}</span>
                    </div>
                  </div>

                  <div className="mt-5 space-y-2.5">
                    <button
                      type="button"
                      onClick={openBatchOrderModal}
                      disabled={checkoutLoading || selectedItemCount === 0}
                      className="w-full rounded-lg bg-red-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Checkout Selected ({selectedItemCount})
                    </button>
                    <button
                      type="button"
                      onClick={handleDeleteSelectedItems}
                      disabled={selectedItemCount === 0}
                      className={`w-full rounded-lg border px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${darkMode ? "border-red-900 text-red-300 hover:bg-red-950/40" : "border-red-200 text-red-700 hover:bg-red-50"}`}
                    >
                      Delete Selected ({selectedItemCount})
                    </button>
                  </div>
                </aside>
              </div>

              {checkoutError && <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">{checkoutError}</div>}
              {checkoutMessage && <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-700">{checkoutMessage}</div>}
            </>) }
          </div>
        )}

        {activeTab === "about" && (
          <div className={`rounded-[28px] border p-8 shadow-sm sm:p-10 ${darkMode ? "border-slate-700 bg-slate-800 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}>
            <div className={`flex items-center justify-between gap-4 border-b pb-4 ${darkMode ? "border-slate-700" : "border-slate-100"}`}>
              <div className="flex items-center gap-3">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-red-50 text-red-600">
                  <Info size={20} />
                </span>
                <h2 className={`text-3xl font-black tracking-tight ${darkMode ? "text-white" : "text-slate-950"}`}>About Us</h2>
              </div>
              <span className={`rounded-full border px-5 py-2 text-[11px] font-black uppercase tracking-[0.2em] ${darkMode ? "border-slate-600 bg-slate-700 text-slate-100" : "border-red-200 bg-white text-red-700"}`}>
                ACGC Services
              </span>
            </div>

            <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_1fr]">
              <div className="space-y-5">
                <div>
                  <p className={`text-xs font-black uppercase tracking-[0.28em] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Who We Are</p>
                  <p className={`mt-3 text-sm leading-8 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                    ACGC Aluminum & Glass Construction provides durable and professional aluminum and glass solutions for residential and commercial spaces. We combine accurate measurements, quality materials, and dependable installation services to help every project feel complete.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className={`rounded-2xl border p-5 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-100 bg-slate-50"}`}>
                    <p className="text-[11px] font-black uppercase tracking-[0.26em] text-red-700">Our Mission</p>
                    <p className={`mt-3 text-sm leading-7 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                      To deliver clean, dependable, and customer-focused aluminum and glass workmanship.
                    </p>
                  </div>
                  <div className={`rounded-2xl border p-5 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-100 bg-slate-50"}`}>
                    <p className="text-[11px] font-black uppercase tracking-[0.26em] text-red-700">Our Work</p>
                    <p className={`mt-3 text-sm leading-7 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                      Windows, doors, partitions, shutters, safety glass, and custom aluminum fabrication.
                    </p>
                  </div>
                </div>

                <div className={`rounded-2xl border p-5 ${darkMode ? "border-red-900 bg-red-950/60" : "border-red-100 bg-red-50"}`}>
                  <p className="text-[11px] font-black uppercase tracking-[0.25em] text-red-700">Our Promise</p>
                  <p className={`mt-3 text-sm leading-7 ${darkMode ? "text-slate-200" : "text-slate-700"}`}>
                    Every job is handled with honest guidance, careful project planning, and professional execution.
                  </p>
                </div>
              </div>

              <div className="rounded-[24px] bg-slate-950 p-6 text-white">
                <div className="flex items-center justify-between border-b border-white/10 pb-4">
                  <span className="text-[11px] font-black uppercase tracking-[0.26em] text-red-300">Our Process</span>
                  <span className="rounded-full border border-white/20 px-4 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-white">01 → 04</span>
                </div>
                <div className="mt-6 space-y-5">
                  {[
                    ["Consultation", "Learn your project needs and timeline."],
                    ["Measurement", "Plan the precise fit and materials."],
                    ["Fabrication", "Produce the aluminum and glass elements."],
                    ["Installation", "Finish the project with quality workmanship."]
                  ].map(([title, desc], index) => (
                    <div key={title} className="flex items-start gap-3">
                      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-600 text-[11px] font-black text-white">{String(index + 1).padStart(2, "0")}</span>
                      <div className="pt-0.5">
                        <p className="text-sm font-black uppercase tracking-[0.16em] text-white">{title}</p>
                        <p className="mt-1 text-xs leading-6 text-slate-300">{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "notifications" && (
          <>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
              <div>
                <h2 className={`text-2xl font-bold ${darkMode ? "text-white" : "text-slate-950"}`}>Notifications</h2>
                <p className={darkMode ? "text-slate-300" : "text-slate-500"}>Stay updated on your orders and project status.</p>
              </div>
            </div>

            <div className={`mb-6 inline-flex flex-wrap gap-1 rounded-2xl border p-1 ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-slate-100"}`}>
              {[
                ["all", "All", customerNotificationItems.length],
                ["unread", "Unread", unreadNotificationCount],
                ["read", "Read", readNotificationCount],
              ].map(([filter, label, count]) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setNotificationFilter(filter)}
                  className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                    notificationFilter === filter
                      ? darkMode
                        ? "bg-slate-950 text-white shadow-sm"
                        : "bg-white text-slate-950 shadow-sm"
                      : darkMode
                        ? "text-slate-300 hover:bg-slate-700"
                        : "text-slate-600 hover:bg-white/70"
                  }`}
                >
                  {label} ({count})
                </button>
              ))}
            </div>

            {ordersLoading ? (
              <div className="space-y-4">
                {[...Array(3)].map((_, index) => (
                  <div key={index} className="animate-pulse rounded-3xl bg-white p-8 shadow" />
                ))}
              </div>
            ) : filteredNotifications.length === 0 ? (
              <div className={`rounded-3xl p-10 text-center shadow ${darkMode ? "bg-slate-800 text-slate-200" : "bg-white text-gray-600"}`}>
                <p className={darkMode ? "text-slate-300" : "text-gray-600"}>{notificationFilter === "all" ? "No notifications yet. You'll see updates about your orders here." : `No ${notificationFilter} notifications.`}</p>
              </div>
            ) : (
              <div className="space-y-4">
                {[...filteredNotifications]
                  .sort(sortCustomerNotificationsNewestFirst)
                  .map((order) => {
                    const product = order.items?.[0] || {};
                    const isRead = readNotificationIds.has(order.notificationId);
                    const status = normalizeOrderStatusKey(order?.status);
                    const contractStatus = normalizeOrderStatusKey(order?.contract_status);
                    const isPaymentNotification = ["payment", "payment_confirmed"].includes(order.notificationType);
                    const isPaymentConfirmationNotification = order.notificationType === "payment_confirmed";
                    const isDelayNotification = order.notificationType === "delay";
                    const isContractReady =
                      status === "contract_sent" ||
                      (status === "site_inspection" && contractStatus === "sent") ||
                      contractStatus === "sent";
                    const isContractNotification = !isPaymentNotification && !isDelayNotification && (
                      order.notificationType === "contract" ||
                      isContractReady ||
                      status === "contract_accepted" ||
                      contractStatus === "accepted"
                    );
                    const notificationMessage = () => {
                      if (isDelayNotification) return getDelayNotificationMessage(order);
                      if (isPaymentNotification) {
                        if (isPaymentConfirmationNotification) {
                          return `Your payment of ${formatCurrency(order.payment_proof_amount)} has been confirmed by our team.`;
                        }
                        return `Your payment proof for ${formatCurrency(order.payment_proof_amount)} has been sent for confirmation.`;
                      }
                      if (isContractReady) {
                        return "A contract has been sent for your review and acceptance.";
                      }

                      switch (status) {
                        case "order_submitted":
                          return "Your order has been submitted and is awaiting admin review.";
                        case "admin_review":
                          return "Your order is under admin review.";
                        case "site_inspection":
                          return "Your project site inspection is scheduled.";
                        case "contract_accepted":
                          return "Your contract has been accepted. Fabrication is starting soon.";
                        case "fabrication":
                          return "Your project is currently in fabrication.";
                        case "installation":
                          return "Your project installation is in progress.";
                        case "completed":
                          return "Your project has been completed successfully!";
                        case "cancelled":
                          return "Your order has been cancelled.";
                        default:
                          return `Order status: ${getOrderStatusLabel(order.status)}`;
                      }
                    };

                    const notificationIcon = () => {
                      if (isPaymentNotification) return "text-emerald-600";
                      if (normalizeOrderStatusKey(order?.status) === "completed") return "text-emerald-600";
                      if (normalizeOrderStatusKey(order?.status) === "cancelled") return "text-red-600";
                      if (isContractReady || ["contract_sent", "contract_accepted"].includes(status) || ["sent", "accepted"].includes(contractStatus)) return "text-blue-600";
                      return "text-amber-600";
                    };

                    return (
                      <div
                        key={order.notificationId}
                        className={`rounded-[28px] border p-5 shadow-sm transition-colors ${
                          isRead
                            ? darkMode ? "border-slate-700 bg-slate-800/60" : "border-slate-200 bg-white"
                            : darkMode ? "border-red-400/50 bg-slate-800/90" : "border-red-300/80 bg-red-50/40"
                        }`}
                      >
                        <div className="flex gap-4">
                          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${darkMode ? "bg-slate-700" : "bg-slate-100"} ${notificationIcon()}`}>
                            <Bell size={20} />
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h3 className={`font-semibold break-words ${darkMode ? "text-white" : "text-slate-950"}`}>{product.name || "Project Update"}</h3>
                                  {!isRead && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[9px] font-bold uppercase text-red-700">New</span>}
                                </div>
                                <p className={`mt-1 text-sm ${isRead ? darkMode ? "text-slate-400" : "text-slate-500" : darkMode ? "text-slate-200" : "text-slate-700"}`}>{notificationMessage()}</p>
                                <p className="mt-2 text-xs text-slate-400">{order.tracking}</p>
                              </div>
                              <span className={`inline-flex shrink-0 items-center rounded-full px-3 py-1 text-xs font-semibold ${getOrderStatusClasses(isDelayNotification ? "Delayed" : order.status)}`}>
                                {isDelayNotification ? "Delayed" : getOrderStatusLabel(order.status)}
                              </span>
                            </div>

                            <div className={`mt-3 flex items-center justify-between text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                              <span className={isRead ? "text-slate-400" : darkMode ? "font-medium text-slate-300" : "font-medium text-slate-600"} title={formatDateTimeToMMMDDYYYY(order.notificationDate) || undefined}>
                                {formatTimeAgo(order.notificationDate)}
                              </span>
                              <button
                                onClick={() => openOrderDetailsFromNotification(order, order.notificationId)}
                                className={darkMode ? "text-white hover:text-red-300 font-semibold transition" : "text-slate-950 hover:text-red-600 font-semibold transition"}
                              >
                                {isContractNotification ? "View Contract" : "View Order"}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </>
        )}

        {activeTab === "profile" && (
          <>
          <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 lg:py-8">
            <section className={`overflow-hidden rounded-[18px] border ${darkMode ? "border-slate-700 bg-slate-800 text-slate-100" : "border-slate-200 bg-white text-slate-950"}`}>
              <div
                aria-hidden="true"
                className={`h-[84px] border-b ${darkMode ? "border-slate-700 bg-brand-dark-fill/10" : "border-slate-200 bg-brand/[0.07]"}`}
              />
              <div className="flex flex-wrap items-end justify-between gap-4 px-6 pb-5.5">
                <div className="flex min-w-0 flex-1 items-end gap-4">
                  <div className={`-mt-[42px] flex size-[84px] shrink-0 items-center justify-center rounded-full border-4 text-[26px] font-medium text-white ${darkMode ? "border-slate-800 bg-brand-dark-fill" : "border-white bg-brand"}`} aria-hidden="true">
                    {profileInitials}
                  </div>
                  <div className="min-w-0 pb-1">
                    <h1 className="truncate text-2xl font-medium">{profileDisplayName}</h1>
                    <p className={`truncate text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{profileEmail || "Email not set"}</p>
                  </div>
                </div>
                <Button
                  type="button"
                  onClick={() => setProfileEditing(true)}
                  variant="outline"
                  size="lg"
                  className={`h-10 shrink-0 gap-2 rounded-[10px] border px-4 text-sm font-medium transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${darkMode ? "border-slate-600 text-slate-200 hover:border-brand-dark-text hover:text-brand-dark-text" : "border-slate-300 text-slate-700 hover:border-brand hover:text-brand"}`}
                >
                  <User size={16} aria-hidden="true" />
                  Edit profile
                </Button>
              </div>
            </section>

            <div className="mt-4 grid grid-cols-1 gap-4 min-[640px]:grid-cols-[repeat(auto-fit,minmax(280px,1fr))]">
            <button
              type="button"
              onClick={() => {
                setContractHistoryTab("accepted");
                setWarrantyHistoryTab(null);
                setActiveTab("contracts");
              }}
              className={`group flex w-full min-w-0 items-center gap-4 rounded-2xl border px-5 py-4.5 text-left transition-all motion-reduce:transition-none hover:-translate-y-0.5 hover:border-brand/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${darkMode ? "border-slate-700 bg-slate-800 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}
            >
              <span className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${darkMode ? "bg-brand-dark-fill/15 text-brand-dark-text" : "bg-brand/[0.08] text-brand"}`}>
                <FileText size={22} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[17px] font-medium">Contracts</span>
                <span className={`mt-0.5 block text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{customerContracts.length} active</span>
              </span>
              <span className={`flex size-[34px] shrink-0 items-center justify-center rounded-full border transition-colors motion-reduce:transition-none group-hover:border-brand group-hover:bg-brand group-hover:text-white ${darkMode ? "border-slate-600 text-slate-400" : "border-slate-200 text-slate-500"}`}>
                <ArrowRight size={16} aria-hidden="true" />
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("about")}
              className={`group flex w-full min-w-0 items-center gap-4 rounded-2xl border px-5 py-4.5 text-left transition-all motion-reduce:transition-none hover:-translate-y-0.5 hover:border-brand/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${darkMode ? "border-slate-700 bg-slate-800 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}
            >
              <span className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${darkMode ? "bg-brand-dark-fill/15 text-brand-dark-text" : "bg-brand/[0.08] text-brand"}`}>
                <Info size={22} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[17px] font-medium">About Us</span>
                <span className={`mt-0.5 block text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>About ACGC Glass &amp; Aluminum Services</span>
              </span>
              <span className={`flex size-[34px] shrink-0 items-center justify-center rounded-full border transition-colors motion-reduce:transition-none group-hover:border-brand group-hover:bg-brand group-hover:text-white ${darkMode ? "border-slate-600 text-slate-400" : "border-slate-200 text-slate-500"}`}>
                <ArrowRight size={16} aria-hidden="true" />
              </span>
            </button>
            </div>
          </div>

          {profileEditing && (
          createPortal(
          <div className="fixed inset-0 z-[90] overflow-y-auto bg-slate-950/55 px-3 py-4 backdrop-blur-sm sm:px-6 sm:py-8">
          <div role="dialog" aria-modal="true" aria-labelledby="customer-profile-settings-title" className="mx-auto max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl overflow-y-auto overscroll-contain">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className={`rounded-2xl shadow p-4 sm:p-5 ${darkMode ? "bg-slate-800 text-slate-100" : "bg-white text-slate-900"}`}>
              <div className="flex flex-col items-center">
                <div className="relative">
                  <img
                    src="https://i.pravatar.cc/300"
                    alt="User avatar"
                    className="h-28 w-28 rounded-full object-cover border-4 border-red-100"
                  />
                  <button className="absolute bottom-2 right-2 bg-red-600 p-2.5 text-white rounded-full shadow-lg hover:bg-red-700">
                    <Camera size={16} />
                  </button>
                </div>

                <h2 className={`mt-4 text-xl font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>{`${profileForm.first_name || user?.first_name || ""} ${profileForm.last_name || user?.last_name || ""}`.trim() || "Customer"}</h2>
                <p className={darkMode ? "text-sm text-slate-300 capitalize" : "text-sm text-gray-500 capitalize"}>{user?.role || "customer"}</p>

                <div className="mt-5 w-full space-y-3">
                  <div className={`rounded-xl p-3.5 flex items-center gap-3 ${darkMode ? "bg-slate-900" : "bg-gray-50"}`}>
                    <Mail className="text-red-600" size={18} />
                    <div>
                      <p className={darkMode ? "text-xs text-slate-400" : "text-xs text-gray-500"}>Email</p>
                      <p className={`text-sm font-medium ${darkMode ? "text-white" : "text-slate-900"}`}>{profileForm.email}</p>
                    </div>
                  </div>

                  <div className={`rounded-xl p-3.5 flex items-center gap-3 ${darkMode ? "bg-slate-900" : "bg-gray-50"}`}>
                    <Phone className="text-red-600" size={18} />
                    <div>
                      <p className={darkMode ? "text-xs text-slate-400" : "text-xs text-gray-500"}>Phone</p>
                      <p className={`text-sm font-medium ${darkMode ? "text-white" : "text-slate-900"}`}>{profileForm.phone || "Not set"}</p>
                    </div>
                  </div>

                  <div className={`rounded-xl p-3.5 flex items-center gap-3 ${darkMode ? "bg-slate-900" : "bg-gray-50"}`}>
                    <ShieldCheck className="text-red-600" size={18} />
                    <div>
                      <p className={darkMode ? "text-xs text-slate-400" : "text-xs text-gray-500"}>Role</p>
                      <p className={`text-sm font-medium capitalize ${darkMode ? "text-white" : "text-slate-900"}`}>{user?.role || "customer"}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className={`flex min-h-0 flex-col xl:col-span-2 rounded-2xl shadow p-4 sm:p-5 ${darkMode ? "bg-slate-800" : "bg-white"}`}>
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <User size={24} className="text-red-600" />
                <div>
                  <h2 id="customer-profile-settings-title" className={`text-xl font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>Profile Settings</h2>
                  <p className={darkMode ? "text-sm text-slate-300" : "text-sm text-gray-500"}>Update your account and password settings.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setProfileEditing(false)}
                  className={`ml-auto rounded-lg border px-3 py-2 text-xs font-semibold ${darkMode ? "border-slate-600 text-slate-200 hover:bg-slate-700" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}
                >
                  Back to profile
                </button>
              </div>

              {profileError && (
                <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">
                  {profileError}
                </div>
              )}

              {profileMessage && (
                <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-700">
                  {profileMessage}
                </div>
              )}

              <div className="mt-3 flex min-h-0 flex-1 flex-col">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className={`rounded-2xl border p-1.5 flex overflow-hidden ${darkMode ? "bg-slate-900 border-slate-700" : "bg-gray-100 border-gray-200"}`}>
                    <button
                      type="button"
                      onClick={() => setProfileTab("profile")}
                      className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                        profileTab === "profile"
                          ? darkMode ? "bg-slate-700 text-red-400 shadow-sm" : "bg-white text-red-600 shadow-sm"
                          : darkMode ? "text-slate-300 hover:text-red-300" : "text-gray-600 hover:text-red-600"
                      }`}
                    >
                      Profile
                    </button>
                    <button
                      type="button"
                      onClick={() => setProfileTab("security")}
                      className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                        profileTab === "security"
                          ? darkMode ? "bg-slate-700 text-red-400 shadow-sm" : "bg-white text-red-600 shadow-sm"
                          : darkMode ? "text-slate-300 hover:text-red-300" : "text-gray-600 hover:text-red-600"
                      }`}
                    >
                      Security
                    </button>
                  </div>
                </div>

                <div className="mt-3 max-h-[min(42dvh,26rem)] overflow-y-auto overscroll-contain lg:max-h-[min(48dvh,30rem)]">
                  {profileTab === "profile" ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className={darkMode ? "text-xs font-medium text-slate-300" : "text-xs font-medium text-gray-600"}>First Name</label>
                        <div className="relative mt-1.5">
                          <User size={16} className="absolute left-3.5 top-3.5 text-gray-400" />
                          <input
                            type="text"
                            name="first_name"
                            value={profileForm.first_name}
                            onChange={handleProfileChange}
                            placeholder="First Name"
                            className={`w-full pl-10 pr-3 py-2.5 border rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500 ${darkMode ? "bg-slate-900 border-slate-700 text-white placeholder:text-slate-400" : "bg-white border-slate-200"}`}
                          />
                        </div>
                      </div>

                      <div>
                        <label className={darkMode ? "text-xs font-medium text-slate-300" : "text-xs font-medium text-gray-600"}>Last Name</label>
                        <div className="relative mt-1.5">
                          <User size={16} className="absolute left-3.5 top-3.5 text-gray-400" />
                          <input
                            type="text"
                            name="last_name"
                            value={profileForm.last_name}
                            onChange={handleProfileChange}
                            placeholder="Last Name"
                            className={`w-full pl-10 pr-3 py-2.5 border rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500 ${darkMode ? "bg-slate-900 border-slate-700 text-white placeholder:text-slate-400" : "bg-white border-slate-200"}`}
                          />
                        </div>
                      </div>

                      <div>
                        <label className={darkMode ? "text-xs font-medium text-slate-300" : "text-xs font-medium text-gray-600"}>Phone Number</label>
                        <div className="relative mt-1.5">
                          <Phone size={16} className="absolute left-3.5 top-3.5 text-gray-400" />
                          <input
                            type="text"
                            name="phone"
                            value={profileForm.phone}
                            onChange={handleProfileChange}
                            placeholder="Phone Number"
                            className={`w-full pl-10 pr-3 py-2.5 border rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500 ${darkMode ? "bg-slate-900 border-slate-700 text-white placeholder:text-slate-400" : "bg-white border-slate-200"}`}
                          />
                        </div>
                      </div>

                      <div>
                        <label className={darkMode ? "text-xs font-medium text-slate-300" : "text-xs font-medium text-gray-600"}>Email Address</label>
                        <div className="relative mt-1.5">
                          <Mail size={16} className="absolute left-3.5 top-3.5 text-gray-400" />
                          <input
                            type="email"
                            name="email"
                            value={profileForm.email}
                            disabled
                            className={`w-full pl-10 pr-3 py-2.5 border rounded-xl ${darkMode ? "bg-slate-900 border-slate-700 text-slate-400" : "bg-gray-100 text-gray-500 border-slate-200"}`}
                          />
                        </div>
                      </div>

                      <div className="md:col-span-2">
                        <label className={darkMode ? "text-xs font-medium text-slate-300" : "text-xs font-medium text-gray-600"}>Street Address</label>
                        <input
                          type="text"
                          name="street_address"
                          value={profileForm.street_address}
                          onChange={handleProfileChange}
                          placeholder="Street address"
                          className={`w-full mt-1.5 px-3 py-2.5 border rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500 ${darkMode ? "bg-slate-900 border-slate-700 text-white placeholder:text-slate-400" : "bg-white border-slate-200"}`}
                        />
                      </div>

                      <div>
                        <label className={darkMode ? "text-xs font-medium text-slate-300" : "text-xs font-medium text-gray-600"}>City</label>
                        <input
                          type="text"
                          name="city"
                          value={profileForm.city}
                          onChange={handleProfileChange}
                          placeholder="City"
                          className={`w-full mt-1.5 px-3 py-2.5 border rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500 ${darkMode ? "bg-slate-900 border-slate-700 text-white placeholder:text-slate-400" : "bg-white border-slate-200"}`}
                        />
                      </div>

                      <div>
                        <label className={darkMode ? "text-xs font-medium text-slate-300" : "text-xs font-medium text-gray-600"}>Province</label>
                        <input
                          type="text"
                          name="province"
                          value={profileForm.province}
                          onChange={handleProfileChange}
                          placeholder="Province"
                          className={`w-full mt-1.5 px-3 py-2.5 border rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500 ${darkMode ? "bg-slate-900 border-slate-700 text-white placeholder:text-slate-400" : "bg-white border-slate-200"}`}
                        />
                      </div>

                      <div className="md:col-span-2">
                        <label className={darkMode ? "text-xs font-medium text-slate-300" : "text-xs font-medium text-gray-600"}>Zip Code</label>
                        <input
                          type="text"
                          name="zip_code"
                          value={profileForm.zip_code}
                          onChange={handleProfileChange}
                          placeholder="Zip Code"
                          className={`w-full mt-1.5 px-3 py-2.5 border rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500 ${darkMode ? "bg-slate-900 border-slate-700 text-white placeholder:text-slate-400" : "bg-white border-slate-200"}`}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="md:col-span-3">
                        <label className="text-sm font-medium text-gray-600">Current Password</label>
                        <input
                          type="password"
                          name="current_password"
                          value={profileForm.current_password}
                          onChange={handleProfileChange}
                          placeholder="Enter current password"
                          className="w-full mt-2 px-4 py-3 border rounded-2xl focus:outline-none focus:ring-2 focus:ring-red-500"
                        />
                      </div>

                      <div>
                        <label className="text-sm font-medium text-gray-600">New Password</label>
                        <input
                          type="password"
                          name="new_password"
                          value={profileForm.new_password}
                          onChange={handleProfileChange}
                          placeholder="Enter new password"
                          className="w-full mt-2 px-4 py-3 border rounded-2xl focus:outline-none focus:ring-2 focus:ring-red-500"
                        />
                      </div>

                      <div>
                        <label className="text-sm font-medium text-gray-600">Confirm Password</label>
                        <input
                          type="password"
                          name="confirm_password"
                          value={profileForm.confirm_password}
                          onChange={handleProfileChange}
                          placeholder="Confirm new password"
                          className="w-full mt-2 px-4 py-3 border rounded-2xl focus:outline-none focus:ring-2 focus:ring-red-500"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className={`sticky bottom-0 z-10 -mx-4 -mb-4 mt-3 flex justify-end border-t px-4 py-2.5 sm:-mx-5 sm:-mb-5 sm:px-5 ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-white"}`}>
                <button
                  onClick={handleProfileSave}
                  disabled={profileSaving}
                  className="bg-red-600 text-white px-4 py-2.5 rounded-xl flex items-center gap-2 text-sm font-semibold hover:bg-red-700 transition disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Save size={16} />
                  {profileSaving ? "Saving..." : "Save Changes"}
                </button>
              </div>

              {showPasswordModal && (
                <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4 py-6">
                  <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
                    <h3 className="text-xl font-semibold mb-3">Confirm Profile Changes</h3>
                    <p className="text-gray-600 mb-4">
                      Enter your current password to confirm saving profile changes.
                    </p>
                    {passwordModalError && (
                      <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">
                        {passwordModalError}
                      </div>
                    )}
                    <input
                      type="password"
                      name="current_password"
                      value={profileForm.current_password}
                      onChange={handleProfileChange}
                      placeholder="Current password"
                      className="w-full border rounded-2xl px-4 py-3 mb-4 focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                    <div className="flex justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setShowPasswordModal(false);
                          setPasswordModalError("");
                        }}
                        className="px-4 py-3 rounded-2xl border border-gray-200 bg-white hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          setPasswordModalError("");
                          if (!profileForm.current_password) {
                            setPasswordModalError("Please enter your current password.");
                            return;
                          }
                          const success = await performProfileSave();
                          if (success) {
                            setShowPasswordModal(false);
                          }
                        }}
                        className="px-4 py-3 rounded-2xl bg-red-600 text-white hover:bg-red-700"
                      >
                        Confirm
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          </div>
          </div>,
          document.body
          )
          )}
          </>
        )}

        {activeTab === "contracts" && (
          <>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
              <div>
                <h2 className={`text-2xl font-black tracking-[-0.03em] ${darkMode ? "text-white" : "text-slate-950"}`}>My Contracts & Warranties</h2>
                <p className={darkMode ? "text-slate-400" : "text-slate-500"}>Review your contracts and warranty coverage.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => { setContractHistoryTab("accepted"); setWarrantyHistoryTab(null); }}
                  className={`px-4 py-2 rounded-2xl font-black text-sm transition ${
                    contractHistoryTab === "accepted" && !warrantyHistoryTab
                      ? "bg-red-600 text-white shadow-sm"
                      : darkMode
                        ? "bg-slate-800 text-slate-200 border border-slate-600 hover:bg-slate-700"
                        : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  Contracts ({customerContracts.length})
                </button>
                <button
                  type="button"
                  onClick={() => { setContractHistoryTab("rejected"); setWarrantyHistoryTab(null); }}
                  className={`px-4 py-2 rounded-2xl font-black text-sm transition ${
                    contractHistoryTab === "rejected" && !warrantyHistoryTab
                      ? "bg-red-600 text-white shadow-sm"
                      : darkMode
                        ? "bg-slate-800 text-slate-200 border border-slate-600 hover:bg-slate-700"
                        : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  Declined Contracts ({rejectedContracts.length})
                </button>
              </div>
            </div>

            {ordersLoading ? (
              <div className="space-y-4">
                {[...Array(2)].map((_, index) => (
                  <div key={index} className={`animate-pulse rounded-[28px] p-8 shadow ${darkMode ? "bg-slate-800" : "bg-white"}`} />
                ))}
              </div>
            ) : warrantyHistoryTab ? (
              warrantiesInTab.length === 0 ? (
                <div className={`rounded-[28px] border p-10 text-center shadow-sm ${darkMode ? "border-slate-700 bg-slate-800" : "border-red-200 bg-white"}`}>
                  <p className={darkMode ? "text-slate-300" : "text-gray-600"}>No {warrantyHistoryTab === "active" ? "active" : "expired"} warranties found.</p>
                </div>
              ) : (
                <>
                <div className={`hidden overflow-hidden rounded-[28px] border shadow-[0_18px_45px_rgba(127,29,29,0.08)] md:block ${darkMode ? "border-slate-700 bg-slate-800" : "border-red-200 bg-white"}`}>
                  <table className="min-w-full table-fixed border-separate border-spacing-0 text-left">
                    <thead className="bg-gradient-to-r from-red-700 via-red-600 to-red-500">
                      <tr>
                        <th className="w-[14%] px-6 py-4 text-xs font-black uppercase tracking-[0.24em] text-white text-center">Tracking No.</th>
                        <th className="w-[16%] px-6 py-4 text-xs font-black uppercase tracking-[0.24em] text-white">Product</th>
                        <th className="w-[16%] px-6 py-4 text-xs font-black uppercase tracking-[0.24em] text-white text-center">Warranty Period</th>
                        <th className="w-[14%] px-6 py-4 text-xs font-black uppercase tracking-[0.24em] text-white text-center">Start Date</th>
                        <th className="w-[14%] px-6 py-4 text-xs font-black uppercase tracking-[0.24em] text-white text-center">Expiry Date</th>
                        <th className="w-[14%] px-6 py-4 text-xs font-black uppercase tracking-[0.24em] text-white text-center">Status</th>
                        <th className="w-[12%] px-6 py-4 text-xs font-black uppercase tracking-[0.24em] text-white text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {warrantiesInTab.map((order) => {
                        const product = order.items?.[0] || {};
                        const warrantyStartDate = formatDateToMMMDDYYYY(order.warranty_start_date) || "—";
                        const warrantyExpiryDate = formatDateToMMMDDYYYY(order.warranty_expiry_date) || "—";
                        const isActive = warrantyHistoryTab === "active";
                        const statusClass = isActive
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-orange-100 text-orange-700";
                        const statusLabel = isActive ? "Active" : "Expired";

                        return (
                          <tr key={order.warranty_record_id || order._id || order.tracking} className={`border-t transition ${darkMode ? "border-slate-700 hover:bg-slate-700/60" : "border-red-100 hover:bg-red-50/70"}`}>
                            <td className="px-6 py-5 align-middle text-sm font-black text-red-700 text-center">{order.tracking || order._id || "—"}</td>
                            <td className={`px-6 py-5 align-middle text-sm ${darkMode ? "text-slate-300" : "text-slate-700"}`}>
                              <span className={`font-black ${darkMode ? "text-white" : "text-slate-900"}`}>{product.name || product.product_name || "Product"}</span>
                            </td>
                            <td className={`px-6 py-5 align-middle text-sm font-medium text-center ${darkMode ? "text-slate-400" : "text-slate-600"}`}>{order.warranty_period || "—"}</td>
                            <td className={`px-6 py-5 align-middle text-sm font-medium text-center ${darkMode ? "text-slate-400" : "text-slate-600"}`}>{warrantyStartDate}</td>
                            <td className={`px-6 py-5 align-middle text-sm font-medium text-center ${darkMode ? "text-slate-400" : "text-slate-600"}`}>{warrantyExpiryDate}</td>
                            <td className="px-6 py-5 align-middle text-center">
                              <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-black leading-tight ${statusClass}`}>{statusLabel}</span>
                            </td>
                            <td className="px-6 py-5 align-middle text-center">
                              <div className="flex flex-wrap justify-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setSelectedOrderForModal(order)}
                                  className="rounded-2xl bg-[#101114] px-3 py-2 text-xs font-black text-white transition hover:bg-black shadow-sm"
                                >
                                  View Details
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="space-y-3 md:hidden">
                  {warrantiesInTab.map((order) => {
                    const product = order.items?.[0] || {};
                    const warrantyStartDate = formatDateToMMMDDYYYY(order.warranty_start_date) || "—";
                    const warrantyExpiryDate = formatDateToMMMDDYYYY(order.warranty_expiry_date) || "—";
                    const isActive = warrantyHistoryTab === "active";
                    const statusClass = isActive
                      ? darkMode ? "bg-emerald-500/15 text-emerald-300" : "bg-emerald-100 text-emerald-700"
                      : darkMode ? "bg-orange-500/15 text-orange-300" : "bg-orange-100 text-orange-700";

                    return (
                      <article key={order.warranty_record_id || order._id || order.tracking} className={`rounded-2xl border p-4 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className={`break-words text-sm font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>{product.name || product.product_name || "Product"}</h3>
                            <p className="mt-1 break-all font-mono text-xs text-slate-500">{order.tracking || order._id || "—"}</p>
                          </div>
                          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${statusClass}`}>{isActive ? "Active" : "Expired"}</span>
                        </div>
                        <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3">
                          <div className="min-w-0">
                            <dt className={`text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Warranty</dt>
                            <dd className={`mt-1 text-sm ${darkMode ? "text-slate-200" : "text-slate-700"}`}>{order.warranty_period || "—"}</dd>
                          </div>
                          <div className="min-w-0">
                            <dt className={`text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Start date</dt>
                            <dd className={`mt-1 text-sm ${darkMode ? "text-slate-200" : "text-slate-700"}`}>{warrantyStartDate}</dd>
                          </div>
                          <div className="col-span-2 min-w-0">
                            <dt className={`text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Expiry date</dt>
                            <dd className={`mt-1 text-sm ${darkMode ? "text-slate-200" : "text-slate-700"}`}>{warrantyExpiryDate}</dd>
                          </div>
                        </dl>
                        <button
                          type="button"
                          onClick={() => setSelectedOrderForModal(order)}
                          className={`mt-4 w-full rounded-xl px-3 py-2.5 text-sm font-semibold ${darkMode ? "bg-slate-700 text-white hover:bg-slate-600" : "bg-slate-900 text-white hover:bg-slate-800"}`}
                        >
                          View Details
                        </button>
                      </article>
                    );
                  })}
                </div>
                </>
              )
            ) : contractsInTab.length === 0 ? (
              <div className={`rounded-[28px] border p-10 text-center shadow-sm ${darkMode ? "border-slate-700 bg-slate-800" : "border-red-200 bg-white"}`}>
                <p className={darkMode ? "text-slate-300" : "text-gray-600"}>No {contractHistoryTab === "accepted" ? "accepted" : "rejected"} contracts found yet.</p>
              </div>
            ) : (
              <>
                <div className={`space-y-3 rounded-[28px] border p-3 shadow-[0_18px_45px_rgba(127,29,29,0.08)] sm:p-4 ${darkMode ? "border-slate-700 bg-slate-900" : "border-red-200 bg-slate-50"}`}>
                {displayedContracts.map((order) => {
                  const product = order.items?.[0] || {};
                  const statusLabel = getContractStatusLabel(order);
                  const statusClass = normalizeOrderStatusKey(order?.contract_status) === "accepted" || normalizeOrderStatusKey(order?.status) === "contract_accepted"
                    ? darkMode
                      ? "border border-emerald-400/30 bg-emerald-500/15 text-emerald-300"
                      : "bg-emerald-100 text-emerald-700"
                    : darkMode
                      ? "border border-red-400/30 bg-red-500/15 text-red-300"
                      : "bg-red-100 text-red-700";
                  const orderDate = formatDateToMMMDDYYYY(order.updatedAt || order.createdAt) || "—";

                  return (
                    <article key={order._id || order.tracking} className={`overflow-hidden rounded-[20px] border shadow-[0_8px_18px_rgba(15,23,42,0.04)] transition hover:shadow-[0_10px_24px_rgba(15,23,42,0.08)] ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-white"}`}>
                      <div className="grid min-w-0 items-center gap-4 p-4 xl:grid-cols-[minmax(0,2.1fr)_minmax(150px,0.8fr)_minmax(150px,0.8fr)_minmax(140px,0.75fr)_auto]">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] border text-lg font-black ${darkMode ? "border-red-900 bg-red-950/50 text-red-300" : "border-red-100 bg-red-50 text-red-700"}`}>
                            <FileText size={21} />
                          </div>
                          <div className="min-w-0">
                            <p className={`truncate text-base font-black ${darkMode ? "text-white" : "text-slate-900"}`}>{product.name || product.product_name || "Project"}</p>
                            <p className={`mt-1 text-xs font-semibold ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{order.tracking || order._id || "—"}</p>
                          </div>
                        </div>

                        <div className="min-w-0 text-center xl:text-left">
                          <p className={`text-[9px] font-black uppercase tracking-[0.18em] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Amount</p>
                          <p className="mt-1 text-base font-black text-red-600 sm:text-lg">{formatCurrency(order.contract_amount || order.total_amount)}</p>
                        </div>

                        <div className="min-w-0 text-center xl:text-left">
                          <p className={`text-[9px] font-black uppercase tracking-[0.18em] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Status</p>
                          <span className={`mt-1 inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-black leading-tight ${statusClass}`}>{statusLabel}</span>
                        </div>

                        <div className="min-w-0 text-center xl:text-left">
                          <p className={`text-[9px] font-black uppercase tracking-[0.18em] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Date</p>
                          <p className={`mt-1 text-xs font-semibold ${darkMode ? "text-slate-300" : "text-slate-700"}`}>{orderDate}</p>
                        </div>

                        <div className="flex min-w-0 flex-wrap justify-center gap-2 xl:justify-end">
                          <button type="button" onClick={() => openContractModal(order)} className="rounded-[10px] bg-red-600 px-3.5 py-2 text-xs font-black text-white transition hover:bg-red-700">
                            View Contract
                          </button>
                          <button type="button" onClick={() => setSelectedOrderForModal(order)} className="rounded-[10px] bg-[#101114] px-3.5 py-2 text-xs font-black text-white transition hover:bg-black">
                            Order Details
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
                </div>

                {contractPageCount > 1 && !isMobile && (
                  <div className={`mt-4 flex flex-wrap items-center justify-center gap-2 rounded-2xl border p-3 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
                    <button
                      type="button"
                      onClick={() => setContractPage((page) => Math.max(1, page - 1))}
                      disabled={safeContractPage === 1}
                      className={`rounded-xl border px-3 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
                    >
                      Previous
                    </button>
                    {Array.from({ length: contractPageCount }, (_, index) => index + 1).map((pageNumber) => (
                      <button
                        key={pageNumber}
                        type="button"
                        onClick={() => setContractPage(pageNumber)}
                        className={`h-9 min-w-9 rounded-xl px-2 text-sm font-black transition ${safeContractPage === pageNumber ? "bg-red-600 text-white" : darkMode ? "border border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
                      >
                        {pageNumber}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setContractPage((page) => Math.min(contractPageCount, page + 1))}
                      disabled={safeContractPage === contractPageCount}
                      className={`rounded-xl border px-3 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {!isMobile && (
          <footer className={`relative left-1/2 -mb-6 ${activeTab === "orders" ? "mt-0" : "mt-8"} w-screen -translate-x-1/2 overflow-hidden bg-[#232b3d] text-white`}>
          <div className="mx-auto max-w-7xl px-8 pt-8 pb-5">
            <div className="grid grid-cols-1 gap-8 sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <img src={logo} alt="logo" className="size-12 shrink-0 object-contain" />
                  <div>
                    <h3 className="text-[17px] font-medium text-white">ACGC Aluminum Services</h3>
                    <p className="text-sm text-slate-300">Premium Glass &amp; Aluminum Solutions</p>
                  </div>
                </div>
              </div>

              <div className="min-w-0">
                <h4 className="mb-3 text-[15px] font-medium text-white">Quick Links</h4>
                <div className="flex flex-col gap-2.5 text-sm text-slate-300">
                  <p className="w-fit transition-colors motion-reduce:transition-none hover:text-white hover:underline hover:underline-offset-[3px]">Home</p>
                  <p className="w-fit transition-colors motion-reduce:transition-none hover:text-white hover:underline hover:underline-offset-[3px]">Browse Products</p>
                  <p className="w-fit transition-colors motion-reduce:transition-none hover:text-white hover:underline hover:underline-offset-[3px]">Track Order</p>
                  <p className="w-fit transition-colors motion-reduce:transition-none hover:text-white hover:underline hover:underline-offset-[3px]">About Us</p>
                </div>
              </div>

              <div className="min-w-0">
                <h4 className="mb-3 text-[15px] font-medium text-white">Contact</h4>
                <div className="flex flex-col gap-2.5 text-sm text-slate-300">
                  <p className="flex min-w-0 items-start gap-3"><Mail size={16} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" /><span className="break-words">Email: acgc.services00@email.com</span></p>
                  <p className="flex min-w-0 items-start gap-3"><Phone size={16} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" /><span>Phone: +63 900 000 0000</span></p>
                  <p className="flex min-w-0 items-start gap-3"><MapPin size={16} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" /><span>Philippines</span></p>
                </div>
              </div>
            </div>

            <div className="mt-7 border-t border-white/15 pt-4.5 text-center text-[13px] text-slate-300">
              © 2026 ACGC Aluminum Services — All Rights Reserved.
            </div>
          </div>
          </footer>
        )}

        <ContractModal
          isOpen={showContractModal}
          onClose={closeContractModal}
          inspection={contractPreviewOrder}
          contractData={contractPreviewData}
          onDownloadPNG={isContractAccepted ? downloadAcceptedContractPNG : undefined}
          onPrint={isContractAccepted ? printAcceptedContract : undefined}
          onAccept={() => contractPreviewOrder && openContractConfirmModal("accept", contractPreviewOrder._id || contractPreviewOrder.id)}
          onDecline={() => contractPreviewOrder && openContractConfirmModal("decline", contractPreviewOrder._id || contractPreviewOrder.id)}
          isLoading={contractActionLoading}
          actionError={contractActionError}
        />

        {/* CONTRACT CONFIRMATION MODAL */}
        {contractConfirmModal.open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40" onClick={closeContractConfirmModal} />
            <div className="relative bg-white rounded-3xl shadow-lg p-6 w-full max-w-md">
              <h2 className="text-2xl font-bold mb-4">
                {contractConfirmModal.action === "accept"
                  ? "Confirm Contract Acceptance"
                  : "Confirm Contract Decline"}
              </h2>
              <p className="text-sm text-slate-600 mb-6">
                {contractConfirmModal.action === "accept"
                  ? "By accepting, you confirm that you reviewed and electronically signed this contract. The completed inspection will move to Transactions for admin approval."
                  : "Please tell ACGC why you are declining this contract. Your order will remain in the Site Inspection workflow."}
              </p>
              {contractConfirmModal.action === "decline" && (
                <textarea
                  value={contractDeclineReason}
                  onChange={(event) => setContractDeclineReason(event.target.value)}
                  placeholder="Reason for declining (required)"
                  rows={3}
                  className="mb-3 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-red-500"
                />
              )}
              {contractActionError && <p className="mb-3 text-sm font-semibold text-red-600">{contractActionError}</p>}
              <div className="flex justify-end gap-3">
                <button
                  onClick={closeContractConfirmModal}
                  className="px-4 py-2 rounded-lg bg-gray-100 text-slate-700 hover:bg-gray-200 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmContractAction}
                    disabled={contractActionLoading || (contractConfirmModal.action === "decline" && !contractDeclineReason.trim())}
                  className={`px-4 py-2 rounded-lg text-white transition disabled:opacity-50 disabled:cursor-not-allowed ${
                    contractConfirmModal.action === "accept"
                      ? "bg-emerald-600 hover:bg-emerald-700"
                      : "bg-red-600 hover:bg-red-700"
                  }`}
                >
                  {contractActionLoading
                    ? contractConfirmModal.action === "accept"
                      ? "Signing..."
                      : "Declining..."
                    : contractConfirmModal.action === "accept" ? "Accept & Sign Contract" : "Confirm Decline"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default CustomerDashboard;
