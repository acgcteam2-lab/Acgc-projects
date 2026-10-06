import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { createPortal } from "react-dom";
import logo from "../../assets/images/ACGCLOGO1.png";
import { useAuth } from "../../contexts/AuthContext";

import {
  Gauge,
  ClipboardCheck,
  ReceiptText,
  ChartNoAxesCombined,
  Package,
  UserCog,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

import { useAdminTheme } from "@/contexts/AdminThemeContext";

function Sidebar({ isOpen, onToggle }) {
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  const location = useLocation();
  const { logout, user } = useAuth();
  const { darkMode } = useAdminTheme();
  const canViewStaffModule = (moduleKey) => user?.role !== "skilled_worker" || (
    user.staff_access?.modules?.[moduleKey]?.enabled === true &&
    user.staff_access?.modules?.[moduleKey]?.actions?.view === true
  );

  const handleLogout = () => {
    setShowLogoutModal(false);
    logout();
  };

  const handleLogoClick = () => {
    if (window.location.pathname === "/dashboard") {
      window.location.reload();
      return;
    }
    window.location.assign("/dashboard");
  };

  const mobileNavItems = [
    canViewStaffModule("dashboard") && { to: "/dashboard", label: "Dashboard", icon: <Gauge size={20} />, active: location.pathname === "/dashboard" },
    canViewStaffModule("site_inspection") && { to: "/site-inspection", label: "Inspection", icon: <ClipboardCheck size={20} />, active: location.pathname === "/site-inspection" },
    canViewStaffModule("transactions") && { to: "/transactions", label: "Transactions", compactLabel: "Trans.", icon: <ReceiptText size={20} />, active: location.pathname === "/transactions" },
    canViewStaffModule("progress_monitoring") && { to: "/progress-monitor", label: "Monitor", icon: <ChartNoAxesCombined size={20} />, active: location.pathname === "/progress-monitor" },
    canViewStaffModule("product_management") && { to: "/product", label: "Products", icon: <Package size={20} />, active: location.pathname === "/product" },
    canViewStaffModule("profile") && { to: "/profile", label: user?.role === "skilled_worker" ? "Profile" : "Profile", icon: <UserCog size={20} />, active: location.pathname === "/profile" },
    canViewStaffModule("settings") && { to: "/settings", label: "Settings", icon: <Settings size={20} />, active: location.pathname === "/settings" },
  ].filter(Boolean);

  return (
    <>
      <div className={`relative hidden shrink-0 transition-[width] duration-300 ease-in-out motion-reduce:transition-none lg:block ${isOpen ? "w-52" : "w-20"}`}>
        <aside
          className={`admin-sidebar relative h-full min-h-screen w-full border-r shadow-sm overflow-hidden ${darkMode ? "border-red-950/70 bg-gradient-to-b from-[#050817] via-[#10162d] to-[#3b0b1b] text-slate-100" : "border-slate-300 bg-gradient-to-b from-slate-100 via-white to-slate-200 text-slate-900"}`}
        >
        <div className={`pointer-events-none absolute -right-28 -top-24 h-72 w-72 rounded-full border ${darkMode ? "border-red-200/10" : "border-slate-900/10"}`} />
        <div className={`pointer-events-none absolute -right-16 -top-12 h-48 w-48 rounded-full border ${darkMode ? "border-red-200/10" : "border-slate-900/10"}`} />
        <div className={`pointer-events-none absolute -left-24 top-1/3 h-44 w-44 rounded-full border ${darkMode ? "border-blue-200/10" : "border-slate-900/10"}`} />
        <div className={`pointer-events-none absolute -left-14 top-[38%] h-24 w-24 rounded-full border ${darkMode ? "border-blue-200/10" : "border-slate-900/10"}`} />
        <div className={`pointer-events-none absolute -bottom-28 right-6 h-56 w-56 rounded-full border ${darkMode ? "border-red-200/10" : "border-slate-900/10"}`} />
        <div className={`pointer-events-none absolute -bottom-12 right-24 h-28 w-28 rounded-full border ${darkMode ? "border-red-200/10" : "border-slate-900/10"}`} />

        <div className={`relative z-10 flex border-b ${isOpen ? "items-center gap-0 p-1.5" : "flex-col items-center gap-2 p-2"}`}>
          <button
            type="button"
            onClick={handleLogoClick}
            className={`grid min-w-0 cursor-pointer items-center text-left transition-[grid-template-columns,gap] duration-300 ease-in-out motion-reduce:transition-none ${isOpen ? "flex-1 grid-cols-[36px_minmax(0,1fr)] gap-1" : "w-full grid-cols-[1fr_0fr] gap-0"}`}
            aria-label="Go to dashboard"
          >
            <img
              src={logo}
              alt="ACGC Aluminum Services"
              className={`h-8 w-9 shrink-0 justify-self-center object-contain ${darkMode ? "drop-shadow-[0_0_4px_rgba(255,255,255,0.7)]" : ""}`}
            />

            <div className={`min-w-0 overflow-hidden transition-[max-width,opacity] duration-200 ease-in-out motion-reduce:transition-none ${isOpen ? "max-w-full opacity-100" : "max-w-0 opacity-0"}`}>
              <h1 className="truncate text-base font-bold leading-tight text-red-500">
                ACGC Services
              </h1>

              <p className={`whitespace-nowrap text-[10px] leading-tight font-bold ${darkMode ? "text-slate-300" : "text-gray-700"}`}>
                Aluminum & Glass Services
              </p>
            </div>
          </button>
        </div>

        {/* MENU */}
        <nav className="mt-3 flex flex-col gap-1.5 px-2 py-1">

          {canViewStaffModule("dashboard") && <MenuItem
            to="/dashboard"
            icon={<Gauge size={20} />}
            label="Dashboard"
            isOpen={isOpen}
            active={location.pathname === "/dashboard"}
            darkMode={darkMode}
          />}

          {canViewStaffModule("site_inspection") && <MenuItem
            to="/site-inspection"
            icon={<ClipboardCheck size={20} />}
            label="Site Inspection"
            isOpen={isOpen}
            active={location.pathname === "/site-inspection"}
            darkMode={darkMode}
          />}

          {canViewStaffModule("transactions") && <MenuItem
            to="/transactions"
            icon={<ReceiptText size={20} />}
            label="Transactions"
            isOpen={isOpen}
            active={location.pathname === "/transactions"}
            darkMode={darkMode}
          />}

          {canViewStaffModule("progress_monitoring") && <MenuItem
            to="/progress-monitor"
            icon={<ChartNoAxesCombined size={20} />}
            label="Progress Monitor"
            isOpen={isOpen}
            active={location.pathname === "/progress-monitor"}
            darkMode={darkMode}
          />}

          {canViewStaffModule("product_management") && <MenuItem
            to="/product"
            icon={<Package size={20} />}
            label="Products"
            isOpen={isOpen}
            active={location.pathname === "/product"}
            darkMode={darkMode}
          />}

          {canViewStaffModule("profile") && <MenuItem
            to="/profile"
            icon={<UserCog size={20} />}
            label={user?.role === "skilled_worker" ? "Staff Profile" : "Admin Profile"}
            isOpen={isOpen}
            active={location.pathname === "/profile"}
            darkMode={darkMode}
          />}

          {canViewStaffModule("settings") && <MenuItem
            to="/settings"
            icon={<Settings size={20} />}
            label="Settings"
            isOpen={isOpen}
            active={location.pathname === "/settings"}
            darkMode={darkMode}
          />}

          {/* LOGOUT */}
          <button
            onClick={() => setShowLogoutModal(true)}
            title="Logout"
            className={`relative z-10 flex min-h-10 w-full items-center rounded-lg px-3 py-2 text-sm text-red-500 transition-[gap,background-color,color] duration-300 ease-in-out motion-reduce:transition-none ${darkMode ? "hover:bg-red-950/70 hover:text-red-300" : "hover:bg-red-50"} ${isOpen ? "justify-start gap-2.5" : "justify-center gap-0"}`}
          >
            <LogOut size={20} className="shrink-0" />
            <span className={`min-w-0 overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-200 ease-in-out motion-reduce:transition-none ${isOpen ? "max-w-full opacity-100" : "invisible max-w-0 opacity-0"}`}>
              Logout
            </span>
          </button>

        </nav>
        </aside>
        <button
          type="button"
          onClick={onToggle}
          aria-label={isOpen ? "Collapse sidebar" : "Expand sidebar"}
          aria-pressed={!isOpen}
          title={isOpen ? "Collapse sidebar" : "Expand sidebar"}
          className={`absolute right-0 top-7 z-20 inline-flex h-8 w-8 translate-x-1/2 cursor-pointer items-center justify-center rounded-full border shadow-[0_2px_8px_rgba(15,23,42,0.18)] ring-1 ring-black/5 transition-[transform,background-color,border-color,box-shadow,color] duration-150 hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 motion-reduce:transition-none ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200 ring-white/10 hover:border-red-800 hover:bg-slate-700 hover:text-red-300" : "border-slate-200 bg-white text-slate-600 hover:border-red-200 hover:bg-red-50 hover:text-red-700"}`}
        >
          {isOpen ? <ChevronLeft size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}
        </button>
      </div>

      <nav
        aria-label="Admin navigation"
        className={`admin-mobile-navigation fixed inset-x-0 bottom-0 z-[60] flex w-full items-center justify-around gap-0 border-t px-1 pt-1.5 pb-[calc(0.5rem+env(safe-area-inset-bottom))] backdrop-blur-xl lg:hidden ${darkMode ? "border-slate-800 bg-slate-950/95" : "border-slate-200 bg-white/95"}`}
      >
        {mobileNavItems.map(({ to, label, compactLabel, icon, active }) => (
          <Link
            key={to}
            to={to}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            title={label}
            className={`group flex h-[58px] min-w-0 flex-1 flex-col items-center justify-center rounded-lg px-0.5 text-center transition-[transform,background-color,color] duration-200 ease-out hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand motion-reduce:transform-none motion-reduce:transition-none ${active ? darkMode ? "text-white" : "text-slate-900" : darkMode ? "text-slate-400 hover:bg-slate-800 hover:text-slate-100" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"}`}
          >
            <span
              className={[
                "relative z-10 flex items-center justify-center transition-[transform,width,height,border-radius,background-color,border-color,color,box-shadow] duration-[220ms] ease-out group-hover:scale-105 group-active:scale-90 motion-reduce:transition-none",
                active ? "-translate-y-6 size-10 rounded-full border-2 ring-4 shadow-lg" : "size-7 rounded-lg",
                active
                  ? darkMode
                    ? "border-slate-900 bg-gradient-to-br from-brand-dark-fill via-brand to-red-700 text-white ring-red-300/30 shadow-black/50"
                    : "border-white bg-gradient-to-br from-brand via-red-800 to-red-600 text-white ring-red-400/35 shadow-red-900/35"
                  : darkMode
                    ? "text-slate-300 group-hover:bg-white/[0.06]"
                    : "text-slate-600 group-hover:bg-black/[0.04]",
              ].join(" ")}
              aria-hidden="true"
            >
              {icon}
            </span>
            <span className={`mt-0.5 max-w-full truncate leading-[10px] transition-opacity duration-150 motion-reduce:transition-none ${active ? "text-[9px] font-bold opacity-100 max-[360px]:text-[8px]" : "text-[8px] font-medium opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 max-[360px]:text-[7px]"} ${compactLabel ? "max-[360px]:hidden" : ""}`} aria-hidden="true">{label}</span>
            {compactLabel && <span className={`mt-0.5 hidden max-w-full truncate leading-[10px] transition-opacity duration-150 motion-reduce:transition-none max-[360px]:inline ${active ? "text-[9px] font-bold opacity-100 max-[360px]:text-[8px]" : "text-[8px] font-medium opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 max-[360px]:text-[7px]"}`} aria-hidden="true">{compactLabel}</span>}
          </Link>
        ))}
      </nav>

      {/* LOGOUT MODAL */}
      {showLogoutModal && createPortal(
        <div className="fixed inset-0 z-[100] flex min-h-screen items-center justify-center p-4">
          <div
            className="logout-modal-backdrop-in absolute inset-0 bg-black/45 backdrop-blur-md"
            onClick={() => setShowLogoutModal(false)}
          />
          <div className={`logout-modal-in relative z-40 w-full max-w-sm rounded-2xl p-6 text-center shadow-2xl ${darkMode ? "bg-slate-800 text-white" : "bg-white text-slate-900"}`}>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
              <LogOut size={22} />
            </div>
            <h3 className="mt-4 text-lg font-semibold">Confirm Logout</h3>
            <p className={`mt-2 text-sm ${darkMode ? "text-slate-300" : "text-gray-600"}`}>
              Are you sure you want to log out?
            </p>
            <div className="mt-5 flex justify-center gap-2">
              <button
                onClick={() => setShowLogoutModal(false)}
                className={`rounded-lg px-3 py-1 ${darkMode ? "bg-slate-700 text-slate-100 hover:bg-slate-600" : "bg-gray-100 hover:bg-gray-200"}`}
              >
                Cancel
              </button>
              <button
                onClick={handleLogout}
                className="rounded-lg bg-red-600 px-3 py-1 text-white hover:bg-red-700"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

function MenuItem({
  to,
  icon,
  label,
  isOpen,
  active,
  nested = false,
  darkMode = false,
}) {
  return (
    <Link
      to={to}
      title={label}
      className={`group relative grid min-h-10 w-full items-center rounded-lg px-3 py-2 text-sm transition-[grid-template-columns,gap,background-color,color,transform] duration-200 ease-out hover:translate-x-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 motion-reduce:transition-none motion-reduce:hover:translate-x-0 ${
        active
          ? darkMode
            ? "border border-red-800/70 bg-red-950/40 text-red-200 shadow-[inset_3px_0_0_#f87171]"
            : "border border-red-200 bg-red-50/80 text-red-950 shadow-[inset_3px_0_0_#b91c1c]"
          : darkMode
            ? "text-slate-300 hover:bg-red-950/70 hover:text-red-200"
            : "text-gray-700 hover:bg-red-50 hover:text-red-700"
      } ${isOpen ? "grid-cols-[20px_minmax(0,1fr)] gap-2.5" : "grid-cols-[1fr_0fr] gap-0"} ${nested ? "rounded-l-none rounded-r-xl" : ""}`}
    >
      <span className={`relative shrink-0 justify-self-center transition-transform duration-200 ease-out motion-reduce:transition-none ${
        isOpen ? "" : "group-hover:-translate-y-0.5 group-hover:scale-110 motion-reduce:group-hover:translate-y-0 motion-reduce:group-hover:scale-100"
      }`}>{icon}</span>
      <span className={`min-w-0 overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-200 ease-in-out motion-reduce:transition-none ${
        isOpen ? "max-w-full opacity-100" : "max-w-0 opacity-0"
      }`}>
        {label}
      </span>
    </Link>
  );
}

export default Sidebar;