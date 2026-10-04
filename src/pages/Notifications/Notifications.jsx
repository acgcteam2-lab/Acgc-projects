import { useEffect, useState } from "react";
import { getAdminOrders } from "@/api/orders";
import { Bell, CreditCard, Send } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { formatDateTimeToMMDDYYYY, formatTimeAgo } from "@/lib/dateUtils";
import { getAdminNotificationId, getAdminReadNotificationIds, markAdminNotificationRead, sortAdminNotificationsNewestFirst } from "@/lib/notificationState";
import AdminPageHeader from "../../components/layout/AdminPageHeader";

export default function Notifications() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      try {
        const [acceptedResp, declinedResp, sentResp, paymentResp] = await Promise.all([
          getAdminOrders({ contract_status: "accepted", module: "dashboard" }),
          getAdminOrders({ contract_status: "declined", module: "dashboard" }),
          getAdminOrders({ contract_status: "sent", module: "dashboard" }),
          getAdminOrders({ payment_proof_submitted: "true", module: "dashboard" }),
        ]);
        const items = [
          ...(acceptedResp.orders || []).map((o) => ({ ...o, notificationType: "accepted", id: getAdminNotificationId("accepted", o) })),
          ...(declinedResp.orders || []).map((o) => ({ ...o, notificationType: "declined", id: getAdminNotificationId("declined", o) })),
          ...(sentResp.orders || []).map((o) => ({
            ...o,
            updatedAt: o.contractSentAt || o.updatedAt,
            notificationType: "sent",
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
              id: getAdminNotificationId("payment", o),
              title: "Customer Reported a Payment",
              message: `${customerName} says they paid ₱${amount} for order ${orderNumber}. Please confirm.`,
            };
          }),
        ].sort(sortAdminNotificationsNewestFirst);
        const readNotificationIds = getAdminReadNotificationIds();
        setNotifications(items.map((item) => ({ ...item, read: readNotificationIds.has(item.id) })));
      } catch (err) {
        console.error(err);
        setNotifications([]);
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, []);

  return (
    <div className="p-6">
      <AdminPageHeader
        title="Notifications"
        description="Review customer responses and administrative actions that need attention."
      />
      <div className="mt-6 bg-white rounded-3xl p-6 shadow">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Notifications</h2>
        </div>

        <div>
          {loading ? (
            <div className="text-sm text-slate-500">Loading...</div>
          ) : notifications.length === 0 ? (
            <div className="text-sm text-slate-500">No notifications</div>
          ) : (
            <div className="space-y-3">
              {notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    markAdminNotificationRead(n.id);
                    setNotifications((current) => current.map((item) => item.id === n.id ? { ...item, read: true } : item));
                    const recordId = String(n._id || n.id || n.tracking);
                    navigate(n.notificationType === "payment" ? "/transactions" : `/site-inspection?view=${recordId}`, {
                      state: { notificationHighlight: { recordId, recordType: "order" } },
                    });
                  }}
                  className={`w-full border-l-2 p-3 text-left flex gap-3 transition-colors ${n.read ? "border-l-transparent border-y border-r border-slate-200 bg-white hover:bg-slate-50" : "border-l-sky-400 border-y border-r border-sky-200 bg-sky-50/50 hover:bg-sky-50"}`}
                >
                  <div className="flex-shrink-0">
                    {n.notificationType === "payment" ? (
                      <CreditCard size={18} className="text-emerald-600" />
                    ) : n.notificationType === "sent" ? (
                      <Send size={18} className="text-sky-600" />
                    ) : (
                      <Bell size={18} className={n.notificationType === "accepted" ? "text-emerald-600" : "text-red-600"} />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between items-center gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className={`truncate font-semibold ${n.read ? "text-slate-600" : "text-slate-950"}`}>{n.notificationType === "payment" ? n.title : n.tracking}</div>
                        {!n.read && <span className="shrink-0 rounded-full bg-sky-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-sky-700">New</span>}
                      </div>
                      <div className={`shrink-0 text-xs ${n.read ? "text-slate-400" : "text-slate-500"}`} title={formatDateTimeToMMDDYYYY(n.updatedAt || n.createdAt) || undefined}>
                        {formatTimeAgo(n.updatedAt || n.createdAt)}
                      </div>
                    </div>
                    <div className={`mt-1 text-sm ${n.read ? "text-slate-500" : "text-slate-700"}`}>{n.notificationType === "payment"
                      ? n.message
                      : n.notificationType === "accepted"
                      ? `Customer accepted the contract for ₱${Number(n.contract_amount || n.total_amount || 0).toLocaleString()}`
                      : n.notificationType === "sent"
                          ? "Contract sent to customer for review"
                          : "Customer declined the contract"}</div>
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
