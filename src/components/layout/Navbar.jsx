import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Moon, Sun, ClipboardCheck, CheckCircle2, XCircle, ShoppingCart, CheckCheck, CreditCard, Send, LogOut } from "lucide-react";
import { getAdminOrders } from "@/api/orders";
import { formatDateTimeToMMDDYYYY, formatTimeAgo } from "@/lib/dateUtils";
import { getAdminNotificationId, getAdminReadNotificationIds, markAdminNotificationRead, markAdminNotificationsRead, sortAdminNotificationsNewestFirst } from "@/lib/notificationState";
import { useAdminTheme } from "@/contexts/AdminThemeContext";
import { useAuth } from "@/contexts/AuthContext";

function Navbar() {
  const { darkMode, toggleDarkMode } = useAdminTheme();
  const { user, logout } = useAuth();
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

  return (
    <>
      <header className={`admin-navbar px-6 py-4 flex items-center justify-between shadow ${darkMode ? "bg-slate-900 text-white" : "bg-white text-slate-900"}`}>

        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-xl font-bold">
              {user?.role === "skilled_worker" ? "Welcome Staff" : "Welcome Administrator"}
            </h1>
          </div>

        </div>

        <div className="flex items-center gap-3 relative">
          <button
            type="button"
            onClick={toggleDarkMode}
            className={`relative inline-flex h-10 w-[128px] shrink-0 items-center rounded-full border p-1 transition-all duration-500 ease-in-out focus:outline-none focus:ring-2 focus:ring-red-500/40 ${
              darkMode
                ? "border-black bg-black text-white hover:bg-slate-950"
                : "border-slate-300 bg-slate-200 text-slate-950 hover:bg-slate-300"
            }`}
            aria-label={darkMode ? "Switch to day mode" : "Switch to night mode"}
            aria-pressed={darkMode}
          >
            <span className={`absolute inset-y-1 flex w-[84px] items-center justify-center gap-1 text-[8px] font-black uppercase tracking-[0.06em] transition-all duration-500 ease-in-out ${
              darkMode ? "left-[40px] text-white" : "left-1 text-slate-950"
            }`}>
              {darkMode ? "Night Mode" : "Day Mode"}
            </span>
            <span className={`relative z-10 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-white text-black shadow-sm transition-all duration-500 ease-in-out ${
              darkMode ? "translate-x-0 border-slate-300" : "translate-x-[86px] border-slate-200"
            }`}>
              {darkMode ? <Moon size={18} strokeWidth={1.8} /> : <Sun size={18} strokeWidth={1.8} />}
            </span>
          </button>

          <div className="flex items-center gap-2">
            <NotificationMenu />
            <button
              type="button"
              onClick={() => setLogoutConfirmOpen(true)}
              className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border transition ${darkMode ? "border-red-500/40 text-red-300 hover:bg-red-500/10" : "border-red-200 text-red-700 hover:bg-red-50"}`}
              aria-label="Log out"
              title="Log out"
            >
              <LogOut size={18} aria-hidden="true" />
            </button>
          </div>
        </div>

      </header>

      {logoutConfirmOpen && (
        <div className="fixed inset-0 z-[100] flex min-h-screen items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/45 backdrop-blur-md"
            onClick={() => setLogoutConfirmOpen(false)}
          />
          <div className={`relative z-40 w-full max-w-sm rounded-2xl p-6 text-center shadow-2xl ${darkMode ? "bg-slate-800 text-white" : "bg-white text-slate-900"}`}>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
              <LogOut size={22} />
            </div>
            <h3 className="mt-4 text-lg font-semibold">Confirm Logout</h3>
            <p className={`mt-2 text-sm ${darkMode ? "text-slate-300" : "text-gray-600"}`}>
              Are you sure you want to log out?
            </p>
            <div className="mt-5 flex justify-center gap-2">
              <button
                onClick={() => setLogoutConfirmOpen(false)}
                className={`rounded-lg px-3 py-1 ${darkMode ? "bg-slate-700 text-slate-100 hover:bg-slate-600" : "bg-gray-100 hover:bg-gray-200"}`}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setLogoutConfirmOpen(false);
                  logout();
                }}
                className="rounded-lg bg-red-600 px-3 py-1 text-white hover:bg-red-700"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default Navbar;

function NotificationMenu() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notificationFilter, setNotificationFilter] = useState("all");
  const { darkMode } = useAdminTheme();
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    let hasFetched = false;
    const staffModules = user?.staff_access?.modules || {};
    const canReadModule = (moduleKey) => user?.role !== "skilled_worker" || (
      staffModules[moduleKey]?.enabled === true && staffModules[moduleKey]?.actions?.view === true
    );
    const fetchModuleOrders = (params, moduleKey) => canReadModule(moduleKey)
      ? getAdminOrders({ ...params, module: moduleKey })
      : Promise.resolve({ orders: [] });

    const fetchNotifications = async () => {
      if (!hasFetched) setLoading(true);
      try {
        const [newOrders, inspections, accepted, declined, sentContracts, paymentSubmissions] = await Promise.all([
          fetchModuleOrders({ status: "order_submitted" }, "dashboard"),
          fetchModuleOrders({ status: "site_inspection" }, "site_inspection"),
          fetchModuleOrders({ contract_status: "accepted" }, "site_inspection"),
          fetchModuleOrders({ contract_status: "declined" }, "site_inspection"),
          fetchModuleOrders({ contract_status: "sent" }, "site_inspection"),
          fetchModuleOrders({ payment_proof_submitted: "true" }, "transactions"),
        ]);

        const readNotificationIds = getAdminReadNotificationIds();
        const items = [
          ...(newOrders.orders || []).map((order) => ({
            id: getAdminNotificationId("new-order", order),
            recordId: String(order._id || order.id || order.tracking),
            title: "New order request",
            message: `${order.tracking || "An order"} is waiting for approval.`,
            icon: ShoppingCart,
            color: "text-blue-600",
            category: "orders",
            path: "/dashboard",
            date: order.createdAt,
          })),
          ...(inspections.orders || [])
            .filter((order) => !["sent", "declined"].includes(String(order.contract_status || "").toLowerCase()) && order.inspection_status !== "completed")
            .map((order) => ({
            id: getAdminNotificationId("inspection", order),
            recordId: String(order._id || order.id || order.tracking),
            title: order.inspection_date && order.inspection_status === "scheduled" ? "Inspection scheduled" : "Inspection needs scheduling",
            message: order.inspection_date && order.inspection_status === "scheduled"
              ? `Site inspection for ${order.tracking || "a project"} is scheduled for ${new Date(order.inspection_date).toLocaleDateString()}.`
              : `${order.tracking || "A project"} needs a site inspection date.`,
            icon: ClipboardCheck,
            color: "text-amber-600",
            category: "inspections",
            path: "/site-inspection",
            date: order.updatedAt || order.createdAt,
          })),
          ...(accepted.orders || []).map((order) => ({
            id: getAdminNotificationId("accepted", order),
            recordId: String(order._id || order.id || order.tracking),
            title: "Contract accepted",
            message: `Customer accepted ${order.tracking || "a contract"}.`,
            icon: CheckCircle2,
            color: "text-emerald-600",
            category: "accepted",
            path: `/site-inspection?view=${order._id || order.id || order.tracking}`,
            date: order.updatedAt || order.createdAt,
          })),
          ...(declined.orders || []).map((order) => ({
            id: getAdminNotificationId("declined", order),
            recordId: String(order._id || order.id || order.tracking),
            title: "Contract declined",
            message: `Customer declined ${order.tracking || "a contract"}.`,
            icon: XCircle,
            color: "text-red-600",
            category: "declined",
            path: `/site-inspection?view=${order._id || order.id || order.tracking}`,
            date: order.updatedAt || order.createdAt,
          })),
          ...(sentContracts.orders || []).map((order) => ({
            id: getAdminNotificationId("sent", order),
            recordId: String(order._id || order.id || order.tracking),
            title: "Contract sent",
            message: `Contract for ${order.tracking || "a project"} was sent to the customer.`,
            icon: Send,
            color: "text-sky-600",
            category: "sent",
            path: `/site-inspection?view=${order._id || order.id || order.tracking}`,
            date: order.contractSentAt || order.updatedAt || order.createdAt,
          })),
          ...(paymentSubmissions.orders || []).map((order) => {
            const customerName = `${order.customer?.first_name || ""} ${order.customer?.last_name || ""}`.trim()
              || order.customer_name
              || "Customer";
            const orderNumber = order.tracking || order.order_number || order.orderNumber || order._id;
            const amount = Number(order.payment_proof_amount || order.payment_amount || 0)
              .toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

            return {
              id: getAdminNotificationId("payment", order),
              recordId: String(order._id || order.id || order.tracking),
              title: "Customer Reported a Payment",
              message: `${customerName} says they paid ₱${amount} for order ${orderNumber}. Please confirm.`,
              icon: CreditCard,
              color: "text-emerald-600",
              category: "payments",
              path: "/transactions",
              date: order.payment_proof_submitted_at,
            };
          }),
        ]
          .sort(sortAdminNotificationsNewestFirst)
          .slice(0, 8)
          .map((item) => ({ ...item, read: readNotificationIds.has(item.id) }));

        if (active) setNotifications(items);
      } catch (error) {
        console.error("Failed to load admin notifications:", error);
        if (active) setNotifications([]);
      } finally {
        hasFetched = true;
        if (active) setLoading(false);
      }
    };

    fetchNotifications();
    const refreshInterval = window.setInterval(fetchNotifications, 30000);
    return () => {
      active = false;
      window.clearInterval(refreshInterval);
    };
  }, [user]);

  const unreadCount = notifications.filter((n) => !n.read).length;
  const filteredNotifications = notifications.filter((notification) => (
    notificationFilter === "all" || notification.category === notificationFilter
  ));
  const adminFilterOptions = [
    ["all", "All"],
    ["orders", "Orders"],
    ["inspections", "Inspections"],
    ["accepted", "Accepted"],
    ["declined", "Declined"],
    ["sent", "Sent"],
    ["payments", "Payments"],
  ];

  const openNotification = (notification) => {
    setNotifications((current) => current.map((item) => (
      item.id === notification.id ? { ...item, read: true } : item
    )));
    markAdminNotificationRead(notification.id);
    setOpen(false);
    navigate(notification.path, {
      state: {
        notificationHighlight: {
          recordId: notification.recordId,
          recordType: "order",
        },
      },
    });
  };

  const markAllNotificationsRead = () => {
    setNotifications((current) => current.map((item) => ({ ...item, read: true })));
    markAdminNotificationsRead(notifications.map((notification) => notification.id));
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((s) => !s)}
        className={`relative rounded-xl p-2.5 transition ${open || unreadCount > 0 ? (darkMode ? "bg-red-950/60 text-red-300 ring-1 ring-red-400/60" : "bg-red-50 text-red-600 ring-1 ring-red-200") : (darkMode ? "text-slate-200 hover:bg-slate-800" : "text-slate-700 hover:bg-gray-100")}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Notifications"
        title="Notifications"
      >
        <Bell size={23} strokeWidth={2.2} />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 animate-pulse items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white shadow-md shadow-red-500/40">
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className={`fixed inset-x-3 top-[calc(5.25rem+env(safe-area-inset-top))] z-[70] mt-1 max-h-[calc(100dvh-11rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-auto overflow-y-auto overscroll-contain rounded-2xl border shadow-xl lg:absolute lg:inset-x-auto lg:right-0 lg:top-auto lg:z-20 lg:mt-2 lg:max-h-[min(36rem,calc(100vh-6rem))] lg:w-96 lg:overflow-hidden ${darkMode ? "bg-slate-800 border-slate-700" : "bg-white border-slate-200"}`}>
          <div className={`flex items-center justify-between border-b px-4 py-3 ${darkMode ? "border-slate-700" : "border-slate-100"}`}>
            <div>
              <p className={`text-sm font-bold ${darkMode ? "text-white" : "text-slate-950"}`}>Admin activity</p>
              <p className="mt-0.5 text-xs text-slate-400">Actions that need your attention</p>
            </div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && <span className="rounded-full bg-red-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-red-600">{unreadCount} new</span>}
              <button
                type="button"
                onClick={markAllNotificationsRead}
                disabled={unreadCount === 0}
                className={`inline-flex items-center gap-1 text-xs font-semibold transition ${unreadCount === 0 ? "cursor-not-allowed text-slate-400" : darkMode ? "text-red-300 hover:text-white" : "text-red-600 hover:text-red-700"}`}
              >
                <CheckCheck size={14} />
                Mark all as read
              </button>
            </div>
          </div>

          <div className={`flex flex-wrap gap-1 border-b px-3 py-2 ${darkMode ? "border-slate-700" : "border-slate-100"}`}>
            {adminFilterOptions.map(([filter, label]) => {
              const count = filter === "all"
                ? notifications.length
                : notifications.filter((notification) => notification.category === filter).length;

              return (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setNotificationFilter(filter)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
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
              );
            })}
          </div>

          {loading ? (
            <div className={`px-4 py-8 text-center text-sm ${darkMode ? "text-slate-300" : "text-slate-500"}`}>Loading admin activity...</div>
          ) : filteredNotifications.length === 0 ? (
            <div className={`px-4 py-6 text-center ${darkMode ? "text-slate-300" : "text-gray-600"}`}>
              <Bell size={22} className="mx-auto mb-2 text-slate-400" />
              <p>{notificationFilter === "all" ? "No action items right now" : `No ${notificationFilter} notifications`}</p>
            </div>
          ) : (
            <div className="divide-y overflow-y-auto max-h-none lg:max-h-96">
              {filteredNotifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => openNotification(n)}
                  className={`w-full border-l-2 px-4 py-3 text-left transition ${
                    n.read
                      ? darkMode ? "border-transparent bg-slate-800/60 hover:bg-slate-800" : "border-transparent bg-white hover:bg-slate-50"
                      : darkMode ? "border-sky-400/70 bg-slate-800/90 hover:bg-slate-800" : "border-sky-400/70 bg-sky-50/40 hover:bg-sky-50/70"
                  }`}
                >
                  <div className="flex gap-3">
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-slate-100">
                      <n.icon size={17} className={n.color} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className={`truncate text-sm ${n.read ? "font-medium" : "font-bold"} ${darkMode ? n.read ? "text-slate-300" : "text-white" : n.read ? "text-slate-600" : "text-slate-950"}`}>{n.title}</p>
                        {!n.read && <span className="shrink-0 rounded-full bg-sky-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-sky-700">New</span>}
                      </div>
                      <p className={`mt-0.5 text-xs ${darkMode ? n.read ? "text-slate-400" : "text-slate-300" : n.read ? "text-slate-500" : "text-slate-700"}`}>{n.message}</p>
                      <p className="mt-1 text-xs text-slate-400" title={n.date ? formatDateTimeToMMDDYYYY(n.date) : undefined}>
                        {formatTimeAgo(n.date)}
                      </p>
                    </div>
                  </div>
                </button>
              ))}

            </div>
          )}
          <button
            type="button"
            onClick={() => { setOpen(false); navigate("/notifications"); }}
            className={`w-full border-t px-4 py-3 text-center text-sm font-semibold transition ${darkMode ? "border-slate-700 text-red-300 hover:bg-slate-700" : "border-slate-100 text-red-600 hover:bg-red-50"}`}
          >
            View all notifications
          </button>
        </div>
      )}
    </div>
  );
}