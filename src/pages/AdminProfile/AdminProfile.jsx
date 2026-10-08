import { useEffect, useState } from "react";
import {
  User,
  Mail,
  Phone,
  Save,
  ShieldCheck,
  Activity,
  Clock3,
  ChevronLeft,
  ChevronRight,
  LogIn,
  LogOut,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getActivityStorageKey, readActivityLog } from "@/lib/activityLog";
import { getAdminOrder } from "@/api/orders";
import { formatDateTimeToMMMDDYYYY } from "@/lib/dateUtils";

import Sidebar from "../../components/layout/Sidebar";
import Navbar from "../../components/layout/Navbar";
import AdminPageHeader from "../../components/layout/AdminPageHeader";
import { useIsMobile } from "@/hooks/useIsMobile";
import ProfileAvatar from "../../components/ui/ProfileAvatar";

function AdminProfile() {
  const isMobile = useIsMobile();
  const activityPageSize = 5;
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem("sidebarOpen");
    return stored !== null ? JSON.parse(stored) : true;
  });
  const { user, loading, updateProfile } = useAuth();
  const isStaff = user?.role === "skilled_worker";
  const profileType = isStaff ? "Staff" : "Admin";
  const [profile, setProfile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [activeTab, setActiveTab] = useState("profile");
  const [activityLog, setActivityLog] = useState([]);
  const [activityPage, setActivityPage] = useState(1);
  const [activityDateFilter, setActivityDateFilter] = useState("");
  const [activityCategoryFilter, setActivityCategoryFilter] = useState("all");
  const [activitySearch, setActivitySearch] = useState("");
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordModalError, setPasswordModalError] = useState("");

  useEffect(() => {
    localStorage.setItem("sidebarOpen", JSON.stringify(isSidebarOpen));
  }, [isSidebarOpen]);

  useEffect(() => {
    if (!loading && user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProfile({
        first_name: user.first_name || "",
        last_name: user.last_name || "",
        email: user.email || "",
        username: user.username || "",
        role: isStaff ? user.staff_access?.subrole || "Staff" : user.role || "admin",
        phone: user.phone || "",
        street_address: user.street_address || "",
        city: user.city || "",
        province: user.province || "",
        zip_code: user.zip_code || "",
        current_password: "",
        new_password: "",
        confirm_password: "",
      });
    }
  }, [loading, user]);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    const loadActivityLog = async () => {
      const storedActivityLog = readActivityLog(user).filter(
        (activity) =>
          !activity.description.startsWith("Updated profile information") &&
          !activity.description.startsWith("Visited "),
      );
      const orderActivityPrefixes = /^(Approved order|Rejected order|Cancelled site inspection|Restored site inspection|Updated site inspection|Generated contract for order|Created warranty for order|Approved transaction|Cancelled transaction|Updated progress for project|Cancelled project) /;
      const legacyEntries = storedActivityLog.filter((activity) =>
        orderActivityPrefixes.test(activity.description) &&
        /[a-f0-9]{24}/i.test(activity.description),
      );
      const orderIds = [
        ...new Set(
          legacyEntries
            .map((activity) => activity.description.match(/[a-f0-9]{24}/i)?.[0])
            .filter(Boolean),
        ),
      ];
      const orderResults = await Promise.all(
        orderIds.map(async (orderId) => {
          try {
            const response = await getAdminOrder(orderId, "profile");
            return [orderId, response.order || response];
          } catch {
            return [orderId, null];
          }
        }),
      );
      const ordersById = new Map(orderResults);
      const missingOrderIds = new Set(
        orderResults.filter(([, order]) => !order).map(([orderId]) => orderId),
      );
      const resolvedActivityLog = storedActivityLog
        .filter((activity) => {
          const orderId = activity.description.match(/[a-f0-9]{24}/i)?.[0];
          return !missingOrderIds.has(orderId);
        })
        .map((activity) => {
        const orderId = activity.description.match(/[a-f0-9]{24}/i)?.[0];
        const order = orderId ? ordersById.get(orderId) : null;
        if (!order) return activity;

        const customerName = order.customer
          ? `${order.customer.first_name || ""} ${order.customer.last_name || ""}`.trim() || order.customer.email || "Customer"
          : order.customer_name || "Customer";
        if (activity.description.startsWith("Approved order")) {
          return {
            ...activity,
            description: `Approved order for ${customerName} and moved it to site inspection.`,
            page: "Dashboard",
          };
        }
        if (activity.description.startsWith("Rejected order")) {
          return {
            ...activity,
            description: `Rejected order for ${customerName}.`,
            page: "Dashboard",
          };
        }
        if (activity.description.startsWith("Cancelled site inspection")) {
          return {
            ...activity,
            description: `Cancelled site inspection for ${customerName}.`,
            page: "Site Inspection",
          };
        }
        if (activity.description.startsWith("Restored site inspection")) {
          return {
            ...activity,
            description: `Restored site inspection for ${customerName}.`,
            page: "Site Inspection",
          };
        }
        if (activity.description.startsWith("Updated site inspection")) {
          return {
            ...activity,
            description: `Updated site inspection for ${customerName}.`,
            page: "Site Inspection",
          };
        }
        if (activity.description.startsWith("Generated contract for order")) {
          return {
            ...activity,
            description: `Generated contract for ${customerName}.`,
            page: "Site Inspection",
          };
        }
        if (activity.description.startsWith("Created warranty for order")) {
          return {
            ...activity,
            description: `Created warranty for ${customerName}.`,
            page: "Transactions",
          };
        }
        if (activity.description.startsWith("Approved transaction")) {
          return {
            ...activity,
            description: `Approved transaction for ${customerName}.`,
            page: "Transactions",
          };
        }
        if (activity.description.startsWith("Cancelled transaction")) {
          return {
            ...activity,
            description: `Cancelled transaction for ${customerName}.`,
            page: "Transactions",
          };
        }
        if (activity.description.startsWith("Updated progress for project")) {
          return {
            ...activity,
            description: `Updated progress for ${customerName}.`,
            page: "Progress Monitor",
          };
        }
        if (activity.description.startsWith("Cancelled project")) {
          return {
            ...activity,
            description: `Cancelled project for ${customerName}.`,
            page: "Progress Monitor",
          };
        }
        return activity;
        });

      localStorage.setItem(getActivityStorageKey(user), JSON.stringify(resolvedActivityLog));
      if (!cancelled) {
        setActivityLog(resolvedActivityLog);
      }
    };

    loadActivityLog();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const filteredActivityLog = activityLog.filter((activity) => {
    const activityCategory =
      activity.description === "Logged in" || activity.description === "Logged out"
        ? "security"
        : activity.page === "Products"
          ? "system"
          : "project";
    const matchesCategory =
      activityCategoryFilter === "all" ||
      activityCategoryFilter === activityCategory;
    const searchValue = activitySearch.trim().toLowerCase();
    const matchesSearch =
      !searchValue ||
      `${activity.description} ${activity.page || "Admin"}`
        .toLowerCase()
        .includes(searchValue);
    if (!matchesCategory || !matchesSearch) return false;
    if (!activityDateFilter) return true;
    const activityDate = new Date(activity.createdAt);
    const localDate = [
      activityDate.getFullYear(),
      String(activityDate.getMonth() + 1).padStart(2, "0"),
      String(activityDate.getDate()).padStart(2, "0"),
    ].join("-");
    return localDate === activityDateFilter;
  });
  const activityPageCount = Math.max(
    1,
    Math.ceil(filteredActivityLog.length / activityPageSize),
  );
  const currentActivityPage = Math.min(activityPage, activityPageCount);
  const visibleActivity = isMobile
    ? filteredActivityLog
    : filteredActivityLog.slice(
      (currentActivityPage - 1) * activityPageSize,
      currentActivityPage * activityPageSize,
    );

  const handleChange = (e) => {
    const { name, value } = e.target;
    setProfile((prev) => ({ ...prev, [name]: value }));
  };

  const profileHasChanges = () => {
    if (!user) return false;
    return (
      profile.first_name !== (user.first_name || "") ||
      profile.last_name !== (user.last_name || "") ||
      profile.phone !== (user.phone || "") ||
      profile.street_address !== (user.street_address || "") ||
      profile.city !== (user.city || "") ||
      profile.province !== (user.province || "") ||
      profile.zip_code !== (user.zip_code || "") ||
      Boolean(profile.new_password) ||
      Boolean(profile.confirm_password)
    );
  };

  const performSave = async () => {
    if (!profile.current_password) {
      setError("Please enter your current password to save profile changes.");
      return false;
    }

    if (!profile.first_name || !profile.last_name) {
      setError("Please enter both first name and last name.");
      return false;
    }

    if (profile.new_password || profile.confirm_password) {
      if (!profile.new_password) {
        setError("Please enter a new password.");
        return false;
      }

      if (profile.new_password.length < 8) {
        setError("New password must be at least 8 characters long.");
        return false;
      }

      if (profile.new_password !== profile.confirm_password) {
        setError("New password and confirmation do not match.");
        return false;
      }
    }

    setSaving(true);
    try {
      const payload = {
        first_name: profile.first_name,
        last_name: profile.last_name,
        phone: profile.phone,
        street_address: profile.street_address,
        city: profile.city,
        province: profile.province,
        zip_code: profile.zip_code,
        current_password: profile.current_password,
      };

      if (profile.new_password) {
        payload.new_password = profile.new_password;
      }

      const response = await updateProfile(payload);

      setProfile((prev) => ({
        ...prev,
        ...response.user,
        current_password: "",
        new_password: "",
        confirm_password: "",
      }));
      setSuccess("Profile updated successfully.");
      return true;
    } catch (err) {
      setError(err.data?.message || err.message || "Failed to update profile.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    setError("");
    setSuccess("");
    setPasswordModalError("");

    if (!profileHasChanges()) {
      setSuccess("No changes to save.");
      return;
    }

    if (!profile.current_password) {
      setShowPasswordModal(true);
      return;
    }

    await performSave();
  };

  if (loading || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-500">Loading {profileType.toLowerCase()} profile...</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100">
      <Sidebar isOpen={isSidebarOpen} onToggle={() => setIsSidebarOpen((open) => !open)} />

      <div className="flex-1 min-h-0 flex flex-col">
        <Navbar />

        <main className="flex-1 min-h-0 overflow-y-auto px-4 pb-24 pt-4 sm:p-6">
          <AdminPageHeader
            title={`${profileType} Profile`}
            description={`Manage your ${profileType.toLowerCase()} account settings and security.`}
          />

          <div className="mt-5 grid grid-cols-1 gap-4 sm:mt-6 sm:gap-6 xl:grid-cols-3">
            <div className="min-w-0 rounded-3xl bg-white p-5 shadow sm:p-8">
              <div className="flex flex-col items-center">
                <ProfileAvatar
                  name={`${profile.first_name} ${profile.last_name}`}
                  avatarOnly
                  size="lg"
                  className="border-4 border-red-100"
                />

                <h2 className="mt-5 break-words text-center text-xl font-bold sm:text-2xl">
                  {profile.first_name} {profile.last_name}
                </h2>
                <p className="text-gray-500 capitalize">{profile.role}</p>

                <div className="mt-6 w-full space-y-4">
                  <div className="bg-gray-50 rounded-2xl p-4 flex items-center gap-4">
                    <Mail className="text-red-600" />
                    <div>
                      <p className="text-sm text-gray-500">Email</p>
                      <p className="break-all font-medium">{profile.email}</p>
                    </div>
                  </div>

                  <div className="bg-gray-50 rounded-2xl p-4 flex items-center gap-4">
                    <Phone className="text-red-600" />
                    <div>
                      <p className="text-sm text-gray-500">Phone</p>
                      <p className="font-medium">{profile.phone || "Not set"}</p>
                    </div>
                  </div>

                  <div className="bg-gray-50 rounded-2xl p-4 flex items-center gap-4">
                    <ShieldCheck className="text-red-600" />
                    <div>
                      <p className="text-sm text-gray-500">Role</p>
                      <p className="font-medium capitalize">{profile.role}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="min-w-0 rounded-3xl bg-white p-4 shadow sm:p-8 xl:col-span-2">
              <h2 className="text-2xl font-bold mb-6">Profile Settings</h2>

              {error && (
                <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">
                  {error}
                </div>
              )}

              {success && (
                <div className="mb-4 rounded-2xl border border-green-200 bg-green-50 p-4 text-green-700">
                  {success}
                </div>
              )}

              <div className="mt-8">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="grid w-full grid-cols-3 rounded-2xl border border-gray-200 bg-gray-100 p-1 sm:w-auto sm:rounded-3xl sm:p-2">
                    <button
                      type="button"
                      onClick={() => setActiveTab("profile")}
                      className={`rounded-xl px-2 py-3 text-xs font-semibold transition sm:rounded-2xl sm:px-5 sm:text-sm ${
                        activeTab === "profile"
                          ? "bg-white text-red-600 shadow-sm"
                          : "text-gray-600 hover:text-red-600"
                      }`}
                    >
                      Profile
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab("security")}
                      className={`rounded-xl px-2 py-3 text-xs font-semibold transition sm:rounded-2xl sm:px-5 sm:text-sm ${
                        activeTab === "security"
                          ? "bg-white text-red-600 shadow-sm"
                          : "text-gray-600 hover:text-red-600"
                      }`}
                    >
                      Security
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab("activity")}
                      className={`rounded-xl px-2 py-3 text-xs font-semibold transition sm:rounded-2xl sm:px-5 sm:text-sm ${
                        activeTab === "activity"
                          ? "bg-white text-red-600 shadow-sm"
                          : "text-gray-600 hover:text-red-600"
                      }`}
                    >
                      Activity Log
                    </button>
                  </div>
                </div>

                <div className="mt-6">
                  {activeTab === "profile" ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <label className="text-sm font-medium text-gray-600">First Name</label>
                        <div className="relative mt-2">
                          <User size={18} className="absolute left-4 top-4 text-gray-400" />
                          <input
                            type="text"
                            name="first_name"
                            value={profile.first_name}
                            onChange={handleChange}
                            className="w-full pl-12 pr-4 py-3 border rounded-2xl focus:outline-none focus:ring-2 focus:ring-red-500"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="text-sm font-medium text-gray-600">Last Name</label>
                        <div className="relative mt-2">
                          <User size={18} className="absolute left-4 top-4 text-gray-400" />
                          <input
                            type="text"
                            name="last_name"
                            value={profile.last_name}
                            onChange={handleChange}
                            className="w-full pl-12 pr-4 py-3 border rounded-2xl focus:outline-none focus:ring-2 focus:ring-red-500"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="text-sm font-medium text-gray-600">Email Address</label>
                        <div className="relative mt-2">
                          <Mail size={18} className="absolute left-4 top-4 text-gray-400" />
                          <input
                            type="email"
                            name="email"
                            value={profile.email}
                            disabled
                            className="w-full pl-12 pr-4 py-3 border rounded-2xl bg-gray-100 text-gray-500"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="text-sm font-medium text-gray-600">Username</label>
                        <div className="relative mt-2">
                          <User size={18} className="absolute left-4 top-4 text-gray-400" />
                          <input
                            type="text"
                            name="username"
                            value={profile.username}
                            disabled
                            className="w-full pl-12 pr-4 py-3 border rounded-2xl bg-gray-100 text-gray-500"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="text-sm font-medium text-gray-600">Phone Number</label>
                        <div className="relative mt-2">
                          <Phone size={18} className="absolute left-4 top-4 text-gray-400" />
                          <input
                            type="text"
                            name="phone"
                            value={profile.phone}
                            onChange={handleChange}
                            className="w-full pl-12 pr-4 py-3 border rounded-2xl focus:outline-none focus:ring-2 focus:ring-red-500"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="text-sm font-medium text-gray-600">Street Address</label>
                        <input
                          type="text"
                          name="street_address"
                          value={profile.street_address}
                          onChange={handleChange}
                          className="w-full mt-2 px-4 py-3 border rounded-2xl focus:outline-none focus:ring-2 focus:ring-red-500"
                        />
                      </div>

                      <div>
                        <label className="text-sm font-medium text-gray-600">City</label>
                        <input
                          type="text"
                          name="city"
                          value={profile.city}
                          onChange={handleChange}
                          className="w-full mt-2 px-4 py-3 border rounded-2xl focus:outline-none focus:ring-2 focus:ring-red-500"
                        />
                      </div>

                      <div>
                        <label className="text-sm font-medium text-gray-600">Province</label>
                        <input
                          type="text"
                          name="province"
                          value={profile.province}
                          onChange={handleChange}
                          className="w-full mt-2 px-4 py-3 border rounded-2xl focus:outline-none focus:ring-2 focus:ring-red-500"
                        />
                      </div>

                      <div>
                        <label className="text-sm font-medium text-gray-600">Zip Code</label>
                        <input
                          type="text"
                          name="zip_code"
                          value={profile.zip_code}
                          onChange={handleChange}
                          className="w-full mt-2 px-4 py-3 border rounded-2xl focus:outline-none focus:ring-2 focus:ring-red-500"
                        />
                      </div>
                    </div>
                  ) : activeTab === "security" ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="md:col-span-3">
                        <label className="text-sm font-medium text-gray-600">Current Password</label>
                        <input
                          type="password"
                          name="current_password"
                          value={profile.current_password}
                          onChange={handleChange}
                          placeholder="Enter current password"
                          className="w-full mt-2 px-4 py-3 border rounded-2xl focus:outline-none focus:ring-2 focus:ring-red-500"
                        />
                      </div>

                      <div>
                        <label className="text-sm font-medium text-gray-600">New Password</label>
                        <input
                          type="password"
                          name="new_password"
                          value={profile.new_password}
                          onChange={handleChange}
                          placeholder="Enter new password"
                          className="w-full mt-2 px-4 py-3 border rounded-2xl focus:outline-none focus:ring-2 focus:ring-red-500"
                        />
                      </div>

                      <div>
                        <label className="text-sm font-medium text-gray-600">Confirm Password</label>
                        <input
                          type="password"
                          name="confirm_password"
                          value={profile.confirm_password}
                          onChange={handleChange}
                          placeholder="Confirm new password"
                          className="w-full mt-2 px-4 py-3 border rounded-2xl focus:outline-none focus:ring-2 focus:ring-red-500"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center gap-3 rounded-2xl border border-red-100 bg-red-50 p-4">
                        <Activity className="text-red-600" size={20} />
                        <div>
                          <p className="font-semibold text-gray-800">Recent admin activity</p>
                          <p className="text-sm text-gray-600">
                            Successful admin actions from this device appear here.
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                        <div className="md:col-span-1">
                          <label
                            htmlFor="activity-search"
                            className="text-sm font-medium text-gray-600"
                          >
                            Search activity
                          </label>
                          <input
                            id="activity-search"
                            type="search"
                            value={activitySearch}
                            onChange={(event) => {
                              setActivitySearch(event.target.value);
                              setActivityPage(1);
                            }}
                            placeholder="Search activities..."
                            className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-500"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor="activity-category-filter"
                            className="text-sm font-medium text-gray-600"
                          >
                            Filter by category
                          </label>
                          <select
                            id="activity-category-filter"
                            value={activityCategoryFilter}
                            onChange={(event) => {
                              setActivityCategoryFilter(event.target.value);
                              setActivityPage(1);
                            }}
                            className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-500"
                          >
                            <option value="all">All</option>
                            <option value="system">System</option>
                            <option value="security">Security</option>
                            <option value="project">Project</option>
                          </select>
                        </div>
                        <div>
                          <label
                            htmlFor="activity-date-filter"
                            className="text-sm font-medium text-gray-600"
                          >
                            Filter by date
                          </label>
                          <div className="mt-2 flex items-center gap-2">
                          <input
                            id="activity-date-filter"
                            type="date"
                            value={activityDateFilter}
                            onChange={(event) => {
                              setActivityDateFilter(event.target.value);
                              setActivityPage(1);
                            }}
                            className="rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-500"
                          />
                          {activityDateFilter && (
                            <button
                              type="button"
                              onClick={() => {
                                setActivityDateFilter("");
                                setActivityPage(1);
                              }}
                              className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50"
                            >
                              Clear
                            </button>
                          )}
                          </div>
                        </div>
                      </div>

                      {filteredActivityLog.length > 0 ? (
                        <div className="space-y-3">
                          {visibleActivity.map((activity) => {
                            const isLogin = activity.description === "Logged in";
                            const isLogout = activity.description === "Logged out";
                            const isSystemActivity = activity.page === "Products";
                            const activityStyles = isLogin
                              ? darkMode
                                ? { card: "border-l-emerald-400 bg-emerald-950/45 hover:border-emerald-700", icon: "text-emerald-300", title: "text-emerald-200", badge: "border-emerald-800 bg-emerald-950 text-emerald-200", label: "Security" }
                                : { card: "border-l-green-500 bg-green-50/60 hover:border-green-300", icon: "text-green-600", title: "text-green-800", badge: "border-red-200 bg-red-50 text-red-600", label: "Security" }
                              : isLogout
                                ? darkMode
                                  ? { card: "border-l-red-400 bg-red-950/45 hover:border-red-700", icon: "text-red-300", title: "text-red-200", badge: "border-red-800 bg-red-950 text-red-200", label: "Security" }
                                  : { card: "border-l-red-500 bg-red-50/60 hover:border-red-300", icon: "text-red-600", title: "text-red-800", badge: "border-red-200 bg-red-50 text-red-600", label: "Security" }
                                : isSystemActivity
                                  ? darkMode
                                    ? { card: "border-l-slate-500 bg-slate-800 hover:border-slate-500", icon: "text-slate-300", title: "text-slate-200", badge: "border-slate-600 bg-slate-700 text-slate-200", label: "System" }
                                    : { card: "border-l-gray-300 bg-gray-50 hover:border-gray-400", icon: "text-gray-500", title: "text-gray-700", badge: "border-gray-200 bg-gray-100 text-gray-500", label: "System" }
                                  : darkMode
                                    ? { card: "border-l-sky-400 bg-sky-950/40 hover:border-sky-700", icon: "text-sky-300", title: "text-sky-200", badge: "border-sky-800 bg-sky-950 text-sky-200", label: "Project" }
                                    : { card: "border-l-blue-500 bg-blue-50/60 hover:border-blue-300", icon: "text-gray-500", title: "text-blue-800", badge: "border-blue-200 bg-blue-50 text-blue-600", label: "Project" };

                            return (
                              <div
                                key={activity.id}
                                className={`group flex items-start gap-4 rounded-2xl border border-gray-200 border-l-4 p-4 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md ${activityStyles.card}`}
                              >
                                {isLogin ? (
                                  <LogIn className={`mt-0.5 shrink-0 ${activityStyles.icon}`} size={18} />
                                ) : isLogout ? (
                                  <LogOut className={`mt-0.5 shrink-0 ${activityStyles.icon}`} size={18} />
                                ) : (
                                  <Clock3 className={`mt-0.5 shrink-0 ${activityStyles.icon}`} size={18} />
                                )}
                                <div>
                                  <p className={`font-medium ${activityStyles.title}`}>{activity.description}</p>
                                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                                    <span className={`rounded-full border px-2.5 py-1 font-semibold uppercase tracking-wide ${activityStyles.badge}`}>
                                      {activityStyles.label}
                                    </span>
                                    <span className={darkMode ? "text-slate-400" : "text-gray-500"}>
                                      {formatDateTimeToMMMDDYYYY(activity.createdAt)}
                                    </span>
                                    <span className={`font-semibold uppercase tracking-wide ${darkMode ? "text-slate-500" : "text-gray-400"}`}>
                                      Page: {activity.page || "Admin"}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-dashed border-gray-200 p-8 text-center text-gray-500">
                          {activityDateFilter
                            ? "No activity recorded on this date."
                            : "No activity recorded yet."}
                        </div>
                      )}

                      {filteredActivityLog.length > 0 && !isMobile && (
                        <div className="flex items-center justify-end gap-4 pt-2">
                          <span className="text-sm text-gray-500">
                            Page {currentActivityPage} of {activityPageCount}
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setActivityPage(currentActivityPage - 1)}
                              disabled={currentActivityPage === 1}
                              className="inline-flex items-center gap-1 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <ChevronLeft size={16} />
                              Previous
                            </button>
                            <button
                              type="button"
                              onClick={() => setActivityPage(currentActivityPage + 1)}
                              disabled={currentActivityPage === activityPageCount}
                              className="inline-flex items-center gap-1 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Next
                              <ChevronRight size={16} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {activeTab !== "activity" && (
                <div className="mt-8 flex justify-end">
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="bg-red-600 text-white px-6 py-3 rounded-2xl flex items-center gap-2 hover:bg-red-700 transition disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Save size={18} />
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              )}

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
                      value={profile.current_password}
                      onChange={handleChange}
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
                          if (!profile.current_password) {
                            setPasswordModalError("Please enter your current password.");
                            return;
                          }
                          const success = await performSave();
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
        </main>
      </div>
    </div>
  );
}

export default AdminProfile;
