import { useEffect, useMemo, useRef, useState } from "react";
import {
  Calendar,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  ChevronDown,
  CircleCheck,
  CloudUpload,
  Database,
  Download,
  FileArchive,
  History,
  Loader2,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { RadioGroup } from "radix-ui";
import { motion, useReducedMotion } from "framer-motion";
import toast, { Toaster } from "react-hot-toast";

import Sidebar from "../../components/layout/Sidebar";
import Navbar from "../../components/layout/Navbar";
import AdminPageHeader from "../../components/layout/AdminPageHeader";
import { useAuth } from "../../contexts/AuthContext";
import { useAdminTheme } from "../../contexts/AdminThemeContext";
import { recordActivity } from "@/lib/activityLog";
import { cn } from "@/lib/utils";
import {
  createSystemBackup,
  deleteSystemBackup,
  downloadSystemBackup,
  getAdminUsers,
  getSystemSettings,
  restoreSystemBackup,
  uploadSystemBackup,
  updateAdminUserAccess,
  updateSystemSettings,
} from "@/api/users";

const PERMISSIONS = [
  { key: "can_request_orders", label: "Can Request Orders", description: "Submit new glass/aluminum orders" },
  { key: "can_estimate_pricing", label: "Can Estimate Pricing", description: "Access the pricing estimator tool" },
  { key: "view_only_access", label: "View Only Access", description: "Read-only access to the account" },
  { key: "can_track_products", label: "Can Track Products", description: "Look up order status using a tracking code" },
  { key: "can_upload_feedback", label: "Can Upload/View Feedback", description: "Allow customers to view product feedback" },
  { key: "show_ratings_homepage", label: "Show Ratings on Homepage", description: "Display customer ratings on the homepage" },
];

const STAFF_MODULES = [
  { key: "dashboard", label: "Dashboard", actions: [{ key: "view", label: "View", enabled: true }] },
  { key: "product_management", label: "Product Management", actions: [{ key: "view", label: "View", enabled: true }, { key: "add", label: "Add" }, { key: "edit", label: "Edit" }, { key: "delete", label: "Delete" }] },
  { key: "site_inspection", label: "Site Inspection", enabled: false, actions: [{ key: "view", label: "View" }, { key: "view_details", label: "View Details" }, { key: "edit", label: "Edit" }, { key: "cancel", label: "Cancel" }, { key: "generate_contract", label: "Generate Contract" }, { key: "send_email", label: "Send Email" }, { key: "download_contract", label: "Download Contract" }, { key: "manual_approve", label: "Manual Approve" }] },
  { key: "progress_monitoring", label: "Progress Monitoring", actions: [{ key: "view", label: "View", enabled: true }, { key: "view_details", label: "View Details", enabled: true }, { key: "edit", label: "Edit" }, { key: "delete_proof", label: "Delete Proof" }] },
  { key: "transactions", label: "Transactions", actions: [{ key: "view", label: "View", enabled: true }, { key: "view_details", label: "View Details", enabled: true }, { key: "edit", label: "Edit" }, { key: "view_contract", label: "View Contract" }, { key: "download_contract", label: "Download Contract" }, { key: "send_email", label: "Send Email" }] },
  { key: "settings", label: "Settings", actions: [{ key: "view", label: "View", enabled: true }, { key: "manage_access", label: "Manage Access", enabled: true }, { key: "back_up", label: "Back Up", enabled: true }] },
  { key: "profile", label: "Profile", actions: [{ key: "view", label: "View", enabled: true }, { key: "edit", label: "Edit" }] },
];
const STAFF_SUBROLES = ["Helper", "Installer", "Fabricator", "Site Inspector", "Supervisor"];

const defaultPermissions = () => Object.fromEntries(PERMISSIONS.map(({ key }) => [key, key !== "view_only_access"]));

const normalizePermissions = (permissions) => {
  const normalized = { ...defaultPermissions(), ...(permissions || {}) };
  if (normalized.view_only_access) {
    PERMISSIONS.forEach(({ key }) => {
      normalized[key] = key === "view_only_access";
    });
  }
  return normalized;
};

const defaultStaffAccess = () => ({
  profile_version: 2,
  subrole: "Helper",
  custom_subroles: [],
  modules: Object.fromEntries(STAFF_MODULES.map(({ key, enabled = true, actions }) => [key, {
    enabled,
    actions: Object.fromEntries(actions.map(({ key: actionKey, enabled: actionEnabled = false }) => [actionKey, actionEnabled])),
  }])),
});

const normalizeStaffAccess = (staffAccess = {}) => {
  const defaults = defaultStaffAccess();
  const needsSettingsAccessMigration = Number(staffAccess.profile_version || 0) < 2;
  return {
    profile_version: 2,
    subrole: staffAccess.subrole || defaults.subrole,
    custom_subroles: Array.isArray(staffAccess.custom_subroles) ? staffAccess.custom_subroles : [],
    modules: Object.fromEntries(STAFF_MODULES.map(({ key, actions }) => {
      const moduleAccess = staffAccess.modules?.[key] || defaults.modules[key];
      return [key, {
        enabled: key === "settings" && needsSettingsAccessMigration ? true : moduleAccess.enabled === true,
        actions: Object.fromEntries(actions.map(({ key: actionKey }) => [
          actionKey,
          key === "settings" && needsSettingsAccessMigration
            ? true
            : typeof moduleAccess.actions?.[actionKey] === "boolean"
              ? moduleAccess.actions[actionKey]
              : defaults.modules[key].actions[actionKey],
        ])),
      }];
    })),
  };
};

function Settings() {
  const { user, logout } = useAuth();
  const { darkMode } = useAdminTheme();
  const prefersReducedMotion = useReducedMotion();
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";
  const canManageAccess = isAdmin || (user?.role === "skilled_worker" && user.staff_access?.modules?.settings?.enabled === true && user.staff_access.modules.settings.actions?.manage_access === true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem("sidebarOpen");
    return stored !== null ? JSON.parse(stored) : true;
  });
  const [users, setUsers] = useState([]);
  const [activeTab, setActiveTab] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [permissionAccount, setPermissionAccount] = useState(null);
  const [permissionDraft, setPermissionDraft] = useState(null);
  const [staffAccount, setStaffAccount] = useState(null);
  const [staffDraft, setStaffDraft] = useState(null);
  const [expandedStaffModule, setExpandedStaffModule] = useState(null);
  const [customSubroleInput, setCustomSubroleInput] = useState("");
  const [showUpgradeConfirm, setShowUpgradeConfirm] = useState(false);
  const [globalPermissions, setGlobalPermissions] = useState(defaultPermissions);
  const [globalOpen, setGlobalOpen] = useState(false);
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [savingMaintenance, setSavingMaintenance] = useState(false);
  const [loadingBackupSettings, setLoadingBackupSettings] = useState(true);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [backupImportFile, setBackupImportFile] = useState(null);
  const [isDraggingBackupFile, setIsDraggingBackupFile] = useState(false);
  const [uploadedBackup, setUploadedBackup] = useState(null);
  const [uploadingBackupFile, setUploadingBackupFile] = useState(false);
  const [removingBackupFile, setRemovingBackupFile] = useState(false);
  const [downloadingBackupId, setDownloadingBackupId] = useState(null);
  const [restoreConfirmation, setRestoreConfirmation] = useState(null);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState(null);
  const [deletingBackup, setDeletingBackup] = useState(false);
  const restoreDialogRef = useRef(null);
  const restoreDialogTriggerRef = useRef(null);
  const backupUploadInputRef = useRef(null);
  const deleteDialogRef = useRef(null);
  const deleteDialogTriggerRef = useRef(null);
  const [activeSettingsTab, setActiveSettingsTab] = useState("user-management");
  const backupOptions = [
    { id: "weekly", label: "Weekly", description: "Every Sunday at midnight" },
    { id: "monthly", label: "Monthly", description: "1st of every month" },
    { id: "yearly", label: "Yearly", description: "December 31st at midnight" },
  ];

  const getDefaultBackupState = () => {
    return {
      selectedSchedule: "weekly",
      lastBackupAt: null,
      status: null,
      backups: [],
    };
  };

  const [backupState, setBackupState] = useState(getDefaultBackupState);
  const backupPageSize = 5;
  const [backupPage, setBackupPage] = useState(1);
  const settingsTabs = [
    { key: "user-management", label: "User Management" },
    { key: "backup-recovery", label: "Backup & Recovery" },
  ];
  const isOwnStaffAccount = Boolean(
    staffAccount &&
    String(staffAccount._id || staffAccount.id || "") === String(user?._id || user?.id || "")
  );

  useEffect(() => {
    localStorage.setItem("sidebarOpen", JSON.stringify(isSidebarOpen));
  }, [isSidebarOpen]);

  useEffect(() => {
    getSystemSettings()
      .then((response) => {
        setMaintenanceMode(response.maintenance_mode === true);
        if (response.global_permissions) {
          setGlobalPermissions(normalizePermissions(response.global_permissions));
        }
        setBackupState({
          selectedSchedule: ["weekly", "monthly", "yearly"].includes(response.backup_schedule) ? response.backup_schedule : "weekly",
          status: response.backup_status || null,
          lastBackupAt: response.last_backup_at || null,
          backups: Array.isArray(response.backup_history) ? response.backup_history : [],
        });
      })
      .catch((error) => toast.error(error?.data?.message || error?.message || "Unable to load system settings."))
      .finally(() => setLoadingBackupSettings(false));
  }, []);

  useEffect(() => {
    if (!restoreConfirmation) {
      restoreDialogTriggerRef.current?.focus();
      return undefined;
    }

    if (!restoringBackup) restoreDialogRef.current?.focus();
    const closeOnEscape = (event) => {
      if (event.key === "Escape" && !restoringBackup) setRestoreConfirmation(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [restoreConfirmation, restoringBackup]);

  useEffect(() => {
    if (!deleteConfirmation) {
      deleteDialogTriggerRef.current?.focus();
      return undefined;
    }

    if (!deletingBackup) deleteDialogRef.current?.focus();
    const closeOnEscape = (event) => {
      if (event.key === "Escape" && !deletingBackup) setDeleteConfirmation(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [deleteConfirmation, deletingBackup]);

  useEffect(() => {
    const loadUsers = async () => {
      setLoading(true);
      try {
        const response = await getAdminUsers();
        setUsers((response.users || []).map((account) => ({ ...account, is_active: true })));
      } catch (error) {
        setUsers([]);
        toast.error(error?.data?.message || error?.message || "Unable to load users.");
      } finally {
        setLoading(false);
      }
    };

    loadUsers();
  }, []);

  const allDisplayUsers = useMemo(() => {
    const authAdmin = user && (user.role === "admin" || user.role === "super_admin")
      ? {
          ...user,
          _id: user._id || user.id,
          id: user.id || user._id,
          first_name: user.first_name || "Admin",
          last_name: user.last_name || "",
          email: user.email || "",
          role: user.role || "admin",
          is_active: true,
          access_permissions: normalizePermissions(user.access_permissions || defaultPermissions()),
        }
      : null;
    if (!authAdmin) return users;
    const seenIds = new Set([authAdmin._id, authAdmin.id].filter(Boolean));
    const realUsers = users.filter((account) => {
      const accountId = account._id || account.id;
      return accountId && !seenIds.has(accountId);
    });
    return [authAdmin, ...realUsers];
  }, [users, user]);

  const counts = useMemo(() => ({
    all: allDisplayUsers.length,
    customer: allDisplayUsers.filter((account) => account.role === "customer").length,
    staff: allDisplayUsers.filter((account) => account.role === "skilled_worker").length,
    helper: allDisplayUsers.filter((account) => account.role === "helper").length,
    skilled_worker: allDisplayUsers.filter((account) => account.role === "skilled_worker").length,
    active: allDisplayUsers.filter((account) => account.is_active !== false).length,
  }), [allDisplayUsers]);

  const userCategoryTabs = [
    { key: "all", label: "All Users", count: counts.all },
    { key: "customer", label: "Customers", count: counts.customer },
    { key: "staff", label: "Staff", count: counts.staff },
    { key: "helper", label: "Helpers", count: counts.helper },
    { key: "skilled_worker", label: "Skilled Workers", count: counts.skilled_worker },
  ];

  const displayUsers = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return allDisplayUsers.filter((account) => {
      const matchesRole = activeTab === "all"
        || (activeTab === "staff" || activeTab === "skilled_worker"
          ? account.role === "skilled_worker"
          : account.role === activeTab);
      const matchesSearch = !normalizedSearch || [account.first_name, account.last_name, account.email, account.username]
        .some((value) => String(value || "").toLowerCase().includes(normalizedSearch));
      return matchesRole && matchesSearch;
    });
  }, [allDisplayUsers, activeTab, search]);

  const getPermissions = (account) => normalizePermissions(account.access_permissions);

  const updateGlobalPermission = (key, checked) => {
    setGlobalPermissions((current) => normalizePermissions({
      ...current,
      ...(key === "view_only_access" && checked
        ? Object.fromEntries(PERMISSIONS.map(({ key: permissionKey }) => [permissionKey, permissionKey === "view_only_access"]))
        : { [key]: checked }),
    }));
  };

  const updateUser = async (account, patch) => {
    const accountId = account._id || account.id;
    const previous = account;
    const nextPermissions = normalizePermissions({ ...getPermissions(account), ...patch });
    const next = { ...account, access_permissions: nextPermissions };
    setUsers((current) => current.map((item) => (item._id || item.id) === accountId ? next : item));
    setSavingId(accountId);
    try {
      const response = await updateAdminUserAccess(accountId, nextPermissions);
      setUsers((current) => current.map((item) => (item._id || item.id) === accountId ? response.user : item));
      recordActivity(user, `Updated access permissions for ${account.first_name} ${account.last_name}.`, "Settings");
      return true;
    } catch (error) {
      setUsers((current) => current.map((item) => (item._id || item.id) === accountId ? previous : item));
      toast.error(error?.data?.message || error?.message || "Unable to update permissions.");
      return false;
    } finally {
      setSavingId(null);
    }
  };

  const renderBackupRecovery = (metrics) => {
    const isSuccessfulStatus = metrics.status === "Success";
    const isFailedStatus = metrics.status === "Failed" || metrics.status === "Error";
    const statusTone = isSuccessfulStatus
      ? "bg-green-100 text-green-700 dark:bg-green-950/60 dark:text-green-300"
      : isFailedStatus
        ? "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300"
        : "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300";
    const statusValueTone = isSuccessfulStatus
      ? "text-green-700 dark:text-green-300"
      : isFailedStatus
        ? "text-red-700 dark:text-red-300"
        : "text-amber-800 dark:text-amber-300";
    const hasSelectedBackupFile = Boolean(backupImportFile || uploadedBackup);

    return (
      <>
        {activeSettingsTab === "backup-recovery" && (
          <div className="mt-4.5 min-w-0 max-w-full space-y-4.5 overflow-x-clip">
            <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3.5">
              <motion.article whileHover={prefersReducedMotion ? undefined : { y: -2 }} transition={{ duration: prefersReducedMotion ? 0 : 0.18 }} className={cn("flex min-w-0 items-center gap-3.5 rounded-2xl border px-4.5 py-4 transition-colors motion-reduce:transition-none hover:border-brand/30", "border-border bg-card dark:border-slate-700 dark:bg-slate-900")}>
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand dark:bg-brand/15 dark:text-brand-dark-text"><Calendar aria-hidden="true" className="size-[21px]" /></span>
                <span className="min-w-0"><span className="block text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">Last backup</span><span className="mt-1 block text-[19px] font-medium text-foreground">{metrics.lastBackupAt ? formatBackupDateShort(metrics.lastBackupAt) : "No backup"}</span></span>
              </motion.article>
              <motion.article whileHover={prefersReducedMotion ? undefined : { y: -2 }} transition={{ duration: prefersReducedMotion ? 0 : 0.18 }} className={cn("flex min-w-0 items-center gap-3.5 rounded-2xl border px-4.5 py-4 transition-colors motion-reduce:transition-none hover:border-brand/30", "border-border bg-card dark:border-slate-700 dark:bg-slate-900")}>
                <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", statusTone)}><History aria-hidden="true" className="size-[21px]" /></span>
                <span className="min-w-0"><span className="block text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">Backup status</span><span className={cn("mt-1 inline-flex items-center gap-2 text-[19px] font-medium", statusValueTone)}><span className="relative flex size-[9px] shrink-0" aria-hidden="true"><span className={cn("absolute inline-flex size-full rounded-full motion-safe:animate-ping motion-reduce:animate-none", isSuccessfulStatus ? "bg-green-500/45" : isFailedStatus ? "bg-red-500/45" : "bg-amber-500/45")} /><span className={cn("relative inline-flex size-[9px] rounded-full", isSuccessfulStatus ? "bg-green-500" : isFailedStatus ? "bg-red-500" : "bg-amber-500")} /></span>{metrics.status}</span></span>
              </motion.article>
              <motion.article whileHover={prefersReducedMotion ? undefined : { y: -2 }} transition={{ duration: prefersReducedMotion ? 0 : 0.18 }} className={cn("flex min-w-0 items-center gap-3.5 rounded-2xl border px-4.5 py-4 transition-colors motion-reduce:transition-none hover:border-brand/30", "border-border bg-card dark:border-slate-700 dark:bg-slate-900")}>
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"><Database aria-hidden="true" className="size-[21px]" /></span>
                <span className="min-w-0"><span className="block text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">Backup snapshots</span><span className="mt-1 block text-[19px] font-medium text-foreground">{metrics.totalBackups} backups</span></span>
              </motion.article>
              <motion.article whileHover={prefersReducedMotion ? undefined : { y: -2 }} transition={{ duration: prefersReducedMotion ? 0 : 0.18 }} className={cn("flex min-w-0 items-center gap-3.5 rounded-2xl border px-4.5 py-4 transition-colors motion-reduce:transition-none hover:border-brand/30", "border-border bg-card dark:border-slate-700 dark:bg-slate-900")}>
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-green-500/10 text-green-700 dark:bg-green-950/60 dark:text-green-300"><CircleCheck aria-hidden="true" className="size-[21px]" /></span>
                <span className="min-w-0"><span className="block text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">Success rate</span><span className="mt-1 block text-[19px] font-medium text-foreground">{metrics.successRate}%</span></span>
              </motion.article>
            </div>

            <div className="grid grid-cols-1 items-stretch gap-4.5 lg:grid-cols-[minmax(300px,390px)_minmax(0,1fr)]">
              <section className="flex min-w-0 flex-col overflow-hidden rounded-[20px] border border-border bg-card dark:border-slate-700 dark:bg-slate-900">
                <header className="px-6 pt-5.5 max-[520px]:px-4"><h3 id="backup-schedule-heading" className="text-[19px] font-medium text-foreground">Backup Schedule</h3></header>
                <div className="flex-1 px-6 pb-5.5 pt-4.5 max-[520px]:px-4">
                  <RadioGroup.Root value={backupState.selectedSchedule} onValueChange={handleScheduleChange} disabled={loadingBackupSettings} aria-label="Backup Schedule" aria-labelledby="backup-schedule-heading" className="flex flex-col gap-2.5">
                    {backupOptions.map((option) => {
                      const isSelected = backupState.selectedSchedule === option.id;
                      const ScheduleIcon = { weekly: CalendarDays, monthly: CalendarRange, yearly: CalendarClock }[option.id];
                      return (
                        <label key={option.id} htmlFor={`backup-schedule-${option.id}`} className={cn(
                          "flex min-h-[74px] cursor-pointer items-center gap-3 rounded-[14px] px-4 py-3.25 transition-colors motion-reduce:transition-none",
                          isSelected ? "border-[1.5px] border-brand/50 bg-brand/[0.07] dark:border-brand-dark-text/50 dark:bg-brand-dark-fill/10" : "border border-border bg-background hover:bg-muted/50 dark:border-slate-700 dark:bg-slate-950 dark:hover:bg-slate-800",
                        )}>
                          <span className={cn("flex size-[42px] shrink-0 items-center justify-center rounded-[11px] transition-colors motion-reduce:transition-none", isSelected ? "bg-brand text-white dark:bg-brand-dark-fill" : "bg-muted text-muted-foreground dark:bg-slate-800 dark:text-slate-300")}><ScheduleIcon aria-hidden="true" className="size-5" /></span>
                          <span className="min-w-0 flex-1"><span className="block text-base font-medium text-foreground">{option.label}</span><span className="mt-0.5 block text-sm text-muted-foreground">{option.description}</span></span>
                          <RadioGroup.Item id={`backup-schedule-${option.id}`} value={option.id} aria-label={option.label} className="flex size-5 shrink-0 items-center justify-center rounded-full border border-muted-foreground/50 text-brand outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=checked]:border-brand motion-reduce:transition-none dark:border-slate-500 dark:text-brand-dark-text dark:focus-visible:ring-offset-slate-900 dark:data-[state=checked]:border-brand-dark-text">
                            <RadioGroup.Indicator className="flex items-center justify-center"><span className="size-2.5 rounded-full bg-current" /></RadioGroup.Indicator>
                          </RadioGroup.Item>
                        </label>
                      );
                    })}
                  </RadioGroup.Root>
                </div>
                <footer className="flex min-h-[70px] items-center border-t border-border bg-muted/50 px-6 py-3.5 dark:border-slate-700 dark:bg-slate-800/50 max-[520px]:px-4">
                  <button type="button" onClick={handleBackupNow} disabled={loadingBackupSettings || creatingBackup} className="inline-flex h-10.5 w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none dark:bg-brand-dark-fill">
                    {creatingBackup ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Database aria-hidden="true" className="size-4" />}
                    {creatingBackup ? "Creating backup..." : "Back Up Now"}
                  </button>
                </footer>
              </section>

              <section className="flex min-w-0 flex-col overflow-hidden rounded-[20px] border border-border bg-card dark:border-slate-700 dark:bg-slate-900">
                <header className="px-6 pt-5.5 max-[520px]:px-4">
                  <h3 className="text-[19px] font-medium text-foreground">Upload Backup File</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Drop a backup <span className="font-medium text-foreground">ZIP</span> here or choose one to restore your system. The transactions Excel report is included inside the <span className="font-medium text-foreground">ZIP</span>; do not upload it separately. Legacy <code className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[12px] text-foreground">.json.gz</code> backups are also supported.</p>
                </header>
                <div className="flex-1 px-6 pb-5.5 pt-4.5 max-[520px]:px-4">
                  <div
                    onDragEnter={(event) => {
                      event.preventDefault();
                      if (!uploadedBackup && !uploadingBackupFile) setIsDraggingBackupFile(true);
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDragLeave={(event) => {
                      const nextTarget = event.relatedTarget;
                      if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) setIsDraggingBackupFile(false);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      setIsDraggingBackupFile(false);
                      if (!uploadedBackup && !uploadingBackupFile) handleBackupFileSelection(event.dataTransfer.files?.[0]);
                    }}
                    className={cn("flex h-full min-h-[200px] flex-col items-center justify-center gap-3.5 rounded-2xl border-[1.5px] border-dashed bg-muted/30 p-7 text-center transition-colors motion-reduce:transition-none max-[520px]:p-5", isDraggingBackupFile ? "border-brand bg-brand/[0.07] ring-4 ring-brand/10 dark:border-brand-dark-text dark:bg-brand-dark-fill/10" : "border-border hover:border-brand/60 hover:bg-brand/[0.04] dark:border-slate-600 dark:hover:border-brand-dark-text/60 dark:hover:bg-brand-dark-fill/5")}
                  >
                    <span className={cn("flex size-[58px] shrink-0 items-center justify-center rounded-[18px] border border-border bg-background text-brand transition-transform transition-colors motion-reduce:transition-none dark:border-slate-700 dark:bg-slate-950 dark:text-brand-dark-text", hasSelectedBackupFile || isDraggingBackupFile ? "-translate-y-[3px] border-brand bg-brand text-white dark:border-brand-dark-fill dark:bg-brand-dark-fill dark:text-white" : "")}>
                      {hasSelectedBackupFile ? <FileArchive aria-hidden="true" className="size-[25px]" /> : <CloudUpload aria-hidden="true" className="size-[25px]" />}
                    </span>
                    {hasSelectedBackupFile ? (
                      <div className="min-w-0 max-w-full">
                        <p className="break-all font-mono text-sm font-medium text-foreground">{uploadedBackup ? `Uploaded: ${backupImportFile?.name || uploadedBackup.name}` : backupImportFile?.name || uploadedBackup?.name}</p>
                        <p className="mt-1 text-[13px] text-muted-foreground">{backupImportFile ? formatBackupSize({ sizeBytes: backupImportFile.size }) : formatBackupSize(uploadedBackup)}</p>
                      </div>
                    ) : (
                      <p className="text-[15px] text-muted-foreground">{isDraggingBackupFile ? "Drop backup file to select" : "Drop a backup file here or choose a file"}</p>
                    )}
                    <label htmlFor="system-backup-upload" className={cn("inline-flex h-10.5 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-background px-5 text-sm font-medium text-foreground transition-colors focus-within:outline-none focus-within:ring-2 focus-within:ring-brand focus-within:ring-offset-2 focus-within:ring-offset-background motion-reduce:transition-none", "hover:border-brand hover:text-brand dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-brand-dark-text dark:hover:text-brand-dark-text", uploadedBackup || uploadingBackupFile ? "cursor-not-allowed opacity-50" : "")}>
                      <input ref={backupUploadInputRef} id="system-backup-upload" type="file" accept=".zip,.json.gz.enc,.json.gz,application/zip,application/octet-stream,application/gzip,application/x-gzip" disabled={Boolean(uploadedBackup) || uploadingBackupFile} onChange={(event) => { handleBackupFileSelection(event.target.files?.[0]); event.target.value = ""; }} className="sr-only" />
                      <Upload aria-hidden="true" className="size-4" />
                      Choose backup file
                    </label>
                  </div>
                </div>
                <footer className="flex min-h-[70px] flex-wrap items-center gap-2.5 border-t border-border bg-muted/50 px-6 py-3.5 dark:border-slate-700 dark:bg-slate-800/50 max-[520px]:grid max-[520px]:grid-cols-2 max-[520px]:px-4">
                  <button type="button" onClick={handleSyncUploadedBackup} disabled={(!uploadedBackup && !backupImportFile) || restoringBackup || uploadingBackupFile} className="inline-flex h-10.5 items-center justify-center gap-2 rounded-xl bg-brand px-6 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 motion-reduce:transition-none dark:bg-brand-dark-fill dark:disabled:bg-slate-700 dark:disabled:text-slate-400 max-[520px]:w-full max-[520px]:px-3">
                    {uploadingBackupFile || restoringBackup ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <RotateCcw aria-hidden="true" className="size-4" />}
                    {uploadingBackupFile ? "Uploading..." : restoringBackup ? "Syncing..." : "Sync"}
                  </button>
                  <button type="button" onClick={handleRemoveBackupFile} disabled={(!backupImportFile && !uploadedBackup) || uploadingBackupFile || removingBackupFile || restoringBackup} className="inline-flex h-10.5 items-center justify-center gap-2 rounded-xl border border-border bg-background px-5 text-sm font-medium text-foreground transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 motion-reduce:transition-none dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-red-800 dark:hover:bg-red-950/40 dark:hover:text-red-300 dark:disabled:border-slate-700 dark:disabled:bg-slate-800 dark:disabled:text-slate-500 max-[520px]:w-full max-[520px]:px-2">
                    {removingBackupFile ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Trash2 aria-hidden="true" className="size-4" />}
                    {removingBackupFile ? "Removing..." : "Remove File"}
                  </button>
                </footer>
              </section>
            </div>

              <section className="space-y-3">
                <h3 className={`text-[17px] font-medium ${darkMode ? "text-slate-100" : "text-foreground"}`}>Backup History</h3>
                <div className={`overflow-hidden rounded-2xl border ${darkMode ? "border-slate-700 bg-[#0b1420]" : "border-border bg-background"}`}>
                  <div className="hidden overflow-x-auto md:block">
                    <table className="backup-history-table min-w-[760px] w-full border-collapse text-left">
                      <thead className="bg-muted/50">
                        <tr className="border-b border-border">
                          <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Backup Name</th>
                          <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Date</th>
                          <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Time</th>
                          <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Type</th>
                          <th className="px-4 py-3 text-right text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Size</th>
                          <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Status</th>
                          <th className="px-4 py-3 text-right text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedBackups.map((backup) => (
                          <tr key={backup.id} className="border-b border-border transition-colors last:border-b-0 hover:bg-muted/50 motion-reduce:transition-none">
                            <td className={`px-4 py-3 font-mono text-[13px] ${darkMode ? "text-slate-200" : "text-slate-900"}`}>{backup.name}</td>
                            <td className={`px-4 py-3 text-sm ${darkMode ? "text-slate-400" : "text-slate-600"}`}>{formatBackupDateShort(backup.date)}</td>
                            <td className={`px-4 py-3 text-sm tabular-nums ${darkMode ? "text-slate-400" : "text-slate-600"}`}>{formatBackupTime(backup.date)}</td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${backup.type === "Full System" ? darkMode ? "border-red-400/60 bg-red-950/70 text-red-200" : "border-brand/50 bg-brand/[0.08] text-brand" : darkMode ? "border-slate-700 bg-slate-800 text-slate-300" : "border-border bg-muted text-muted-foreground"}`}>{backup.type}</span>
                            </td>
                            <td className={`px-4 py-3 text-right text-sm tabular-nums ${darkMode ? "text-slate-200" : "text-slate-900"}`}>{formatBackupSize(backup)}</td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${darkMode ? "bg-green-950/50 text-green-300" : "bg-green-500/10 text-green-700"}`}>
                                <span className="size-1.5 rounded-full bg-green-500" />
                                {backup.status}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex justify-end gap-2">
                                <button type="button" onClick={() => handleDownloadBackup(backup)} disabled={downloadingBackupId !== null} title="Download the encrypted snapshot, uploaded files, and transactions Excel report" className={`inline-flex size-9 items-center justify-center rounded-[10px] transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none ${darkMode ? "bg-blue-950/70 text-blue-300 hover:bg-blue-700 hover:text-white" : "bg-blue-500/10 text-blue-700 hover:bg-blue-600 hover:text-white"}`} aria-label={`Download complete backup ${backup.name}`}>
                                  {downloadingBackupId === backup.id ? <Loader2 aria-hidden="true" className="size-5 animate-spin" /> : <Download aria-hidden="true" className="size-5" />}
                                </button>
                                <button type="button" onClick={() => handleRestoreBackup(backup.id)} className={`inline-flex size-9 items-center justify-center rounded-[10px] transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none ${darkMode ? "bg-amber-950/70 text-amber-300 hover:bg-amber-700 hover:text-white" : "bg-brand/[0.08] text-brand hover:bg-brand hover:text-white"}`} aria-label="Restore backup">
                                  <RotateCcw aria-hidden="true" className="size-5" />
                                </button>
                                <button type="button" onClick={() => handleDeleteBackup(backup.id)} className={`inline-flex size-9 items-center justify-center rounded-[10px] transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none ${darkMode ? "bg-red-950/70 text-red-300 hover:bg-red-700 hover:text-white" : "bg-red-500/10 text-red-700 hover:bg-red-600 hover:text-white"}`} aria-label="Delete backup">
                                  <Trash2 aria-hidden="true" className="size-5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}

                        {(backupState.backups || []).length === 0 && (
                          <tr>
                            <td colSpan="7" className={`px-4 py-6 text-center text-sm ${darkMode ? "text-slate-400" : "text-muted-foreground"}`}>
                              {loadingBackupSettings ? "Loading backup history..." : "No backup snapshots yet. Create your first backup to get started."}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="space-y-3 p-3 md:hidden">
                    {backupRecords.length > 0 ? paginatedBackups.map((backup) => (
                      <article key={backup.id} className={`rounded-xl border p-3 ${darkMode ? "border-slate-700 bg-slate-900" : "border-border bg-background"}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className={`break-all font-mono text-xs font-semibold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>{backup.name}</p>
                            <p className={`mt-1 text-xs ${darkMode ? "text-slate-400" : "text-slate-600"}`}>{formatBackupDateShort(backup.date)} · {formatBackupTime(backup.date)}</p>
                          </div>
                          <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-medium ${darkMode ? "bg-green-950/50 text-green-300" : "bg-green-500/10 text-green-700"}`}>{backup.status}</span>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${backup.type === "Full System" ? darkMode ? "border-red-400/60 bg-red-950/70 text-red-200" : "border-brand/50 bg-brand/[0.08] text-brand" : darkMode ? "border-slate-700 bg-slate-800 text-slate-300" : "border-border bg-muted text-muted-foreground"}`}>{backup.type}</span>
                            <span className={`text-xs tabular-nums ${darkMode ? "text-slate-300" : "text-slate-600"}`}>{formatBackupSize(backup)}</span>
                          </div>
                          <div className="flex gap-2">
                            <button type="button" onClick={() => handleDownloadBackup(backup)} disabled={downloadingBackupId !== null} title="Download encrypted backup with transactions Excel report" aria-label={`Download complete backup ${backup.name}`} className={`inline-flex size-9 items-center justify-center rounded-[10px] disabled:cursor-not-allowed disabled:opacity-50 ${darkMode ? "bg-blue-950/70 text-blue-300 hover:bg-blue-700 hover:text-white" : "bg-blue-500/10 text-blue-700 hover:bg-blue-600 hover:text-white"}`}>
                              {downloadingBackupId === backup.id ? <Loader2 aria-hidden="true" className="size-5 animate-spin" /> : <Download aria-hidden="true" className="size-5" />}
                            </button>
                            <button type="button" onClick={() => handleRestoreBackup(backup.id)} aria-label={`Restore backup ${backup.name}`} className={`inline-flex size-9 items-center justify-center rounded-[10px] ${darkMode ? "bg-amber-950/70 text-amber-300 hover:bg-amber-700 hover:text-white" : "bg-brand/[0.08] text-brand hover:bg-brand hover:text-white"}`}>
                              <RotateCcw aria-hidden="true" className="size-5" />
                            </button>
                            <button type="button" onClick={() => handleDeleteBackup(backup.id)} aria-label={`Delete backup ${backup.name}`} className={`inline-flex size-9 items-center justify-center rounded-[10px] ${darkMode ? "bg-red-950/70 text-red-300 hover:bg-red-700 hover:text-white" : "bg-red-500/10 text-red-700 hover:bg-red-600 hover:text-white"}`}>
                              <Trash2 aria-hidden="true" className="size-5" />
                            </button>
                          </div>
                        </div>
                      </article>
                    )) : (
                      <div className={`p-6 text-center text-sm ${darkMode ? "text-slate-400" : "text-muted-foreground"}`}>
                        {loadingBackupSettings ? "Loading backup history..." : "No backup snapshots yet. Create your first backup to get started."}
                      </div>
                    )}
                  </div>
                  {backupRecords.length > backupPageSize && (
                    <div className={`flex flex-col items-center justify-between gap-3 border-t px-3 py-3 sm:flex-row ${darkMode ? "border-slate-700 bg-[#0b1420]" : "border-border bg-muted/30"}`}>
                      <span className={`text-xs ${darkMode ? "text-slate-400" : "text-muted-foreground"}`}>
                        Showing {backupRangeStart}–{backupRangeEnd} of {backupRecords.length} backups
                      </span>
                      <div className="flex flex-wrap items-center justify-center gap-2" role="navigation" aria-label="Backup history pagination">
                        <button
                          type="button"
                          onClick={() => setBackupPage((page) => Math.max(page - 1, 1))}
                          disabled={activeBackupPage === 1}
                          className={`rounded-lg border px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border-border bg-background text-slate-700 hover:bg-muted"}`}
                        >
                          Previous
                        </button>
                        {Array.from({ length: Math.min(5, totalBackupPages) }, (_, index) => {
                          const firstPage = Math.max(1, Math.min(activeBackupPage - 2, totalBackupPages - 4));
                          const pageNumber = firstPage + index;
                          return (
                            <button
                              key={pageNumber}
                              type="button"
                              onClick={() => setBackupPage(pageNumber)}
                              aria-current={pageNumber === activeBackupPage ? "page" : undefined}
                              className={`size-9 rounded-lg text-xs font-semibold ${pageNumber === activeBackupPage ? "bg-red-700 text-white" : darkMode ? "border border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border border-border bg-background text-slate-700 hover:bg-muted"}`}
                            >
                              {pageNumber}
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          onClick={() => setBackupPage((page) => Math.min(page + 1, totalBackupPages))}
                          disabled={activeBackupPage === totalBackupPages}
                          className={`rounded-lg border px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border-border bg-background text-slate-700 hover:bg-muted"}`}
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}
    </>
    );
  };

  const togglePermissionDraft = (key, checked) => {
    setPermissionDraft((current) => {
      const nextPermissions = key === "view_only_access" && checked
        ? Object.fromEntries(PERMISSIONS.map(({ key: permissionKey }) => [permissionKey, permissionKey === "view_only_access"]))
        : {
            ...current,
            ...(key !== "view_only_access" && checked ? { view_only_access: false } : {}),
            [key]: checked,
          };
      return normalizePermissions(nextPermissions);
    });
  };

  const savePermissionMatrix = async () => {
    if (!permissionAccount || !permissionDraft) return;
    const saved = await updateUser(permissionAccount, permissionDraft);
    if (saved) {
      toast.success("Customer permissions saved.");
      setPermissionAccount(null);
      setPermissionDraft(null);
    }
  };

  const upgradeCustomerToStaff = async () => {
    if (!permissionAccount) return;
    const accountId = permissionAccount._id || permissionAccount.id;
    setSavingId(accountId);
    try {
      const response = await updateAdminUserAccess(accountId, { role: "skilled_worker" });
      setUsers((current) => current.map((item) => (item._id || item.id) === accountId ? { ...response.user, is_active: true } : item));
      recordActivity(user, `Upgraded ${permissionAccount.first_name} ${permissionAccount.last_name} to staff.`, "Settings");
      toast.success("Customer upgraded to staff.");
      setPermissionAccount(null);
      setPermissionDraft(null);
    } catch (error) {
      toast.error(error?.data?.message || error?.message || "Unable to upgrade customer to staff.");
    } finally {
      setSavingId(null);
    }
  };

  const openPermissionMatrix = (account) => {
    setPermissionAccount(account);
    setPermissionDraft(getPermissions(account));
  };

  const openStaffAccess = (account) => {
    setStaffAccount(account);
    setStaffDraft(normalizeStaffAccess(account.staff_access));
    setExpandedStaffModule(null);
    setCustomSubroleInput("");
  };

  const updateStaffModule = (moduleKey, update) => {
    setStaffDraft((current) => ({
      ...current,
      modules: {
        ...current.modules,
        [moduleKey]: { ...current.modules[moduleKey], ...update },
      },
    }));
  };

  const toggleStaffAction = (moduleKey, actionKey) => {
    setStaffDraft((current) => ({
      ...current,
      modules: {
        ...current.modules,
        [moduleKey]: {
          ...current.modules[moduleKey],
          actions: {
            ...current.modules[moduleKey].actions,
            [actionKey]: !current.modules[moduleKey].actions[actionKey],
          },
        },
      },
    }));
  };

  const saveStaffAccess = async () => {
    if (!isAdmin || !staffAccount || !staffDraft) return;
    const accountId = staffAccount._id || staffAccount.id;
    setSavingId(accountId);
    try {
      const response = await updateAdminUserAccess(accountId, { staff_access: staffDraft });
      setUsers((current) => current.map((account) => (account._id || account.id) === accountId ? { ...response.user, is_active: true } : account));
      recordActivity(user, `Updated staff access for ${staffAccount.first_name} ${staffAccount.last_name}.`, "Settings");
      toast.success("Staff access settings saved.");
      setStaffAccount(null);
      setStaffDraft(null);
    } catch (error) {
      toast.error(error?.data?.message || error?.message || "Unable to save staff access settings.");
    } finally {
      setSavingId(null);
    }
  };

  const addCustomSubrole = () => {
    const subrole = customSubroleInput.trim().replace(/\s+/g, " ").slice(0, 40);
    if (!subrole || !staffDraft) return;
    const existingSubrole = [...STAFF_SUBROLES, ...staffDraft.custom_subroles]
      .find((item) => item.toLowerCase() === subrole.toLowerCase());
    if (existingSubrole) {
      setStaffDraft((current) => ({ ...current, subrole: existingSubrole }));
      setCustomSubroleInput("");
      toast.success(`Subrole selected: ${existingSubrole}. Save Settings to apply it.`);
      return;
    }

    setStaffDraft((current) => ({
      ...current,
      subrole,
      custom_subroles: [...new Set([...current.custom_subroles, subrole])],
    }));
    setCustomSubroleInput("");
    toast.success(`Subrole added: ${subrole}. Save Settings to apply it.`);
  };

  const convertStaffToCustomer = async () => {
    if ((!isAdmin && !canManageAccess) || !staffAccount || isOwnStaffAccount) return;
    const accountId = staffAccount._id || staffAccount.id;
    setSavingId(accountId);
    try {
      const response = await updateAdminUserAccess(accountId, { role: "customer" });
      setUsers((current) => current.map((account) => (account._id || account.id) === accountId ? { ...response.user, is_active: true } : account));
      recordActivity(user, `Converted ${staffAccount.first_name} ${staffAccount.last_name} to customer.`, "Settings");
      toast.success("Staff account converted to customer.");
      setStaffAccount(null);
      setStaffDraft(null);
    } catch (error) {
      toast.error(error?.data?.message || error?.message || "Unable to convert staff account.");
    } finally {
      setSavingId(null);
    }
  };

  const saveGlobalPermissions = async () => {
    setSavingGlobal(true);
    try {
      const normalizedPermissions = normalizePermissions(globalPermissions);
      await updateSystemSettings({ global_permissions: normalizedPermissions });
      recordActivity(user, "Saved the global customer permissions profile.", "Settings");
      toast.success("Global profile saved. Individual account permissions were not changed.");
    } catch (error) {
      toast.error(error?.data?.message || error?.message || "Unable to save the global permissions profile.");
    } finally {
      setSavingGlobal(false);
    }
  };

  const roleLabel = (role) => {
    if (role === "customer") return "Client";
    if (role === "helper") return "Helper";
    if (role === "staff" || role === "skilled_worker") return "Staff";
    if (role === "admin") return "Super Admin";
    return "Client";
  };

  const getRoleBadgeClasses = (role) => {
    if (role === "customer") return darkMode ? "bg-sky-950/70 text-sky-200" : "bg-sky-100 text-sky-700";
    if (role === "helper") return darkMode ? "bg-violet-950/70 text-violet-200" : "bg-violet-100 text-violet-700";
    if (role === "admin") return darkMode ? "bg-emerald-950/70 text-emerald-200" : "bg-emerald-100 text-emerald-700";
    return darkMode ? "bg-violet-950/70 text-violet-200" : "bg-violet-100 text-violet-700";
  };

  const getModuleAccessLabel = (permissions, isAdmin = false) => {
    if (isAdmin) return "Full Module Access";
    if (permissions.view_only_access) return "View only";
    if (permissions.can_request_orders || permissions.can_estimate_pricing || permissions.can_track_products) return "Customer Portal Matrix";
    return "No access";
  };

  const toggleMaintenanceMode = async () => {
    const nextMode = !maintenanceMode;
    setMaintenanceMode(nextMode);
    setSavingMaintenance(true);
    try {
      const response = await updateSystemSettings({ maintenance_mode: nextMode });
      setMaintenanceMode(response.maintenance_mode === true);
      recordActivity(user, `${nextMode ? "Enabled" : "Disabled"} system maintenance mode.`, "Settings");
      toast.success(nextMode ? "System maintenance mode enabled." : "System maintenance mode disabled.");
    } catch (error) {
      setMaintenanceMode(!nextMode);
      toast.error(error?.data?.message || error?.message || "Unable to update maintenance mode.");
    } finally {
      setSavingMaintenance(false);
    }
  };

  const formatBackupDateShort = (value) => new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const formatBackupTime = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "-" : date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const formatBackupSize = (backup) => {
    const sizeBytes = Number(backup?.sizeBytes);
    if (Number.isFinite(sizeBytes) && sizeBytes > 0) {
      if (sizeBytes < 1024) return `${sizeBytes} B`;
      if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(sizeBytes < 100 * 1024 ? 1 : 0)} KB`;
      return `${(sizeBytes / (1024 * 1024)).toFixed(sizeBytes < 10 * 1024 * 1024 ? 2 : 1)} MB`;
    }

    const sizeInMB = Number(backup?.size);
    if (!Number.isFinite(sizeInMB) || sizeInMB <= 0) return "Under 0.1 MB";
    return `${sizeInMB.toFixed(sizeInMB < 10 ? 2 : 1)} MB`;
  };

  const backupMetrics = useMemo(() => {
    const backups = backupState.backups || [];
    const successfulBackups = backups.filter((backup) => backup.status?.toLowerCase() === "success").length;
    return {
      status: loadingBackupSettings ? "Loading..." : backups.length ? backupState.status || "Success" : "No backups yet",
      lastBackupAt: backupState.lastBackupAt || backups[0]?.date,
      totalBackups: backups.length,
      successRate: backups.length ? Math.round((successfulBackups / backups.length) * 100) : 0,
    };
  }, [backupState, loadingBackupSettings]);

  const backupRecords = backupState.backups || [];
  const totalBackupPages = Math.max(1, Math.ceil(backupRecords.length / backupPageSize));
  const activeBackupPage = Math.min(backupPage, totalBackupPages);
  const paginatedBackups = backupRecords.slice(
    (activeBackupPage - 1) * backupPageSize,
    activeBackupPage * backupPageSize,
  );
  const backupRangeStart = backupRecords.length === 0 ? 0 : (activeBackupPage - 1) * backupPageSize + 1;
  const backupRangeEnd = Math.min(activeBackupPage * backupPageSize, backupRecords.length);

  const persistBackupState = async (nextState) => {
    const payload = {
      backup_schedule: nextState.selectedSchedule || "weekly",
      backup_status: nextState.status || "Success",
      last_backup_at: nextState.lastBackupAt || null,
      backup_history: Array.isArray(nextState.backups) ? nextState.backups : [],
    };

    const response = await updateSystemSettings(payload);
    if (response?.backup_history) {
      setBackupState({
        selectedSchedule: response.backup_schedule || nextState.selectedSchedule || "weekly",
        status: response.backup_status || nextState.status || "Success",
        lastBackupAt: response.last_backup_at || nextState.lastBackupAt || null,
        backups: Array.isArray(response.backup_history) ? response.backup_history : nextState.backups || [],
      });
    }
    return response;
  };

  const handleScheduleChange = async (scheduleId) => {
    const nextState = { ...backupState, selectedSchedule: scheduleId };
    setBackupState(nextState);
    try {
      await persistBackupState(nextState);
      toast.success(`Backup schedule set to ${backupOptions.find((option) => option.id === scheduleId)?.label || "custom"}.`);
    } catch (error) {
      toast.error(error?.data?.message || error?.message || "Unable to update backup schedule.");
      setBackupState(backupState);
    }
  };

  const handleBackupFileSelection = (file) => {
    if (!file) return;
    const filename = file.name.toLowerCase();
    if (!filename.endsWith(".zip") && !filename.endsWith(".json.gz") && !filename.endsWith(".json.gz.enc")) {
      toast.error("Choose an encrypted .zip or a legacy .json.gz system backup file.");
      return;
    }
    if (file.size > 512 * 1024 * 1024) {
      toast.error("Backup files must be 512 MB or smaller.");
      return;
    }
    setBackupImportFile(file);
  };

  const handleBackupNow = async () => {
    if (creatingBackup || loadingBackupSettings) return;
    const backupType = backupOptions.find((option) => option.id === backupState.selectedSchedule)?.label;
    if (!backupType) return;

    setCreatingBackup(true);
    try {
      const response = await createSystemBackup(backupType);
      setBackupState((current) => ({
        ...current,
        selectedSchedule: response.backup_schedule || current.selectedSchedule,
        status: response.backup_status || "Success",
        lastBackupAt: response.last_backup_at || response.backup?.date || null,
        backups: Array.isArray(response.backup_history)
          ? response.backup_history
          : [response.backup, ...(current.backups || [])].filter(Boolean),
      }));
      recordActivity(user, `Created an immediate ${backupType.toLowerCase()} backup.`, "Settings");
      toast.success(`${backupType} backup created successfully.`);
    } catch (error) {
      toast.error(error?.data?.message || error?.message || "Unable to create backup.");
    } finally {
      setCreatingBackup(false);
    }
  };

  const handleSyncUploadedBackup = async () => {
    if (restoringBackup || uploadingBackupFile) return;
    let backup = uploadedBackup;
    if (!backup) {
      if (!backupImportFile) return;
      setUploadingBackupFile(true);
      try {
        const response = await uploadSystemBackup(backupImportFile);
        backup = response.backup;
        setUploadedBackup(backup);
        setBackupState((current) => ({
          ...current,
          selectedSchedule: response.backup_schedule || current.selectedSchedule,
          status: response.backup_status || "Success",
          lastBackupAt: response.last_backup_at || backup?.date || null,
          backups: Array.isArray(response.backup_history)
            ? response.backup_history
            : [backup, ...(current.backups || [])].filter(Boolean),
        }));
        recordActivity(user, `Uploaded system backup ${backup?.name || backupImportFile.name}.`, "Settings");
      } catch (error) {
        toast.error(error?.data?.message || error?.message || "Unable to upload backup file.");
        return;
      } finally {
        setUploadingBackupFile(false);
      }
    }
    if (!backup) return;

    restoreDialogTriggerRef.current = document.activeElement;
    setRestoreConfirmation(backup);
  };

  const handleRemoveBackupFile = async () => {
    if (removingBackupFile || uploadingBackupFile || restoringBackup) return;
    if (uploadedBackup) {
      setRemovingBackupFile(true);
      try {
        const response = await deleteSystemBackup(uploadedBackup.id);
        setBackupState((current) => ({
          ...current,
          selectedSchedule: response.backup_schedule || current.selectedSchedule,
          status: response.backup_status || "Success",
          lastBackupAt: response.last_backup_at || null,
          backups: Array.isArray(response.backup_history) ? response.backup_history : current.backups,
        }));
      } catch (error) {
        toast.error(error?.data?.message || error?.message || "Unable to remove uploaded backup.");
        return;
      } finally {
        setRemovingBackupFile(false);
      }
    }

    setUploadedBackup(null);
    setBackupImportFile(null);
    if (backupUploadInputRef.current) backupUploadInputRef.current.value = "";
    toast.success("Backup file removed.");
  };

  const handleDownloadBackup = async (backup) => {
    if (downloadingBackupId !== null) return;
    setDownloadingBackupId(backup.id);
    let downloadUrl;
    let link;
    try {
      const { blob, filename } = await downloadSystemBackup(backup.id);
      downloadUrl = URL.createObjectURL(blob);
      link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      toast.success(`Downloading ${backup.name}.`);
    } catch (error) {
      toast.error(error?.data?.message || error?.message || "Unable to download backup.");
    } finally {
      link?.remove();
      if (downloadUrl) window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      setDownloadingBackupId(null);
    }
  };

  const handleRestoreBackup = async (backupId) => {
    const backup = (backupState.backups || []).find((item) => item.id === backupId);
    if (!backup) return;
    restoreDialogTriggerRef.current = document.activeElement;
    setRestoreConfirmation(backup);
  };

  const confirmRestoreBackup = async () => {
    if (!restoreConfirmation || restoringBackup) return;
    const backup = restoreConfirmation;
    setRestoringBackup(true);
    try {
      const response = await restoreSystemBackup(backup.id);
      setBackupState({
        selectedSchedule: response.backup_schedule || backupState.selectedSchedule,
        status: response.backup_status || "Restored",
        lastBackupAt: response.last_backup_at || backup.date,
        backups: Array.isArray(response.backup_history) ? response.backup_history : backupState.backups,
      });
      recordActivity(user, `Restored backup ${backup.name}.`, "Settings");
      toast.success(`${backup.name} restored. All users have been signed out.`);
      logout();
    } catch (error) {
      toast.error(error?.data?.message || error?.message || "Unable to restore backup.");
    } finally {
      setRestoringBackup(false);
      setRestoreConfirmation(null);
    }
  };

  const handleDeleteBackup = async (backupId) => {
    const backup = (backupState.backups || []).find((item) => item.id === backupId);
    if (!backup) return;
    deleteDialogTriggerRef.current = document.activeElement;
    setDeleteConfirmation(backup);
  };

  const confirmDeleteBackup = async () => {
    if (!deleteConfirmation || deletingBackup) return;
    const backup = deleteConfirmation;
    setDeletingBackup(true);
    try {
      const response = await deleteSystemBackup(backup.id);
      setBackupState({
        selectedSchedule: response.backup_schedule || backupState.selectedSchedule,
        status: response.backup_status || "Success",
        lastBackupAt: response.last_backup_at || null,
        backups: Array.isArray(response.backup_history) ? response.backup_history : [],
      });
      toast.success("Backup deleted.");
    } catch (error) {
      toast.error(error?.data?.message || error?.message || "Unable to delete backup.");
    } finally {
      setDeletingBackup(false);
      setDeleteConfirmation(null);
    }
  };

  return (
    <div className={`admin-settings settings-premium flex h-dvh min-h-dvh overflow-hidden ${darkMode ? "dark bg-slate-950 text-slate-100" : "bg-[#eef1f3] text-slate-900"}`}>
      <Toaster position="bottom-right" />
      <Sidebar isOpen={isSidebarOpen} onToggle={() => setIsSidebarOpen((open) => !open)} />
      <div className="flex min-h-0 flex-1 flex-col">
        <Navbar />
        <main className="min-w-0 flex-1 min-h-0 overflow-x-hidden overflow-y-auto overscroll-y-contain p-4 sm:p-6 lg:p-8">
          <AdminPageHeader
            title="System Settings"
            description="Manage customer access, permissions, and account availability."
            stats={[
              { label: "Users", value: counts.all },
              { label: "Active", value: counts.active, color: "text-emerald-300" },
              { label: "Staff", value: counts.skilled_worker, color: "text-red-300" },
            ]}
          />

          <section className="mt-6 min-w-0 max-w-full overflow-hidden">
            <div role="tablist" aria-label="Settings tabs" className="inline-flex max-w-full gap-1 overflow-x-auto rounded-2xl border border-border bg-muted/50 p-1.5 dark:border-slate-700 dark:bg-slate-900">
              {settingsTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={activeSettingsTab === tab.key}
                  onClick={() => setActiveSettingsTab(tab.key)}
                  className={cn("relative inline-flex h-10 shrink-0 items-center justify-center whitespace-nowrap rounded-[11px] border border-transparent px-5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none", activeSettingsTab === tab.key ? "text-brand dark:text-brand-dark-text" : "text-secondary-foreground hover:bg-background/80 hover:text-foreground dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100")}
                >
                  {activeSettingsTab === tab.key && <motion.span layoutId="settings-tab-indicator" aria-hidden="true" initial={false} transition={{ duration: prefersReducedMotion ? 0 : 0.18 }} className="absolute inset-0 rounded-[11px] border border-brand/50 bg-brand/[0.07] dark:border-brand-dark-text/50 dark:bg-brand-dark-fill/10" />}
                  <span className="relative z-10">{tab.label}</span>
                </button>
              ))}
            </div>
          </section>

          {activeSettingsTab === "user-management" && (
            <>
              {isAdmin && <section className={`mt-7 overflow-hidden rounded-[22px] border shadow-[0_18px_45px_-28px_rgba(15,23,42,0.65)] ${darkMode ? "border-slate-700 bg-slate-900" : "border-red-100 bg-white"}`}>
            <div className={`relative flex flex-col gap-4 border-b px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6 ${darkMode ? "border-slate-700 bg-gradient-to-r from-slate-900 via-slate-900 to-red-950/40" : "border-red-100 bg-gradient-to-r from-red-50 via-white to-orange-50"}`}>
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-red-900 text-white shadow-lg shadow-red-950/20"><Settings2 size={17} /></div>
                <div><p className={`text-[10px] font-black uppercase tracking-[0.2em] ${darkMode ? "text-red-300" : "text-red-700"}`}>Access control</p><h2 className={`mt-1 text-base font-black ${darkMode ? "text-white" : "text-red-950"}`}>Global Customer Permissions</h2><p className={`mt-1 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Saved globally without changing individual account matrices.</p></div>
              </div>
              <button type="button" onClick={() => setGlobalOpen((open) => !open)} className={`inline-flex items-center gap-2 self-end rounded-full border px-4 py-2 text-xs font-bold transition sm:self-auto ${darkMode ? "border-red-900/70 bg-red-950/50 text-red-200 hover:bg-red-900/60" : "border-red-200 bg-red-100 text-red-900 hover:bg-red-200"}`}>{globalOpen ? "Collapse" : "Manage All"}<ChevronDown size={14} className={`transition-transform ${globalOpen ? "rotate-180" : ""}`} /></button>
            </div>
            {globalOpen && <>
              <div className={`flex items-center justify-between border-b px-5 py-4 ${darkMode ? "border-slate-800" : "border-slate-100"}`}><div><p className={`text-[10px] font-black uppercase tracking-[0.18em] ${darkMode ? "text-slate-500" : "text-slate-400"}`}>Global customer access profile</p><p className={`mt-1 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Choose the global profile; each account's matrix remains independent.</p></div><span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-wide ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600"}`}>{Object.values(globalPermissions).filter(Boolean).length} enabled</span></div>
              <div className="grid gap-3 p-4 md:grid-cols-2">{PERMISSIONS.map((permission, index) => <PermissionSwitch key={permission.key} permission={permission} index={index} checked={globalPermissions[permission.key]} disabled={globalPermissions.view_only_access && permission.key !== "view_only_access"} onChange={(checked) => updateGlobalPermission(permission.key, checked)} darkMode={darkMode} />)}</div>
              <div className={`mx-4 mb-4 flex items-center justify-between gap-4 rounded-2xl border px-4 py-4 ${maintenanceMode ? (darkMode ? "border-amber-700/70 bg-amber-950/40" : "border-amber-300 bg-amber-50") : (darkMode ? "border-slate-700 bg-slate-800/70" : "border-slate-200 bg-slate-50")}`}>
                <div className="flex items-center gap-3"><span className={`h-2.5 w-2.5 rounded-full ${maintenanceMode ? "bg-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.8)]" : "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.55)]"}`} /><div><p className={`text-xs font-black ${maintenanceMode ? (darkMode ? "text-amber-200" : "text-amber-900") : (darkMode ? "text-slate-200" : "text-slate-700")}`}>System Maintenance Mode</p><p className={`text-[10px] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{maintenanceMode ? "Customer activity is temporarily restricted." : "Platform is operating normally."}</p></div></div>
                <button type="button" role="switch" aria-checked={maintenanceMode} disabled={savingMaintenance} onClick={toggleMaintenanceMode} className={`relative h-6 w-11 shrink-0 rounded-full transition ${maintenanceMode ? "bg-amber-600" : "bg-slate-300"}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition ${maintenanceMode ? "left-[22px]" : "left-1"}`} /></button>
              </div>
              <div className={`flex flex-col gap-3 border-t border-dashed px-4 py-4 sm:flex-row sm:items-center sm:justify-between ${darkMode ? "border-slate-700" : "border-slate-200"}`}><p className={`text-xs ${darkMode ? "text-amber-300" : "text-amber-600"}`}>Account-level Customer Matrix Permissions remain unchanged.</p><button type="button" onClick={saveGlobalPermissions} disabled={savingGlobal} className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-950 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-red-950/20 transition hover:bg-red-900 disabled:cursor-not-allowed disabled:opacity-60">{savingGlobal && <Loader2 size={14} className="animate-spin" />}{savingGlobal ? "Saving global profile..." : "Save Global Profile"}</button></div>
            </>}
          </section>}

          <section className={`mt-4 rounded-2xl border p-2 shadow-sm ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
            <div className="lg:hidden">
              <select
                aria-label="User category"
                value={activeTab}
                onChange={(event) => setActiveTab(event.target.value)}
                className={`w-full rounded-xl border px-3 py-2.5 text-sm font-semibold outline-none focus:ring-2 focus:ring-red-100 ${darkMode ? "border-slate-700 bg-slate-900 text-slate-100 focus:border-red-500" : "border-slate-200 bg-white text-slate-700 focus:border-red-500"}`}
              >
                {userCategoryTabs.map((tab) => (
                  <option key={tab.key} value={tab.key}>{tab.label} ({tab.count})</option>
                ))}
              </select>
            </div>
            <div role="tablist" aria-label="Filter users by category" className="hidden min-w-0 flex-wrap gap-1.5 lg:flex">
              {userCategoryTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 ${activeTab === tab.key ? (darkMode ? "border-red-700 bg-red-950/60 text-red-100 shadow-sm shadow-black/10" : "border-red-200 bg-red-50 text-red-950 shadow-sm") : (darkMode ? "border-transparent text-slate-400 hover:border-slate-700 hover:bg-slate-800 hover:text-slate-100" : "border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900")}`}
                >
                  {tab.label}
                  <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] tabular-nums ${activeTab === tab.key ? (darkMode ? "bg-red-800 text-red-50" : "bg-red-200 text-red-900") : (darkMode ? "bg-slate-700 text-slate-300" : "bg-slate-200 text-slate-700")}`}>
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-sm">
              <Search size={16} className="absolute left-3 top-3 text-slate-400" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name or email..." className={`w-full rounded-xl border py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-100 ${darkMode ? "border-slate-700 bg-slate-900 text-slate-100 placeholder:text-slate-500" : "border-slate-200 bg-white"}`} />
            </div>
            <span className={`text-xs font-semibold ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{loading ? "Loading users..." : `${displayUsers.length} users found`}</span>
          </div>

          <section className={`settings-user-access mt-4 overflow-hidden rounded-[22px] border shadow-[0_18px_45px_-28px_rgba(15,23,42,0.55)] ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
            {loading ? <div className={`flex items-center justify-center gap-2 p-16 text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}><Loader2 size={18} className="animate-spin" /> Loading user access...</div> : displayUsers.length === 0 ? <div className="p-16 text-center"><ShieldCheck size={30} className="mx-auto text-slate-300" /><p className={`mt-3 text-sm font-semibold ${darkMode ? "text-slate-200" : "text-slate-600"}`}>No users found</p><p className="mt-1 text-xs text-slate-400">Try another search or permission group.</p></div> : <div className="overflow-x-auto"><table className="min-w-[1180px] w-full border-collapse text-left"><thead className={darkMode ? "bg-slate-800/80" : "bg-slate-50"}><tr className={`border-b ${darkMode ? "border-slate-700" : "border-slate-200"}`}><th className={`sticky left-0 z-10 w-[280px] px-5 py-4 text-[10px] font-black uppercase tracking-[0.16em] ${darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-50 text-slate-500"}`}>User</th><th className={`w-[200px] px-3 py-4 text-[10px] font-black uppercase tracking-[0.16em] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Role</th><th className={`w-[240px] px-3 py-4 text-[10px] font-black uppercase tracking-[0.16em] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Module Access</th><th className={`w-[190px] px-3 py-4 text-[10px] font-black uppercase tracking-[0.16em] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Actions</th></tr></thead><tbody className={`divide-y ${darkMode ? "divide-slate-800" : "divide-slate-100"}`}>{displayUsers.map((account) => { const accountId = account._id || account.id; const permissions = getPermissions(account); const accountActive = account.is_active !== false; const accountIsAdmin = account.role === "admin" || account.role === "super_admin"; const isStaff = account.role === "skilled_worker"; const staffAccess = isStaff ? normalizeStaffAccess(account.staff_access) : null; const effectivePermissions = accountIsAdmin ? Object.fromEntries(PERMISSIONS.map(({ key }) => [key, true])) : permissions; const enabledStaffModules = isStaff ? STAFF_MODULES.filter(({ key }) => staffAccess.modules[key].enabled).length : 0; const moduleCount = isStaff || accountIsAdmin ? STAFF_MODULES.length : 6; const enabledModuleCount = accountIsAdmin ? moduleCount : isStaff ? enabledStaffModules : Math.min(5, Object.values(effectivePermissions).filter(Boolean).length); const moduleAccessLabel = accountIsAdmin ? "Full Module Access" : isStaff ? `${enabledStaffModules} of ${STAFF_MODULES.length} staff modules` : getModuleAccessLabel(effectivePermissions); const actionClasses = accountIsAdmin ? (darkMode ? "border-emerald-800 bg-emerald-950/70 text-emerald-200" : "border-emerald-200 bg-emerald-50 text-emerald-700") : (darkMode ? "border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"); const avatarLetters = `${(account.first_name || account.email || "U").charAt(0)}${(account.last_name || account.email || "U").charAt(0)}`.toUpperCase(); const name = `${account.first_name || ""} ${account.last_name || ""}`.trim() || "User"; return <tr key={accountId} className={`transition ${darkMode ? "hover:bg-slate-800/50" : "hover:bg-slate-50"}`}><td className={`sticky left-0 z-10 px-5 py-4 ${darkMode ? "bg-slate-900" : "bg-white"}`}><div className="flex min-w-[245px] items-center gap-3"><span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-red-700 to-amber-600 text-[10px] font-black text-white shadow-sm ${darkMode ? "ring-1 ring-white/10" : ""}`}>{avatarLetters}</span><div className="min-w-0"><div className="truncate text-[15px] font-semibold text-slate-900 dark:text-slate-200">{name}</div><div className="truncate text-xs text-slate-500">{account.email}</div></div></div></td><td className="px-3 py-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] ${getRoleBadgeClasses(account.role)}`}>{accountActive ? roleLabel(account.role) : "Disabled"}</span></td><td className="px-3 py-4"><div className="flex items-center gap-2"><span className="inline-flex items-center gap-1">{Array.from({ length: moduleCount }).map((_, dotIndex) => (<span key={dotIndex} className={`h-2.5 w-2.5 rounded-full ${dotIndex < enabledModuleCount ? "bg-red-700" : darkMode ? "bg-slate-600" : "bg-slate-300"}`} />))}</span><span className={`text-xs ${darkMode ? "text-slate-300" : "text-slate-600"}`}>{moduleAccessLabel}</span></div></td><td className="px-3 py-4"><div className="flex items-center justify-end">{accountIsAdmin ? <span className={`inline-flex min-w-[120px] items-center justify-center rounded-xl border px-3 py-2 text-xs font-semibold ${actionClasses}`}>✓ Full Access</span> : isStaff ? <button type="button" onClick={() => openStaffAccess(account)} className={`inline-flex min-w-[120px] items-center justify-center rounded-xl border px-3 py-2 text-xs font-semibold transition ${actionClasses}`} aria-label={`Manage access for ${name}`}>Manage Access</button> : canManageAccess ? <button type="button" onClick={() => openPermissionMatrix(account)} className={`inline-flex min-w-[120px] items-center justify-center rounded-xl border px-3 py-2 text-xs font-semibold transition ${actionClasses}`} aria-label={`View permissions for ${name}`}>View Permissions</button> : <span className="px-3 py-2 text-xs text-slate-400">Read Only</span>}</div></td></tr>; })}</tbody></table></div>}
          </section>
          {!loading && displayUsers.length > 0 && (
            <div className="mt-3 space-y-3 md:hidden">
              {displayUsers.map((account) => {
                const accountIsAdmin = account.role === "admin" || account.role === "super_admin";
                const isStaff = account.role === "skilled_worker";
                const permissions = getPermissions(account);
                const staffAccess = isStaff ? normalizeStaffAccess(account.staff_access) : null;
                const enabledStaffModules = isStaff ? STAFF_MODULES.filter(({ key }) => staffAccess.modules[key].enabled).length : 0;
                const moduleAccessLabel = accountIsAdmin
                  ? "Full Module Access"
                  : isStaff
                    ? `${enabledStaffModules} of ${STAFF_MODULES.length} staff modules`
                    : getModuleAccessLabel(permissions);
                const accountActive = account.is_active !== false;
                const name = `${account.first_name || ""} ${account.last_name || ""}`.trim() || "User";
                const actionClasses = accountIsAdmin
                  ? (darkMode ? "border-emerald-800 bg-emerald-950/70 text-emerald-200" : "border-emerald-200 bg-emerald-50 text-emerald-700")
                  : (darkMode ? "border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100");

                return (
                  <article key={account._id || account.id} className={`rounded-2xl border p-4 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-red-700 to-amber-600 text-xs font-black text-white">
                          {`${(account.first_name || account.email || "U").charAt(0)}${(account.last_name || account.email || "U").charAt(0)}`.toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <p className={`truncate text-sm font-semibold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>{name}</p>
                          <p className="break-all text-xs text-slate-500">{account.email}</p>
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${getRoleBadgeClasses(account.role)}`}>
                        {accountActive ? roleLabel(account.role) : "Disabled"}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
                      <span className="flex shrink-0 items-center gap-1" aria-label={moduleAccessLabel}>
                        {Array.from({ length: isStaff || accountIsAdmin ? STAFF_MODULES.length : 6 }).map((_, dotIndex) => (
                          <span key={dotIndex} className={`size-2 rounded-full ${dotIndex < (accountIsAdmin ? STAFF_MODULES.length : isStaff ? enabledStaffModules : Math.min(5, Object.values(permissions).filter(Boolean).length)) ? "bg-red-700" : darkMode ? "bg-slate-600" : "bg-slate-300"}`} />
                        ))}
                      </span>
                      <span className={`min-w-0 text-xs ${darkMode ? "text-slate-300" : "text-slate-600"}`}>{moduleAccessLabel}</span>
                    </div>
                    <div className="mt-3 flex justify-end">
                      {accountIsAdmin ? (
                        <span className={`inline-flex items-center justify-center rounded-xl border px-3 py-2 text-xs font-semibold ${actionClasses}`}>Full Access</span>
                      ) : isStaff ? (
                        <button type="button" onClick={() => openStaffAccess(account)} className={`inline-flex items-center justify-center rounded-xl border px-3 py-2 text-xs font-semibold transition ${actionClasses}`} aria-label={`Manage access for ${name}`}>Manage Access</button>
                      ) : canManageAccess ? (
                        <button type="button" onClick={() => openPermissionMatrix(account)} className={`inline-flex items-center justify-center rounded-xl border px-3 py-2 text-xs font-semibold transition ${actionClasses}`} aria-label={`View permissions for ${name}`}>View Permissions</button>
                      ) : (
                        <span className="px-3 py-2 text-xs text-slate-400">Read Only</span>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
            </>
          )}

          {renderBackupRecovery(backupMetrics)}

          {permissionAccount && permissionDraft && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) { setPermissionAccount(null); setPermissionDraft(null); } }}>
            <section role="dialog" aria-modal="true" aria-labelledby="customer-matrix-title" className={`w-full max-w-[620px] overflow-hidden rounded-xl border shadow-2xl ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
              <header className={`flex items-center justify-between border-b px-6 py-5 ${darkMode ? "border-slate-800" : "border-slate-100"}`}>
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-black text-sky-700">{`${(permissionAccount.first_name || "C").charAt(0)}${(permissionAccount.last_name || "T").charAt(0)}`.toUpperCase()}</span>
                  <div className="min-w-0"><h2 id="customer-matrix-title" className={`truncate text-base font-bold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>Customer Matrix Permissions</h2><p className={`mt-1 truncate font-mono text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{`${permissionAccount.first_name || "Customer"} ${permissionAccount.last_name || ""}`.trim()} · Client Profile</p></div>
                </div>
                <button type="button" onClick={() => { setPermissionAccount(null); setPermissionDraft(null); }} aria-label="Close permissions" className={`rounded-full p-2 transition ${darkMode ? "text-slate-400 hover:bg-slate-800" : "text-slate-500 hover:bg-slate-100"}`}><X size={16} /></button>
              </header>
              <div className="px-6 py-4">
                <p className={`mb-4 text-sm ${darkMode ? "text-slate-400" : "text-slate-600"}`}>Toggle specific baseline visibility rules for this customer portal view layout configuration.</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {PERMISSIONS.map((permission) => {
                    const checked = permissionDraft[permission.key] === true;
                    return <div key={permission.key} className={`flex min-h-[88px] items-center justify-between gap-3 rounded-md border px-3.5 py-3 ${checked ? (darkMode ? "border-red-900/70 bg-red-950/30" : "border-red-200 bg-red-50") : (darkMode ? "border-slate-700 bg-slate-800/50" : "border-slate-200 bg-slate-50")}`}>
                      <div className="min-w-0"><p className={`text-sm font-semibold ${darkMode ? "text-slate-200" : "text-slate-800"}`}>{permission.label}</p><p className={`mt-1 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{permission.description}</p></div>
                      <button type="button" role="switch" aria-label={permission.label} aria-checked={checked} disabled={savingId === (permissionAccount._id || permissionAccount.id)} onClick={() => togglePermissionDraft(permission.key, !checked)} className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:cursor-not-allowed ${checked ? "bg-red-900" : darkMode ? "bg-slate-600" : "bg-slate-300"}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition ${checked ? "left-[22px]" : "left-1"}`} /></button>
                    </div>;
                  })}
                </div>
              </div>
              <footer className={`flex flex-col-reverse gap-2 border-t px-6 py-4 sm:flex-row sm:items-center sm:justify-between ${darkMode ? "border-slate-800 bg-slate-800/50" : "border-slate-100 bg-slate-50"}`}>
                {(isAdmin || canManageAccess) && permissionAccount.role === "customer" && <button type="button" onClick={() => setShowUpgradeConfirm(true)} disabled={savingId === (permissionAccount._id || permissionAccount.id)} className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60">↑ Upgrade to Staff</button>}
                <div className="flex justify-end gap-2"><button type="button" onClick={() => { setPermissionAccount(null); setPermissionDraft(null); }} disabled={savingId === (permissionAccount._id || permissionAccount.id)} className={`rounded-md border px-4 py-2.5 text-sm font-medium ${darkMode ? "border-slate-700 text-slate-200 hover:bg-slate-800" : "border-slate-200 text-slate-700 hover:bg-white"}`}>Cancel</button><button type="button" onClick={savePermissionMatrix} disabled={savingId === (permissionAccount._id || permissionAccount.id)} className="inline-flex min-w-28 items-center justify-center gap-2 rounded-md bg-red-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-900 disabled:opacity-60">{savingId === (permissionAccount._id || permissionAccount.id) ? <Loader2 size={15} className="animate-spin" /> : null}Save Matrix</button></div>
              </footer>
            </section>
          </div>}
          {staffAccount && staffDraft && <div className="mobile-fullscreen-overlay fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) { setStaffAccount(null); setStaffDraft(null); } }}>
            <section role="dialog" aria-modal="true" aria-labelledby="staff-access-title" className={`mobile-fullscreen-dialog flex max-h-[92vh] w-full max-w-[620px] flex-col overflow-hidden rounded-xl border shadow-2xl ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
              <header className={`flex items-center justify-between border-b px-5 py-4 ${darkMode ? "border-slate-800" : "border-slate-100"}`}>
                <div><h2 id="staff-access-title" className={`text-base font-bold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>Staff Access Control</h2><p className={`mt-1 text-xs font-mono ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{`${staffAccount.first_name || "Staff"} ${staffAccount.last_name || ""}`.trim()} · Permission Matrix</p></div>
                <button type="button" onClick={() => { setStaffAccount(null); setStaffDraft(null); }} aria-label="Close staff access settings" className={`rounded-full p-2 ${darkMode ? "text-slate-400 hover:bg-slate-800" : "text-slate-500 hover:bg-slate-100"}`}><X size={16} /></button>
              </header>
              <div className="overflow-y-auto">
                {(isOwnStaffAccount || !isAdmin) && <p role="status" className={`mx-5 mt-4 rounded-md border px-3 py-2 text-xs ${darkMode ? "border-amber-800 bg-amber-950/30 text-amber-200" : "border-amber-200 bg-amber-50 text-amber-800"}`}>{isOwnStaffAccount ? "You are currently viewing your own profile. Modifying your own permissions is disabled to prevent accidental lockout." : "Staff access is read-only here. Only a Super Admin can change staff permissions."}</p>}
                <section className={`border-b px-5 py-4 ${darkMode ? "border-slate-800" : "border-slate-100"}`}>
                  <p className={`mb-2 text-[10px] font-black uppercase tracking-wider ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Staff Subrole Designation</p>
                  <div className="flex flex-wrap gap-2">
                    <select value={staffDraft.subrole} disabled={!isAdmin || isOwnStaffAccount} onChange={(event) => setStaffDraft((current) => ({ ...current, subrole: event.target.value }))} className={`h-9 rounded-md border px-2 text-sm disabled:cursor-not-allowed disabled:opacity-60 ${darkMode ? "border-slate-700 bg-slate-800 text-slate-100" : "border-slate-200 bg-white text-slate-800"}`}>
                      {[...new Set([...STAFF_SUBROLES, ...staffDraft.custom_subroles])].map((subrole) => <option key={subrole} value={subrole}>{subrole}</option>)}
                    </select>
                    <input value={customSubroleInput} maxLength={40} disabled={!isAdmin || isOwnStaffAccount} onChange={(event) => setCustomSubroleInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addCustomSubrole(); } }} placeholder="Add custom subrole..." className={`h-9 min-w-[150px] flex-1 rounded-md border px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60 ${darkMode ? "border-slate-700 bg-slate-800 text-slate-100 placeholder:text-slate-500" : "border-slate-200 bg-white text-slate-800 placeholder:text-slate-400"}`} />
                    {isAdmin && !isOwnStaffAccount && <button type="button" onClick={addCustomSubrole} disabled={!customSubroleInput.trim()} className={`h-9 rounded-md border px-3 text-sm font-medium disabled:opacity-50 ${darkMode ? "border-slate-700 text-slate-200 hover:bg-slate-800" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}>Add</button>}
                  </div>
                </section>
                <section className="px-5 py-4">
                  <h3 className={`text-[10px] font-black uppercase tracking-wider ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Module System Permissions</h3>
                  <p className={`mb-3 mt-1 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Enable modules and configure their individual actions.</p>
                  <div className="space-y-2">
                    {STAFF_MODULES.map((module) => {
                      const moduleAccess = staffDraft.modules[module.key];
                      const isExpanded = expandedStaffModule === module.key;
                      return <div key={module.key} className={`rounded-md border ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                        <div className="flex min-h-11 items-center gap-3 px-3">
                          <span className={`min-w-0 flex-1 text-xs font-semibold ${darkMode ? "text-slate-200" : "text-slate-800"}`}>{module.label}</span>
                          <button type="button" onClick={() => setExpandedStaffModule(isExpanded ? null : module.key)} className={`whitespace-nowrap text-[10px] font-medium ${darkMode ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-800"}`} aria-expanded={isExpanded}>{isExpanded ? "▲ Hide Sub-actions" : "▼ Manage Sub-actions"}</button>
                          <button type="button" role="switch" aria-label={`${module.label} module`} aria-checked={moduleAccess.enabled} disabled={!isAdmin || isOwnStaffAccount} onClick={() => updateStaffModule(module.key, { enabled: !moduleAccess.enabled })} className={`relative h-5 w-9 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-60 ${moduleAccess.enabled ? "bg-red-900" : darkMode ? "bg-slate-600" : "bg-slate-300"}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${moduleAccess.enabled ? "left-[18px]" : "left-0.5"}`} /></button>
                        </div>
                        {isExpanded && <div className={`grid grid-cols-1 gap-2 border-t p-3 sm:grid-cols-2 ${darkMode ? "border-slate-700 bg-slate-800/40" : "border-slate-100 bg-slate-50"}`}>
                          {module.actions.map((action) => <div key={action.key} className={`flex min-h-8 items-center justify-between gap-3 rounded-sm px-2.5 ${darkMode ? "bg-slate-900/70" : "bg-white"} ${moduleAccess.enabled ? (darkMode ? "text-slate-300" : "text-slate-700") : "opacity-50"}`}><span className="text-xs">{action.label}</span><button type="button" role="switch" aria-label={`${module.label}: ${action.label}`} aria-checked={moduleAccess.actions[action.key]} disabled={!isAdmin || isOwnStaffAccount || !moduleAccess.enabled} onClick={() => toggleStaffAction(module.key, action.key)} className={`relative h-5 w-9 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-60 ${moduleAccess.actions[action.key] ? "bg-red-900" : darkMode ? "bg-slate-600" : "bg-slate-300"}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${moduleAccess.actions[action.key] ? "left-[18px]" : "left-0.5"}`} /></button></div>)}
                        </div>}
                      </div>;
                    })}
                  </div>
                </section>
              </div>
              <footer className={`flex flex-col-reverse gap-2 border-t px-5 py-3 sm:flex-row sm:items-center sm:justify-between ${darkMode ? "border-slate-800 bg-slate-800/40" : "border-slate-100 bg-slate-50"}`}>
                {(isAdmin || canManageAccess) && !isOwnStaffAccount && <button type="button" onClick={convertStaffToCustomer} disabled={savingId === (staffAccount._id || staffAccount.id)} className="rounded-md border border-red-200 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">↓ Convert to Customer</button>}
                <div className="flex justify-end gap-2"><button type="button" onClick={() => { setStaffAccount(null); setStaffDraft(null); }} className={`rounded-md border px-4 py-2 text-sm ${darkMode ? "border-slate-700 text-slate-200 hover:bg-slate-800" : "border-slate-200 text-slate-700 hover:bg-white"}`}>Close</button>{isAdmin && !isOwnStaffAccount && <button type="button" onClick={saveStaffAccess} disabled={savingId === (staffAccount._id || staffAccount.id)} className="inline-flex min-w-28 items-center justify-center gap-2 rounded-md bg-red-950 px-4 py-2 text-sm font-semibold text-white hover:bg-red-900 disabled:opacity-60">{savingId === (staffAccount._id || staffAccount.id) ? <Loader2 size={14} className="animate-spin" /> : null}Save Settings</button>}</div>
              </footer>
            </section>
          </div>}
          {showUpgradeConfirm && permissionAccount && <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
            <section role="alertdialog" aria-modal="true" aria-labelledby="upgrade-confirm-title" aria-describedby="upgrade-confirm-description" className={`w-full max-w-md rounded-xl border p-6 shadow-2xl ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
              <h2 id="upgrade-confirm-title" className={`text-lg font-bold leading-tight ${darkMode ? "text-slate-100" : "text-slate-900"}`}>Upgrade Customer to Operational Staff?</h2>
              <p id="upgrade-confirm-description" className={`mt-3 text-sm leading-6 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>This will change {`${permissionAccount.first_name || "this customer"} ${permissionAccount.last_name || ""}`.trim()}'s role to Staff. You can still customize their customer portal permissions separately.</p>
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" onClick={() => setShowUpgradeConfirm(false)} disabled={savingId === (permissionAccount._id || permissionAccount.id)} className={`rounded-md border px-4 py-2.5 text-sm font-medium ${darkMode ? "border-slate-700 text-slate-200 hover:bg-slate-800" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}>Cancel</button>
                <button type="button" onClick={() => { setShowUpgradeConfirm(false); upgradeCustomerToStaff(); }} disabled={savingId === (permissionAccount._id || permissionAccount.id)} className="rounded-md bg-red-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-900 disabled:cursor-not-allowed disabled:opacity-60">{savingId === (permissionAccount._id || permissionAccount.id) ? "Upgrading..." : "Confirm Upgrade"}</button>
              </div>
            </section>
          </div>}
          {restoreConfirmation && <div
            className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm"
            onMouseDown={(event) => {
              if (!restoringBackup && event.target === event.currentTarget) setRestoreConfirmation(null);
            }}
          >
            <section
              ref={restoreDialogRef}
              role="alertdialog"
              aria-modal="true"
              tabIndex={-1}
              aria-labelledby="restore-confirm-title"
              aria-describedby="restore-confirm-description"
              className={`w-full max-w-md rounded-xl border p-6 shadow-2xl ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}
            >
              <div className="flex items-start gap-3">
                <span className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${darkMode ? "bg-amber-950/60 text-amber-300" : "bg-amber-100 text-amber-800"}`}>
                  <RotateCcw aria-hidden="true" className="size-5" />
                </span>
                <div className="min-w-0">
                  <h2 id="restore-confirm-title" className={`text-lg font-semibold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>
                    {uploadedBackup?.id === restoreConfirmation.id ? "Sync uploaded backup?" : "Restore backup?"}
                  </h2>
                  <p className={`mt-1 break-words text-sm font-medium ${darkMode ? "text-slate-200" : "text-slate-700"}`}>{restoreConfirmation.name}</p>
                </div>
              </div>
              <p id="restore-confirm-description" className={`mt-4 text-sm leading-6 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                This will replace the current database records and uploaded files with the contents of this backup. This action cannot be undone from the system after it completes.
              </p>
              <footer className={`mt-6 flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end ${darkMode ? "border-slate-800" : "border-slate-100"}`}>
                <button
                  type="button"
                  onClick={() => setRestoreConfirmation(null)}
                  disabled={restoringBackup}
                  className={`rounded-md border px-4 py-2.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 ${darkMode ? "border-slate-700 text-slate-200 hover:bg-slate-800" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmRestoreBackup}
                  disabled={restoringBackup}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-red-800 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {restoringBackup && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
                  {restoringBackup
                    ? uploadedBackup?.id === restoreConfirmation.id ? "Syncing..." : "Restoring..."
                    : uploadedBackup?.id === restoreConfirmation.id ? "Sync Backup" : "Restore Backup"}
                </button>
              </footer>
            </section>
          </div>}
          {deleteConfirmation && <div
            className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm"
            onMouseDown={(event) => {
              if (!deletingBackup && event.target === event.currentTarget) setDeleteConfirmation(null);
            }}
          >
            <section
              ref={deleteDialogRef}
              role="alertdialog"
              aria-modal="true"
              tabIndex={-1}
              aria-labelledby="delete-backup-title"
              aria-describedby="delete-backup-description"
              className={`w-full max-w-md rounded-xl border p-6 shadow-2xl ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}
            >
              <div className="flex items-start gap-3">
                <span className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${darkMode ? "bg-red-950/60 text-red-300" : "bg-red-100 text-red-800"}`}>
                  <Trash2 aria-hidden="true" className="size-5" />
                </span>
                <div className="min-w-0">
                  <h2 id="delete-backup-title" className={`text-lg font-semibold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>Delete backup?</h2>
                  <p className={`mt-1 break-words text-sm font-medium ${darkMode ? "text-slate-200" : "text-slate-700"}`}>{deleteConfirmation.name}</p>
                </div>
              </div>
              <p id="delete-backup-description" className={`mt-4 text-sm leading-6 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                This backup file will be permanently deleted and can no longer be restored.
              </p>
              <footer className={`mt-6 flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end ${darkMode ? "border-slate-800" : "border-slate-100"}`}>
                <button
                  type="button"
                  onClick={() => setDeleteConfirmation(null)}
                  disabled={deletingBackup}
                  className={`rounded-md border px-4 py-2.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 ${darkMode ? "border-slate-700 text-slate-200 hover:bg-slate-800" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}
                >
                  Keep Backup
                </button>
                <button
                  type="button"
                  onClick={confirmDeleteBackup}
                  disabled={deletingBackup}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-red-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {deletingBackup && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
                  {deletingBackup ? "Deleting..." : "Delete Backup"}
                </button>
              </footer>
            </section>
          </div>}
        </main>
      </div>
    </div>
  );
}

function PermissionSwitch({ permission, index = 0, checked, onChange, disabled = false, compact = false, tableMode = false, darkMode = false }) {
  if (tableMode) {
    return <button type="button" role="switch" aria-label={permission.label} aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className={`relative inline-flex h-7 w-12 rounded-full border-0 p-0 shadow-inner transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45 ${checked ? "bg-sky-700" : (darkMode ? "bg-slate-600" : "bg-slate-300")}`}><span className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow-[0_1px_4px_rgba(15,23,42,0.28)] transition-transform duration-200 ease-out ${checked ? "translate-x-5" : "translate-x-0"}`} /></button>;
  }

  return <label className={`group flex min-h-[74px] cursor-pointer items-center justify-between gap-4 rounded-2xl border px-4 py-3.5 transition-all ${checked ? (darkMode ? "border-sky-700/70 bg-sky-950/25 shadow-[inset_3px_0_0_#67a7c7]" : "border-sky-200 bg-sky-50/80 shadow-[inset_3px_0_0_#2f6f91]") : (darkMode ? "border-slate-700 bg-slate-800/60 hover:border-slate-600" : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm")} ${disabled ? "cursor-wait opacity-60" : ""}`}><span className="flex min-w-0 items-center gap-3"><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-black ${checked ? (darkMode ? "bg-sky-900/70 text-sky-200" : "bg-sky-100 text-sky-800") : (darkMode ? "bg-slate-700 text-slate-400" : "bg-slate-100 text-slate-500")}`}>{String(index + 1).padStart(2, "0")}</span><span className="min-w-0"><span className={`block text-xs font-bold ${checked ? (darkMode ? "text-sky-100" : "text-slate-900") : (darkMode ? "text-slate-300" : "text-slate-700")}`}>{permission.label}</span>{!compact && <span className={`mt-1 block truncate text-[10px] ${darkMode ? "text-slate-500" : "text-slate-500"}`}>{permission.description}</span>}{!compact && <span className={`mt-1 block text-[9px] font-bold uppercase tracking-wider ${checked ? (darkMode ? "text-sky-300" : "text-sky-700") : (darkMode ? "text-slate-600" : "text-slate-400")}`}>{checked ? "Available" : "Restricted"}</span>}</span></span><button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className={`relative h-7 w-12 shrink-0 rounded-full border-0 p-0 shadow-inner transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 ${checked ? "bg-sky-700" : (darkMode ? "bg-slate-600" : "bg-slate-300")}`}><span className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow-[0_1px_4px_rgba(15,23,42,0.28)] transition-transform duration-200 ease-out ${checked ? "translate-x-5" : "translate-x-0"}`} /></button></label>;
}

export default Settings;
