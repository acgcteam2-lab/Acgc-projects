import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ClipboardCheck,
  FolderOpen,
  ShieldCheck,
  Package,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { getAdminOrders, getAdminOrder, updateOrderStatus } from "@/api/orders";
import { formatDateToMMMDDYYYY } from "@/lib/dateUtils";
import { recordActivity } from "@/lib/activityLog";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminTheme } from "@/contexts/AdminThemeContext";
import ProfileAvatar from "../../components/ui/ProfileAvatar";

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

const getCustomerAddress = (customer) => {
  if (!customer) return "";
  return normalizeAddress(
    [customer.street_address, customer.city, customer.province, customer.zip_code]
      .filter(Boolean)
      .join(", ")
  );
};

const formatCurrency = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return `₱${amount.toLocaleString(undefined, {
    minimumFractionDigits: amount % 1 ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
};

const titleCase = (value) => {
  if (!value) return "—";
  return String(value)
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
};

const getOrderItemProduct = (item) => {
  if (!item?.product_id || typeof item.product_id !== "object") return {};
  return item.product_id;
};

const getOrderItemName = (item) => {
  const product = getOrderItemProduct(item);
  return item?.name || product.name || product.product_name || "Project Item";
};

const getOrderItemType = (item) => {
  const product = getOrderItemProduct(item);
  return titleCase(item?.product_type || item?.category || product.product_type || product.category);
};

const getOrderItemDimensions = (item) => {
  const dims = item?.dimensions || {};
  const width = Number(item?.width ?? dims.width) || 0;
  const height = Number(item?.height ?? dims.height) || 0;
  if (!width && !height) return "—";
  const unit = item?.measurement_unit || item?.measurementUnit || dims.unit || "in";
  const customized = Boolean(item?.customized ?? dims.customized);
  const separator = " × ";
  const value = `${width || "—"}${separator}${height || "—"} ${unit}`;
  return customized ? `${value} (Customized)` : value;
};

const getOrderItemUnitRate = (item) => {
  const product = getOrderItemProduct(item);
  const unitPrice = Number(item?.unit_price ?? product.unit_price);
  const unit = item?.unit || product.unit || item?.measurement_unit || item?.measurementUnit || item?.dimensions?.unit || "piece";
  return `${formatCurrency(unitPrice)} / ${unit.replace(/^per_/, "")}`;
};

const getOrderItemTotal = (item) => {
  const estimated = Number(item?.estimated_price) || 0;
  if (item?.is_estimate && estimated > 0) return estimated;
  return (Number(item?.quantity) || 1) * (Number(item?.unit_price) || 0);
};

import Sidebar from "../../components/layout/Sidebar";
import Navbar from "../../components/layout/Navbar";
import AdminPageHeader from "../../components/layout/AdminPageHeader";
import ProgressViewModal from "../../components/ProgressViewModal";
import useNotificationHighlight from "@/hooks/useNotificationHighlight";

const toProgressProject = (order) => ({
  id: order?._id || order?.id,
  client:
    order?.customer_name ||
    `${order?.customer?.first_name || ""} ${order?.customer?.last_name || ""}`.trim() ||
    order?.customer?.email ||
    "Unknown",
  product:
    order?.items?.[0]?.name ||
    order?.items?.[0]?.category ||
    order?.items?.[0]?.product_id?.name ||
    "Project",
  rawOrder: order,
});

const getOrderWarrantyRecords = (order) => {
  const items = Array.isArray(order?.items) ? order.items : [];
  const itemRecords = items
    .filter((item) => item.warranty_start_date || item.warranty_expiry_date || item.warranty_status)
    .map((item, index) => ({
      key: `${order._id || order.id}-warranty-${index}`,
      order,
      item,
      status: String(item.warranty_status || "").toLowerCase(),
      start: item.warranty_start_date ? new Date(item.warranty_start_date) : null,
      expiry: item.warranty_expiry_date ? new Date(item.warranty_expiry_date) : null,
    }));
  if (itemRecords.length) return itemRecords;
  if (!order?.warranty_status && !order?.warranty_expiry_date) return [];
  return [{
    key: `${order._id || order.id}-warranty`,
    order,
    item: items[0] || {},
    status: String(order.warranty_status || "").toLowerCase(),
    start: order.warranty_start_date ? new Date(order.warranty_start_date) : null,
    expiry: order.warranty_expiry_date ? new Date(order.warranty_expiry_date) : null,
  }];
};

function Dashboard() {
  const { user } = useAuth();
  const { darkMode } = useAdminTheme();
  const location = useLocation();
  const highlightedNotificationRecordId = useNotificationHighlight(location);
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem("sidebarOpen");
    return stored !== null ? JSON.parse(stored) : true;
  });
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);
  const [selectedOrderLoading, setSelectedOrderLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [toast, setToast] = useState({
    open: false,
    message: "",
    type: "success",
  });
  const [confirmModal, setConfirmModal] = useState({
    open: false,
    action: "",
    order: null,
  });

  const [rightPanelOpen, setRightPanelOpen] = useState(true);

  const [recentTransactionsPage, setRecentTransactionsPage] = useState(1);
  const [contractNotifications, setContractNotifications] = useState([]);
  const [contractNotificationsLoading, setContractNotificationsLoading] = useState(false);
  const [contractPage, setContractPage] = useState(1);
  const contractsPerPage = 5;
  const [chartProgress, setChartProgress] = useState(0);
  const [currentDateTime, setCurrentDateTime] = useState(() => new Date());

  useEffect(() => {
    const clock = window.setInterval(() => {
      setCurrentDateTime(new Date());
    }, 1000);

    return () => window.clearInterval(clock);
  }, []);

  const showToast = (message, type = "success") => {
    setToast({ open: true, message, type });
    setTimeout(() => {
      setToast((current) =>
        current.message === message ? { ...current, open: false } : current
      );
    }, 3000);
  };

  const navigate = useNavigate();

  const openConfirmModal = (order, action) => {
    setConfirmModal({
      open: true,
      action,
      order,
    });
  };

  

  const handleViewOrder = async (orderId) => {
    if (!orderId) return;
    try {
      setSelectedOrderLoading(true);
      const resp = await getAdminOrder(orderId, "dashboard");
      setSelectedOrder(resp.order || resp);
    } catch (error) {
      console.error("Failed to fetch admin order:", error);
      showToast(error.data?.message || error.message || "Unable to load order details", "error");
    } finally {
      setSelectedOrderLoading(false);
    }
  };

  const handleViewProject = (order) => {
    setSelectedProject(toProgressProject(order));
  };

  const handleTimelineOrderChange = (savedOrder) => {
    if (!savedOrder) return;

    setOrders((currentOrders) =>
      currentOrders.map((order) =>
        (order._id || order.id) === (savedOrder._id || savedOrder.id)
          ? savedOrder
          : order
      )
    );
    setSelectedProject(toProgressProject(savedOrder));
  };

  const closeConfirmModal = () => {
    setConfirmModal({ open: false, action: "", order: null });
  };

  const handleConfirmAction = async () => {
    if (!confirmModal.order) return;

    const order = confirmModal.order;
    const action = confirmModal.action;

    closeConfirmModal();

    if (action === "approve") {
      await handleApproveOrder(order);
    } else if (action === "reject") {
      await handleRejectOrder(order);
    }
  };

  useEffect(() => {
    localStorage.setItem("sidebarOpen", JSON.stringify(isSidebarOpen));
  }, [isSidebarOpen]);

  useEffect(() => {
    let animationFrame;
    const animationStart = performance.now();
    const animationDuration = 1400;

    const animateChart = (timestamp) => {
      const elapsed = Math.min((timestamp - animationStart) / animationDuration, 1);
      const easedProgress = 1 - Math.pow(1 - elapsed, 4);
      setChartProgress(easedProgress);

      if (elapsed < 1) {
        animationFrame = requestAnimationFrame(animateChart);
      }
    };

    setChartProgress(0);
    animationFrame = requestAnimationFrame(animateChart);

    return () => cancelAnimationFrame(animationFrame);
  }, [orders.length]);

  useEffect(() => {
    const fetchOrders = async () => {
      setOrdersLoading(true);
      try {
        const response = await getAdminOrders({ module: "dashboard" });
        setOrders(response.orders || []);
      } catch (error) {
        console.error("Failed to load orders:", error);
        setOrders([]);
      } finally {
        setOrdersLoading(false);
      }
    };

    fetchOrders();
    fetchContractNotifications();
  }, []);

  async function fetchContractNotifications() {
    setContractNotificationsLoading(true);
    try {
      const [acceptedResp, declinedResp] = await Promise.all([
        getAdminOrders({ contract_status: "accepted", module: "dashboard" }),
        getAdminOrders({ contract_status: "declined", module: "dashboard" }),
      ]);

      const notifications = [
        ...(acceptedResp.orders || []).map((order) => ({
          ...order,
          notificationType: "accepted",
          read: false,
        })),
        ...(declinedResp.orders || []).map((order) => ({
          ...order,
          notificationType: "declined",
          read: false,
        })),
      ].sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));

      setContractNotifications(notifications);
    } catch (error) {
      console.error("Failed to load contract notifications:", error);
      setContractNotifications([]);
    } finally {
      setContractNotificationsLoading(false);
    }
  };

  const handleApproveOrder = async (order) => {
    setActionLoading(true);
    setActionMessage("");

    try {
      await updateOrderStatus(order._id, { status: "site_inspection" });
      const orderName = order.customer
        ? `${order.customer.first_name || ""} ${order.customer.last_name || ""}`.trim() || order.customer.email || "Customer"
        : "Customer";
      recordActivity(user, `Approved order for ${orderName} and moved it to site inspection.`, "Dashboard");

      setOrders((prev) =>
        prev.map((item) =>
          item._id === order._id ? { ...item, status: "site_inspection" } : item
        )
      );

      const successMessage = "Order approved and moved to Site Inspection.";
      setActionMessage(successMessage);
      showToast(successMessage, "success");
      setTimeout(() => {
        setSelectedOrder(null);
        setActionMessage("");
      }, 2000);
    } catch (error) {
      console.error("Failed to approve order:", error);
      const errorMessage = "Failed to approve order. Please try again.";
      setActionMessage(errorMessage);
      showToast(errorMessage, "error");
    } finally {
      setActionLoading(false);
    }
  };

  const handleRejectOrder = async (order) => {
    setActionLoading(true);
    setActionMessage("");

    try {
      await updateOrderStatus(order._id, { status: "cancelled" });
      const orderName = order.customer
        ? `${order.customer.first_name || ""} ${order.customer.last_name || ""}`.trim() || order.customer.email || "Customer"
        : "Customer";
      recordActivity(user, `Rejected order for ${orderName}.`, "Dashboard");

      setOrders((prev) =>
        prev.map((item) =>
          item._id === order._id ? { ...item, status: "cancelled" } : item
        )
      );

      const successMessage = "Order rejected and cancelled.";
      setActionMessage(successMessage);
      showToast(successMessage, "success");
      setTimeout(() => {
        setSelectedOrder(null);
        setActionMessage("");
      }, 2000);
    } catch (error) {
      console.error("Failed to reject order:", error);
      const errorMessage = "Failed to reject order. Please try again.";
      setActionMessage(errorMessage);
      showToast(errorMessage, "error");
    } finally {
      setActionLoading(false);
    }
  };

  const activeProjectStatuses = new Set([
    "approved",
    "site_inspection",
    "contract_sent",
    "contract_accepted",
    "in_transaction",
    "processing",
    "cutting",
    "fabrication",
    "installation_scheduling",
    "installation",
  ]);
  const isActiveProject = (order) => {
    const status = String(order.status || "").toLowerCase();
    const progress = Number(order.progress);
    const stages = order.progress_stages || order.stages || [];
    const finalStage = Array.isArray(stages) ? stages[stages.length - 1] : null;
    const isCompleted =
      status === "completed" ||
      status === "cancelled" ||
      progress >= 100 ||
      finalStage?.completed === true;

    return activeProjectStatuses.has(status) && !isCompleted;
  };
  const activeProjectsCount = orders.filter(isActiveProject).length;
  const isWarrantyCurrentlyActive = ({ status, start, expiry }) => (
    status === "active" && (!start || start <= new Date()) && (!expiry || expiry > new Date())
  );
  const activeWarranties = orders
    .flatMap(getOrderWarrantyRecords)
    .filter(isWarrantyCurrentlyActive)
    .slice(0, 5);
  const activeWarrantiesCount = orders
    .flatMap(getOrderWarrantyRecords)
    .filter(isWarrantyCurrentlyActive).length;
  const pendingInspectionCount = orders.filter(
    (order) => String(order.status || "").toLowerCase() === "site_inspection",
  ).length;
  const activeProjects = orders
    .filter(isActiveProject)
    .slice(0, 5);
  const orderStatusGroups = [
    {
      label: "In progress",
      value: orders.filter(isActiveProject).length,
      color: "#2563eb",
      softColor: "bg-blue-500",
    },
    {
      label: "Pending inspection",
      value: pendingInspectionCount,
      color: "#f59e0b",
      softColor: "bg-amber-500",
    },
    {
      label: "Completed",
      value: orders.filter((order) => String(order.status || "").toLowerCase() === "completed").length,
      color: "#10b981",
      softColor: "bg-emerald-500",
    },
    {
      label: "Cancelled",
      value: orders.filter((order) => String(order.status || "").toLowerCase() === "cancelled").length,
      color: "#ef4444",
      softColor: "bg-red-500",
    },
    {
      label: "Other",
      value: Math.max(
        0,
        orders.length - activeProjectsCount - pendingInspectionCount -
          orders.filter((order) => String(order.status || "").toLowerCase() === "completed").length -
          orders.filter((order) => String(order.status || "").toLowerCase() === "cancelled").length,
      ),
      color: "#64748b",
      softColor: "bg-slate-500",
    },
  ];
  const orderStatusTotal = orderStatusGroups.reduce((total, group) => total + group.value, 0);
  const chartRadius = 78;
  const chartCircumference = 2 * Math.PI * chartRadius;
  let chartOffset = 0;
  const dashboardDate = formatDateToMMMDDYYYY(currentDateTime);
  const dashboardTime = currentDateTime.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
  const dashboardDay = currentDateTime.toLocaleDateString(undefined, {
    weekday: "long",
  });
  const recentTransactionsPerPage = 5;
  const recentTransactions = [...orders].sort((a, b) => {
    const dateA = new Date(a.created_at || a.createdAt || a.updatedAt || 0).getTime();
    const dateB = new Date(b.created_at || b.createdAt || b.updatedAt || 0).getTime();
    return dateB - dateA;
  });
  const totalRecentTransactionPages = Math.max(1, Math.ceil(recentTransactions.length / recentTransactionsPerPage));
  const currentRecentTransactionsPage = Math.min(recentTransactionsPage, totalRecentTransactionPages);
  const recentTransactionStart = recentTransactions.length === 0
    ? 0
    : (currentRecentTransactionsPage - 1) * recentTransactionsPerPage + 1;
  const recentTransactionEnd = Math.min(currentRecentTransactionsPage * recentTransactionsPerPage, recentTransactions.length);

  useEffect(() => {
    if (!highlightedNotificationRecordId) return;
    const targetIndex = recentTransactions.findIndex((order) => String(order._id || order.id) === highlightedNotificationRecordId);
    if (targetIndex >= 0) setRecentTransactionsPage(Math.floor(targetIndex / recentTransactionsPerPage) + 1);
  }, [highlightedNotificationRecordId, orders]);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100">
      <Sidebar isOpen={isSidebarOpen} onToggle={() => setIsSidebarOpen((open) => !open)} />

      <div className="flex-1 min-h-0 flex flex-col">
        <Navbar />

        <main className="flex-1 min-h-0 overflow-y-auto p-6">
          {toast.open && (
            <div className="fixed right-6 top-6 z-50 w-full max-w-sm rounded-2xl border px-4 py-3 shadow-xl transition duration-200 ease-out bg-white"
              role="status"
            >
              <div className="flex items-center gap-3">
                <div className={`h-2.5 w-2.5 rounded-full ${toast.type === "error" ? "bg-red-600" : "bg-emerald-600"}`} />
                <span className={`font-semibold ${toast.type === "error" ? "text-red-700" : "text-emerald-700"}`}>
                  {toast.type === "error" ? "Error" : "Success"}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-700">{toast.message}</p>
            </div>
          )}

          <div className="mt-6 grid grid-cols-1 items-stretch gap-6 xl:grid-cols-2">
            <AdminPageHeader
              title="Dashboard"
              description="Manage inspections, projects, warranties and products from one administrative workspace."
              className="h-full min-h-[250px]"
              statsClassName="grid-cols-2 gap-3 [&>*:last-child]:col-span-2"
              stats={[
                { label: "Date", value: dashboardDate, color: "text-blue-100" },
                { label: "Time", value: dashboardTime, color: "text-emerald-300" },
                { label: "Day", value: dashboardDay, color: "text-amber-300" },
              ]}
            />

            <div className={`h-full rounded-3xl p-6 shadow-lg ${darkMode ? "bg-slate-800 text-slate-100" : "bg-white text-gray-900"}`}>
              <h2 className="text-lg font-bold">Quick Actions</h2>
              <p className={`mb-4 mt-1 text-sm ${darkMode ? "text-slate-300" : "text-gray-500"}`}>Shortcuts</p>

              <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
                <button
                  type="button"
                  onClick={() => navigate("/site-inspection")}
                  className={`rounded-2xl border p-3 text-left transition ${darkMode ? "border-red-400/80 bg-red-950/50 hover:bg-red-900/70" : "border-red-500 bg-red-50/50 hover:bg-red-100"}`}
                >
                  <ClipboardCheck className="mb-2 text-red-600" size={20} />
                  <h3 className="text-xs font-bold leading-tight">New Inspection</h3>
                  <p className={`mt-1 text-[11px] ${darkMode ? "text-slate-300" : "text-gray-500"}`}>Site inspection</p>
                </button>

                <button
                  type="button"
                  onClick={() => navigate("/progress-monitor")}
                  className={`rounded-2xl border p-3 text-left transition ${darkMode ? "border-blue-400/80 bg-blue-950/50 hover:bg-blue-900/70" : "border-blue-500 bg-blue-50/50 hover:bg-blue-100"}`}
                >
                  <FolderOpen className="mb-2 text-blue-600" size={20} />
                  <h3 className="text-xs font-bold leading-tight">View Projects</h3>
                  <p className={`mt-1 text-[11px] ${darkMode ? "text-slate-300" : "text-gray-500"}`}>Progress monitor</p>
                </button>

                <button
                  type="button"
                  onClick={() => navigate("/transactions", { state: { activeTable: "projects" } })}
                  className={`rounded-2xl border p-3 text-left transition ${darkMode ? "border-green-400/80 bg-green-950/50 hover:bg-green-900/70" : "border-green-500 bg-green-50/50 hover:bg-green-100"}`}
                >
                  <ShieldCheck className="mb-2 text-green-600" size={20} />
                  <h3 className="text-xs font-bold leading-tight">View Warranty</h3>
                  <p className={`mt-1 text-[11px] ${darkMode ? "text-slate-300" : "text-gray-500"}`}>Warranties</p>
                </button>

                <button
                  type="button"
                  onClick={() => navigate("/product")}
                  className={`rounded-2xl border p-3 text-left transition ${darkMode ? "border-fuchsia-400/80 bg-fuchsia-950/50 hover:bg-fuchsia-900/70" : "border-purple-500 bg-purple-50 hover:bg-purple-100"}`}
                >
                  <Package className="mb-2 text-purple-600" size={20} />
                  <h3 className="text-xs font-bold leading-tight">Add Product</h3>
                  <p className={`mt-1 text-[11px] ${darkMode ? "text-slate-300" : "text-gray-500"}`}>Inventory</p>
                </button>
              </div>
            </div>
          </div>

          {/* Statistics */}

          <div className="grid grid-cols-1 gap-5 mt-6 md:grid-cols-3">

            <button
              type="button"
              onClick={() => navigate("/progress-monitor")}
              className="group rounded-3xl bg-white p-6 text-left shadow transition duration-200 hover:-translate-y-1 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <p className="text-gray-500">
                Active Projects
              </p>

              <h2 className="mt-2 text-4xl font-bold text-gray-900">
                {activeProjectsCount}
              </h2>

              <p className="mt-2 text-sm text-blue-500 transition group-hover:text-blue-700">
                View projects →
              </p>
            </button>

            <button
              type="button"
              onClick={() => navigate("/transactions", { state: { activeTable: "projects" } })}
              className="group rounded-3xl bg-white p-6 text-left shadow transition duration-200 hover:-translate-y-1 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <p className="text-gray-500">
                Active Warranties
              </p>

              <h2 className="mt-2 text-4xl font-bold text-gray-900">
                {activeWarrantiesCount}
              </h2>

              <p className="mt-2 text-sm text-green-500 transition group-hover:text-green-700">
                View warranties →
              </p>
            </button>

            <button
              type="button"
              onClick={() => navigate("/site-inspection")}
              className="group rounded-3xl bg-white p-6 text-left shadow transition duration-200 hover:-translate-y-1 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              <p className="text-gray-500">
                Pending Inspection
              </p>

              <h2 className="mt-2 text-4xl font-bold text-gray-900">
                {pendingInspectionCount}
              </h2>

              <p className="mt-2 text-sm text-red-500 transition group-hover:text-red-700">
                View inspections →
              </p>
            </button>

          </div>

          <section className="mt-6 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Recent Transactions</h2>
                <p className="mt-1 text-sm text-gray-500">Recent activity in the Customer Website</p>
              </div>
              <button
                type="button"
                onClick={() => navigate("/transactions")}
                className="text-sm font-semibold text-gray-700 underline decoration-gray-400 underline-offset-4 hover:text-gray-900"
              >
                View all
              </button>
            </div>

            <div className="mt-5 overflow-hidden rounded-2xl border border-gray-200">
              <div className="hidden md:block">
                <table className="min-w-full border-collapse">
                  <thead className="bg-gray-50 text-left text-xs font-bold uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-5 py-4">Client</th>
                      <th className="px-5 py-4">Project</th>
                      <th className="px-5 py-4">Date</th>
                      <th className="px-5 py-4">Amount</th>
                      <th className="px-5 py-4 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white text-sm text-gray-700">
                    {recentTransactions.length > 0 ? recentTransactions
                      .slice(
                        (currentRecentTransactionsPage - 1) * recentTransactionsPerPage,
                        currentRecentTransactionsPage * recentTransactionsPerPage,
                      )
                      .map((order) => {
                        const customerName = order.customer
                          ? `${order.customer.first_name || ""} ${order.customer.last_name || ""}`.trim() || order.customer.email || "Customer"
                          : order.customer_name || "Customer";
                        const orderItems = Array.isArray(order.items) ? order.items.filter(Boolean) : [];
                        const productName = orderItems.length > 1
                          ? "Batch Order"
                          : orderItems[0]?.name || orderItems[0]?.product_id?.name || order.product_name || order.project_name || "Project";
                        const date = order.created_at || order.createdAt || order.date || "";
                        const formattedDate = date ? new Date(date).toISOString().split("T")[0] : "—";
                        const statusValue = String(order.status || "pending");
                        const statusText = titleCase(statusValue);
                        const badgeClasses =
                          statusValue.toLowerCase() === "cancelled"
                            ? "bg-red-100 text-red-700"
                            : statusValue.toLowerCase() === "completed"
                              ? "bg-emerald-100 text-emerald-700"
                              : statusValue.toLowerCase() === "site_inspection" || statusValue.toLowerCase() === "pending"
                                ? "bg-amber-100 text-amber-700"
                                : "bg-rose-100 text-rose-700";

                        const orderId = String(order._id || order.id || "");
                        const isNotificationTarget = highlightedNotificationRecordId === orderId;
                        return (
                          <tr
                            key={orderId}
                            data-notification-record-id={orderId}
                            role="button"
                            tabIndex={0}
                            onClick={() => handleViewOrder(orderId)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                handleViewOrder(orderId);
                              }
                            }}
                            className={`cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500 ${isNotificationTarget ? "bg-amber-100 ring-2 ring-inset ring-amber-500" : "hover:bg-gray-50"}`}
                          >
                            <td className="px-5 py-4"><ProfileAvatar name={customerName} email={order.customer?.email || order.customer_email || ""} compact /></td>
                            <td className="px-5 py-4 font-bold text-gray-900">{productName}</td>
                            <td className="px-5 py-4 text-gray-700">{formattedDate}</td>
                            <td className="px-5 py-4 font-semibold text-gray-900">{formatCurrency(order.total_amount || order.totalAmount || 0)}</td>
                            <td className="px-5 py-4 text-right">
                              <span className={`inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-semibold ${badgeClasses}`}>
                                {statusText}
                              </span>
                            </td>
                          </tr>
                        );
                      }) : (
                      <tr>
                        <td colSpan="5" className="px-5 py-8 text-center text-sm text-gray-400">
                          No recent transactions.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="space-y-3 p-3 md:hidden">
                {recentTransactions.length > 0 ? recentTransactions
                  .slice(
                    (currentRecentTransactionsPage - 1) * recentTransactionsPerPage,
                    currentRecentTransactionsPage * recentTransactionsPerPage,
                  )
                  .map((order) => {
                    const customerName = order.customer
                      ? `${order.customer.first_name || ""} ${order.customer.last_name || ""}`.trim() || order.customer.email || "Customer"
                      : order.customer_name || "Customer";
                    const orderItems = Array.isArray(order.items) ? order.items.filter(Boolean) : [];
                    const productName = orderItems.length > 1
                      ? "Batch Order"
                      : orderItems[0]?.name || orderItems[0]?.product_id?.name || order.product_name || order.project_name || "Project";
                    const date = order.created_at || order.createdAt || order.date || "";
                    const formattedDate = date ? new Date(date).toISOString().split("T")[0] : "—";
                    const statusValue = String(order.status || "pending");
                    const statusText = titleCase(statusValue);
                    const badgeClasses =
                      statusValue.toLowerCase() === "cancelled"
                        ? "bg-red-100 text-red-700"
                        : statusValue.toLowerCase() === "completed"
                          ? "bg-emerald-100 text-emerald-700"
                          : statusValue.toLowerCase() === "site_inspection" || statusValue.toLowerCase() === "pending"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-rose-100 text-rose-700";

                    const orderId = String(order._id || order.id || "");
                    const isNotificationTarget = highlightedNotificationRecordId === orderId;
                    return (
                      <div
                        key={orderId}
                        data-notification-record-id={orderId}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleViewOrder(orderId)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            handleViewOrder(orderId);
                          }
                        }}
                        className={`cursor-pointer rounded-2xl border p-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${isNotificationTarget ? "border-amber-500 bg-amber-100 ring-2 ring-amber-400" : "border-gray-200 bg-gray-50"}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-gray-900">{productName}</p>
                            <p className="mt-1 text-xs text-gray-500">{customerName}</p>
                          </div>
                          <span className={`inline-flex items-center rounded-lg px-2.5 py-1 text-[10px] font-semibold ${badgeClasses}`}>
                            {statusText}
                          </span>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-600">
                          <div>
                            <p className="text-[10px] uppercase tracking-wide text-gray-400">Date</p>
                            <p className="mt-1 font-medium text-gray-700">{formattedDate}</p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase tracking-wide text-gray-400">Amount</p>
                            <p className="mt-1 font-semibold text-gray-900">{formatCurrency(order.total_amount || order.totalAmount || 0)}</p>
                          </div>
                        </div>
                      </div>
                    );
                  }) : (
                    <div className="rounded-2xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">
                      No recent transactions.
                    </div>
                )}
              </div>

              <div className="flex flex-col items-center justify-center gap-3 border-t border-gray-200 bg-gray-50 p-4 sm:flex-row">
                <div className="flex flex-wrap items-center justify-center gap-2" role="navigation" aria-label="Recent transactions pagination">
                  <button
                    type="button"
                    onClick={() => setRecentTransactionsPage(Math.max(currentRecentTransactionsPage - 1, 1))}
                    disabled={currentRecentTransactionsPage === 1}
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Previous
                  </button>
                  {Array.from({ length: Math.min(5, totalRecentTransactionPages) }, (_, index) => {
                    const firstPage = Math.max(1, Math.min(currentRecentTransactionsPage - 2, totalRecentTransactionPages - 4));
                    const pageNumber = firstPage + index;
                    return (
                      <button
                        key={pageNumber}
                        type="button"
                        onClick={() => setRecentTransactionsPage(pageNumber)}
                        aria-current={pageNumber === currentRecentTransactionsPage ? "page" : undefined}
                        className={`h-10 w-10 rounded-lg ${pageNumber === currentRecentTransactionsPage ? "bg-red-600 text-white" : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-100"}`}
                      >
                        {pageNumber}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setRecentTransactionsPage(Math.min(currentRecentTransactionsPage + 1, totalRecentTransactionPages))}
                    disabled={currentRecentTransactionsPage === totalRecentTransactionPages}
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </section>

          <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
            <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Active Projects</h2>
                  <p className="mt-1 text-sm text-gray-400">
                    {activeProjectsCount} projects currently in progress
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate("/progress-monitor")}
                  className="text-sm font-semibold text-red-600 hover:text-red-700"
                >
                  View all
                </button>
              </div>

              <div className="mt-5 space-y-3">
                {activeProjects.length > 0 ? activeProjects.map((order) => {
                  const customerName = order.customer
                    ? `${order.customer.first_name || ""} ${order.customer.last_name || ""}`.trim() || order.customer.email || "Customer"
                    : "Customer";
                  const orderItems = Array.isArray(order.items) ? order.items.filter(Boolean) : [];
                  const productName = orderItems.length > 1
                    ? "Batch Order"
                    : orderItems[0]?.name || orderItems[0]?.product_id?.name || "Project";
                  const status = titleCase(order.status);
                  return (
                    <button
                      type="button"
                      key={order._id || order.id}
                      onClick={() => handleViewProject(order)}
                      className="flex w-full items-center justify-between gap-4 rounded-2xl border border-gray-100 p-4 text-left transition hover:border-blue-200 hover:bg-blue-50/40"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-gray-800">{productName}</p>
                        <p className="mt-1 truncate text-sm text-gray-400">{customerName}</p>
                      </div>
                      <span className="shrink-0 rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white">
                        {status}
                      </span>
                    </button>
                  );
                }) : (
                  <p className="rounded-2xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">
                    No active projects.
                  </p>
                )}
              </div>
            </section>

            <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Active Warranties</h2>
                  <p className="mt-1 text-sm text-gray-400">
                    {activeWarrantiesCount} warranties currently active
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate("/transactions", { state: { activeTable: "projects" } })}
                  className="text-sm font-semibold text-red-600 hover:text-red-700"
                >
                  View all
                </button>
              </div>

              <div className="mt-5 space-y-3">
                {activeWarranties.length > 0 ? activeWarranties.map(({ key, order, item }) => {
                  const customerName = order.customer
                    ? `${order.customer.first_name || ""} ${order.customer.last_name || ""}`.trim() || order.customer.email || "Customer"
                    : "Customer";
                  const productName = item.name || item.product_id?.name || "Warranty";
                  const warrantyPeriod = item.warranty_period || order.warranty_period || "Warranty";
                  return (
                    <button
                      type="button"
                      key={key}
                      onClick={() => navigate("/transactions", { state: { activeTable: "projects" } })}
                      className="flex w-full items-center justify-between gap-4 rounded-2xl border border-gray-100 p-4 text-left transition hover:border-green-200 hover:bg-green-50/40"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-gray-800">{productName}</p>
                        <p className="mt-1 truncate text-sm text-gray-400">{customerName}</p>
                      </div>
                      <span className="shrink-0 rounded-lg bg-green-500 px-3 py-1.5 text-xs font-semibold text-white">
                        {warrantyPeriod === "Per product" ? "Active" : warrantyPeriod}
                      </span>
                    </button>
                  );
                }) : (
                  <p className="rounded-2xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">
                    No active warranties.
                  </p>
                )}
              </div>
            </section>
          </div>

        </main>
      </div>

      {/* Order Detail Modal */}
      {selectedOrder && (
        <div className="mobile-fullscreen-overlay fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSelectedOrder(null)} />
          <div className="mobile-fullscreen-dialog relative bg-white rounded-3xl shadow-lg p-8 w-full max-w-2xl max-h-120 overflow-y-auto">
            <button
              onClick={() => setSelectedOrder(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 text-2xl"
            >
              ×
            </button>

            <h2 className="text-2xl font-bold text-slate-950 mb-6">
              Project Details
            </h2>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <p className="text-xs uppercase tracking-widest text-slate-400">Customer Name</p>
                <p className="text-lg font-semibold text-slate-950 mt-1">
                  {selectedOrder.customer
                    ? `${selectedOrder.customer.first_name || ""} ${selectedOrder.customer.last_name || ""}`.trim() || selectedOrder.customer.email || "—"
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-widest text-slate-400">Phone</p>
                <p className="text-lg font-semibold text-slate-950 mt-1">{selectedOrder.customer?.phone || "—"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-widest text-slate-400">Tracking ID</p>
                <p className="text-lg font-semibold text-slate-950 mt-1">{selectedOrder.tracking || "—"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-widest text-slate-400">Order Type</p>
                <p className="text-lg font-semibold text-slate-950 mt-1">
                  {selectedOrder.order_type === "walk_in_customer" ? "Walk-in" : "Online"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-widest text-slate-400">Product</p>
                <p className="text-lg font-semibold text-slate-950 mt-1">
                  {selectedOrder.items?.[0]?.name || selectedOrder.items?.[0]?.product_id?.name || "—"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-widest text-slate-400">Total Amount</p>
                <p className="text-lg font-semibold text-green-600 mt-1">₱{selectedOrder.total_amount?.toLocaleString() || "—"}</p>
              </div>
              <div className="col-span-2">
                <p className="text-xs uppercase tracking-widest text-slate-400">Full Address</p>
                <p className="text-lg font-semibold text-slate-950 mt-1 whitespace-normal break-words">
                  {selectedOrder.customer
                    ? getCustomerAddress(selectedOrder.customer) || "—"
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-widest text-slate-400">Status</p>
                <p className="text-lg font-semibold text-slate-950 mt-1">
                  {selectedOrder.status?.replace(/_/g, " ").toUpperCase() || "—"}
                </p>
              </div>
            </div>

            

            <div className="mb-6">
              <p className="text-xs uppercase tracking-widest text-slate-400 mb-3">Ordered Items</p>
              {Array.isArray(selectedOrder.items) && selectedOrder.items.length > 0 ? (
                <div className="space-y-3">
                  {selectedOrder.items.map((item, index) => (
                    <div
                      key={`${item.product_id?._id || item.product_id || item.name || "item"}-${index}`}
                      className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                    >
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-base font-bold text-slate-950">
                            {index + 1}. {getOrderItemName(item)}
                          </p>
                          {item.notes && (
                            <p className="mt-1 text-sm text-slate-500">{item.notes}</p>
                          )}
                        </div>
                        <p className="text-lg font-bold text-green-600">{formatCurrency(getOrderItemTotal(item))}</p>
                      </div>

                      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <div>
                          <p className="text-xs uppercase tracking-widest text-slate-400">Type</p>
                          <p className="mt-1 font-semibold text-slate-900">{getOrderItemType(item)}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-widest text-slate-400">Dimensions</p>
                          <p className="mt-1 font-semibold text-slate-900">{getOrderItemDimensions(item)}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-widest text-slate-400">Quantity</p>
                          <p className="mt-1 font-semibold text-slate-900">{item.quantity || 1}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-widest text-slate-400">Unit Rate</p>
                          <p className="mt-1 font-semibold text-slate-900">{getOrderItemUnitRate(item)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-slate-500">
                  No item details available.
                </div>
              )}
            </div>

            {actionMessage && (
              <div className={`mb-4 p-3 rounded-lg ${
                actionMessage.includes("success") || actionMessage.includes("approved") || actionMessage.includes("rejected")
                  ? "bg-green-100 text-green-800"
                  : "bg-red-100 text-red-800"
              }`}>
                {actionMessage}
              </div>
            )}

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setSelectedOrder(null)}
                className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedProject && (
        <ProgressViewModal
          project={selectedProject}
          onClose={() => setSelectedProject(null)}
          onOrderChange={handleTimelineOrderChange}
        />
      )}

      {confirmModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={closeConfirmModal} />
          <div className="relative bg-white rounded-3xl shadow-lg p-6 w-full max-w-md">
            <h2 className="text-2xl font-bold mb-4">
              {confirmModal.action === "approve"
                ? "Confirm Approval"
                : "Confirm Rejection"}
            </h2>
            <p className="text-sm text-slate-600 mb-6">
              {confirmModal.action === "approve"
                ? "Are you sure you want to approve this order request and move it to Site Inspection?"
                : "Are you sure you want to reject this order request?"}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={closeConfirmModal}
                className="px-4 py-2 rounded-lg bg-gray-100 text-slate-700 hover:bg-gray-200 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmAction}
                disabled={actionLoading}
                className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {actionLoading ? "Processing..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
