import { useEffect, useRef, useState } from "react";
import { getAdminOrders } from "@/api/orders";
import { subscribeToRealtime } from "@/lib/realtimeEvents";
import { Bell, CheckCheck, CheckCircle2, ClipboardCheck, CreditCard, Send, ShoppingCart, XCircle } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { formatDateTimeToMMDDYYYY, formatTimeAgo } from "@/lib/dateUtils";
import { getFinalProjectCost } from "@/lib/orderPricing";
import { ADMIN_READ_NOTIFICATIONS_KEY, getAdminNotificationId, getAdminReadNotificationIds, markAdminNotificationRead, sortAdminNotificationsNewestFirst } from "@/lib/notificationState";
import AdminPageHeader from "../../components/layout/AdminPageHeader";
import { useAdminTheme } from "@/contexts/AdminThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { getAdminSiteInspectionNotificationMessage } from "@/pages/CustomerDashboard/orderStatusUtils";

export default function Notifications() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const hasLoadedNotifications = useRef(false);
  const [notificationFilter, setNotificationFilter] = useState("all");
  const { darkMode } = useAdminTheme();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const backPath = location.state?.from || "/dashboard";
  const unreadCount = notifications.filter((notification) => !notification.read).length;
  const filterOptions = [
    ["all", "All"],
    ["orders", "Orders"],
    ["inspections", "Inspections"],
    ["accepted", "Accepted"],
    ["declined", "Declined"],
    ["sent", "Sent"],
    ["payments", "Payments"],
  ];
  const filteredNotifications = notifications.filter((notification) => (
    notificationFilter === "all" || notification.category === notificationFilter
  ));

  useEffect(() => {
    let active = true;
    let requestInFlight = false;
    let refreshQueued = false;
    const fetch = async () => {
      if (!active) return;
      if (requestInFlight) {
        refreshQueued = true;
        return;
      }
      requestInFlight = true;
      if (!hasLoadedNotifications.current) setLoading(true);
      try {
        const staffModules = user?.staff_access?.modules || {};
        const canReadModule = (moduleKey) => user?.role !== "skilled_worker" || (
          staffModules[moduleKey]?.enabled === true && staffModules[moduleKey]?.actions?.view === true
        );
        const fetchModuleOrders = (params, moduleKey) => canReadModule(moduleKey)
          ? getAdminOrders({ ...params, module: moduleKey, view: "notifications", limit: 100 })
          : Promise.resolve({ orders: [] });
        const [newOrdersResp, inspectionsResp, acceptedResp, declinedResp, sentResp, paymentResp] = await Promise.all([
          fetchModuleOrders({ status: "order_submitted" }, "dashboard"),
          fetchModuleOrders({ status: "site_inspection" }, "site_inspection"),
          fetchModuleOrders({ contract_status: "accepted" }, "site_inspection"),
          fetchModuleOrders({ contract_status: "declined" }, "site_inspection"),
          fetchModuleOrders({ contract_status: "sent" }, "site_inspection"),
          fetchModuleOrders({ payment_proof_submitted: "true" }, "transactions"),
        ]);
        const items = [
          ...(newOrdersResp.orders || []).map((order) => ({
            ...order,
            notificationType: "new-order",
            category: "orders",
            title: "New order request",
            message: `${order.tracking || "An order"} is waiting for approval.`,
            id: getAdminNotificationId("new-order", order),
          })),
          ...(inspectionsResp.orders || [])
            .filter((order) => !["sent", "declined"].includes(String(order.contract_status || "").toLowerCase()))
            .map((order) => {
              const customerName = `${order.customer?.first_name || ""} ${order.customer?.last_name || ""}`.trim()
                || order.customer_name
                || "Customer";
              return {
                ...order,
                notificationType: "inspection",
                category: "inspections",
                title: order.inspection_date || order.inspection_status === "scheduled" ? "Inspection scheduled" : "Inspection needs scheduling",
                message: getAdminSiteInspectionNotificationMessage(order, customerName),
                id: getAdminNotificationId("inspection", order),
              };
            }),
          ...(acceptedResp.orders || []).map((order) => ({
            ...order,
            notificationType: "accepted",
            category: "accepted",
            message: `Customer accepted the contract for ₱${getFinalProjectCost(order).toLocaleString()}`,
            id: getAdminNotificationId("accepted", order),
          })),
          ...(declinedResp.orders || []).map((order) => ({
            ...order,
            notificationType: "declined",
            category: "declined",
            message: "Customer declined the contract",
            id: getAdminNotificationId("declined", order),
          })),
          ...(sentResp.orders || []).map((o) => ({
            ...o,
            updatedAt: o.contractSentAt || o.updatedAt,
            notificationType: "sent",
            category: "sent",
            message: "Contract sent to customer for review",
            id: getAdminNotificationId("sent", o),
          })),
          ...(paymentResp.orders || []).map((o) => {
            const customerName = `${o.customer?.first_name || ""} ${o.customer?.last_name || ""}`.trim()
              || o.customer_name
              || "Customer";
            const orderNumber = o.tracking || o.order_number || o.orderNumber || o._id;
            const amount = Number(o.payment_proof_amount || o.payment_amount || 0)
              .toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

            return {
              ...o,
              updatedAt: o.payment_proof_submitted_at,
              notificationType: "payment",
              category: "payments",
              id: getAdminNotificationId("payment", o),
              title: "Customer Reported a Payment",
              message: `${customerName} says they paid ₱${amount} for order ${orderNumber}. Please confirm.`,
            };
          }),
        ].sort(sortAdminNotificationsNewestFirst);
        const readNotificationIds = getAdminReadNotificationIds();
        if (active) {
          setNotifications(items.map((item) => ({ ...item, read: readNotificationIds.has(item.id) })));
        }
      } catch (err) {
        console.error(err);
      } finally {
        requestInFlight = false;
        hasLoadedNotifications.current = true;
        if (active) setLoading(false);
        if (active && refreshQueued) {
          refreshQueued = false;
          refreshTimeout = window.setTimeout(() => {
            refreshTimeout = null;
            fetch();
          }, 0);
        }
      }
    };
    fetch();
    let refreshTimeout = null;
    const scheduleRefresh = () => {
      if (refreshTimeout) window.clearTimeout(refreshTimeout);
      refreshTimeout = window.setTimeout(() => {
        refreshTimeout = null;
        if (document.visibilityState === "visible") fetch();
      }, 80);
    };
    const unsubscribeRealtime = subscribeToRealtime(["orders", "reviews"], scheduleRefresh);
    window.addEventListener("focus", scheduleRefresh);
    const refreshReadState = (event) => {
      if (event.key === ADMIN_READ_NOTIFICATIONS_KEY) scheduleRefresh();
    };
    window.addEventListener("storage", refreshReadState);
    return () => {
      active = false;
      if (refreshTimeout) window.clearTimeout(refreshTimeout);
      window.removeEventListener("focus", scheduleRefresh);
      window.removeEventListener("storage", refreshReadState);
      unsubscribeRealtime();
    };
  }, [user]);

  return (
    <div className="p-3 sm:p-6">
      <button
        type="button"
        onClick={() => navigate(backPath)}
        className={`mb-3 inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${darkMode ? "text-slate-300 hover:bg-slate-800 hover:text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"}`}
      >
        <ArrowLeft size={16} aria-hidden="true" />
        Back
      </button>
      <AdminPageHeader
        title="Notifications"
        description="Review customer responses and administrative actions that need attention."
      />
      <div className={`mt-5 overflow-hidden rounded-2xl border shadow-sm ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
        <div className={`flex flex-wrap items-center justify-between gap-3 border-b px-4 py-4 sm:px-5 ${darkMode ? "border-slate-700" : "border-slate-100"}`}>
          <div>
            <h2 className={`text-base font-bold ${darkMode ? "text-white" : "text-slate-950"}`}>Activity feed</h2>
            <p className={`mt-0.5 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{notifications.length} total updates</p>
          </div>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${unreadCount ? "bg-sky-50 text-sky-700" : darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-500"}`}>
            <CheckCheck size={13} />
            {unreadCount} unread
          </span>
        </div>

        <div className={`flex gap-1 overflow-x-auto border-b p-2 ${darkMode ? "border-slate-700" : "border-slate-100"}`} role="group" aria-label="Filter notifications">
          {filterOptions.map(([filter, label]) => {
            const count = filter === "all"
              ? notifications.length
              : notifications.filter((notification) => notification.category === filter).length;

            return (
              <button
                key={filter}
                type="button"
                onClick={() => setNotificationFilter(filter)}
                aria-pressed={notificationFilter === filter}
                className={`shrink-0 rounded-lg px-2.5 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 sm:px-3 ${
                  notificationFilter === filter
                    ? darkMode ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-950"
                    : darkMode ? "text-slate-400 hover:bg-slate-800 hover:text-slate-200" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                }`}
              >
                {label} ({count})
              </button>
            );
          })}
        </div>

        <div className="p-3 sm:p-4">
          {loading ? (
            <div className="space-y-3" aria-label="Loading notifications">
              {[...Array(3)].map((_, index) => <div key={index} className={`h-20 animate-pulse rounded-xl ${darkMode ? "bg-slate-800" : "bg-slate-100"}`} />)}
            </div>
          ) : filteredNotifications.length === 0 ? (
            <div className={`flex flex-col items-center rounded-xl border border-dashed px-5 py-12 text-center ${darkMode ? "border-slate-700 text-slate-300" : "border-slate-200 text-slate-600"}`}>
              <span className={`flex h-11 w-11 items-center justify-center rounded-full ${darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-500"}`}><Bell size={19} /></span>
              <p className="mt-3 text-sm font-semibold">{notificationFilter === "all" ? "You're all caught up" : `No ${filterOptions.find(([filter]) => filter === notificationFilter)?.[1].toLowerCase()} notifications`}</p>
              <p className={`mt-1 text-xs ${darkMode ? "text-slate-500" : "text-slate-400"}`}>{notificationFilter === "all" ? "New customer activity will appear here." : "Try another filter to see more activity."}</p>
            </div>
          ) : (
            <div className={`divide-y overflow-hidden rounded-xl border ${darkMode ? "divide-slate-700 border-slate-700" : "divide-slate-200 border-slate-200"}`}>
              {filteredNotifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    markAdminNotificationRead(n.id);
                    setNotifications((current) => current.map((item) => item.id === n.id ? { ...item, read: true } : item));
                    const recordId = String(n._id || n.id || n.tracking);
                    const destination = n.category === "payments"
                      ? "/transactions"
                      : n.category === "orders"
                        ? "/dashboard"
                        : `/site-inspection?view=${recordId}`;
                    const recordType = n.category === "payments"
                      ? "payment"
                      : n.category === "inspections"
                        ? "inspection"
                        : ["accepted", "declined", "sent"].includes(n.category)
                          ? "contract"
                          : "order";
                    navigate(destination, {
                      state: { notificationHighlight: { recordId, recordType } },
                    });
                  }}
                  className={`flex w-full gap-3 border-l-[3px] p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500 sm:gap-4 sm:p-4 ${n.read ? darkMode ? "border-l-transparent bg-slate-900 hover:bg-slate-800" : "border-l-transparent bg-white hover:bg-slate-50" : darkMode ? "border-l-sky-400 bg-sky-950/20 hover:bg-sky-950/35" : "border-l-sky-500 bg-sky-50/70 hover:bg-sky-50"}`}
                >
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${darkMode ? "bg-slate-800" : "bg-slate-100"}`}>
                    {n.notificationType === "payment" ? (
                      <CreditCard size={18} className="text-emerald-600" />
                    ) : n.notificationType === "sent" ? (
                      <Send size={18} className="text-sky-600" />
                    ) : n.notificationType === "accepted" ? (
                      <CheckCircle2 size={18} className="text-emerald-600" />
                    ) : n.notificationType === "declined" ? (
                      <XCircle size={18} className="text-red-600" />
                    ) : n.notificationType === "inspection" ? (
                      <ClipboardCheck size={18} className="text-amber-600" />
                    ) : n.notificationType === "new-order" ? (
                      <ShoppingCart size={18} className="text-blue-600" />
                    ) : (
                      <Bell size={18} className={n.notificationType === "accepted" ? "text-emerald-600" : "text-red-600"} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className={`truncate text-sm font-semibold ${darkMode ? n.read ? "text-slate-300" : "text-white" : n.read ? "text-slate-600" : "text-slate-950"}`}>{n.title}</div>
                        {!n.read && <span className="shrink-0 rounded-full bg-sky-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-sky-700">New</span>}
                      </div>
                      <div className={`text-[10px] sm:text-xs ${darkMode ? "text-slate-500" : "text-slate-400"}`} title={formatDateTimeToMMDDYYYY(n.updatedAt || n.createdAt) || undefined}>
                        {formatTimeAgo(n.updatedAt || n.createdAt)}
                      </div>
                    </div>
                    <div className={`mt-1 text-xs leading-5 sm:text-sm ${darkMode ? n.read ? "text-slate-400" : "text-slate-300" : n.read ? "text-slate-500" : "text-slate-700"}`}>{n.message}</div>
                    <div className={`mt-1 text-[11px] font-medium ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                      Tracking ID: {n.tracking || n.order_number || n.orderNumber || "Not assigned"}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
