import { useEffect, useState } from "react";
import {
  Search,
  Eye,
  Pencil,
  Play,
} from "lucide-react";

import { getAdminOrders, updateOrderProgress, updateOrderStatus } from "@/api/orders";
import { formatDateToMMMDDYYYY } from "@/lib/dateUtils";
import { getProgressColor } from "@/lib/utils";
import toast, { Toaster } from "react-hot-toast";
import { uploadFiles } from "@/api/uploads";
import ProgressViewModal from "../../components/ProgressViewModal";
import ProgressEditModal from "../../components/ProgressEditModal";
import ProfileAvatar from "../../components/ui/ProfileAvatar";
import { useIsMobile } from "@/hooks/useIsMobile";

import Sidebar from "../../components/layout/Sidebar";
import Navbar from "../../components/layout/Navbar";
import AdminPageHeader from "../../components/layout/AdminPageHeader";
import { useAuth } from "@/contexts/AuthContext";
import { recordActivity } from "@/lib/activityLog";

const normalizeStageStatus = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-");

const hasDelayedStage = (stages = []) =>
  Array.isArray(stages) &&
  stages.some(
    (stage) =>
      (!stage.completed && normalizeStageStatus(stage.status) === "delayed") ||
      (Array.isArray(stage.subStages) &&
        stage.subStages.some((sub) => !sub.completed && normalizeStageStatus(sub.status) === "delayed"))
  );

const hasAddedStages = (stages = []) =>
  Array.isArray(stages) &&
  stages.some((stage) => {
    if (!Array.isArray(stage.subStages) || stage.subStages.length === 0) return false;
    const status = normalizeStageStatus(stage.status);
    const isCurrent = ["in-progress", "active", "current"].includes(status);
    const isDone = stage.completed === true || ["done", "completed"].includes(status);
    return !isCurrent && !isDone;
  });

export const buildStartedProgressStages = (stages = []) => {
  const stageDefinitions = [
    { key: "cutting", name: "Cutting" },
    { key: "assembly", name: "Assembly" },
    { key: "fabrication", name: "Fabrication" },
    { key: "installation", name: "Installation" },
  ];
  const existingStages = Array.isArray(stages) ? stages : [];

  return stageDefinitions.map(({ key, name }) => {
    const existingStage = existingStages.find((stage) => {
      const normalizedKey = normalizeStageStatus(stage.key);
      const normalizedName = normalizeStageStatus(stage.name);
      return normalizedKey === key || normalizedName === normalizeStageStatus(name);
    }) || existingStages.find((stage) =>
      normalizeStageStatus(stage.key || stage.name).includes(key)
    );
    const wasCompleted = existingStage?.completed === true ||
      ["done", "completed"].includes(normalizeStageStatus(existingStage?.status));

    return {
      ...(existingStage || {}),
      key,
      name,
      status: key === "cutting" ? "in_progress" : wasCompleted ? "done" : "pending",
      completed: key !== "cutting" && wasCompleted,
    };
  });
};

export const formatOrderStatus = (status, contractStatus) => {
  if (status === "completed") return "Completed";
  if (status === "site_inspection") return "Installation";
  if (status === "processing") return "Fabrication";
  if (status === "approved") return "Pending";
  if (status === "contract_accepted") return "Pending";
  if (status === "contract_sent") return "Pending";
  if (status === "admin_review") return "Pending";
  if (status === "order_submitted") return "Pending";
  if (status === "cancelled") return "Cancelled";
  return "Pending";
};

export const getProjectStatus = (order, stages = order?.progress_stages ?? []) => {
  if (Array.isArray(stages) && stages.length > 0) {
    const allCompleted = stages.every((stage) =>
      stage.completed === true ||
      ["done", "completed"].includes(normalizeStageStatus(stage.status))
    );
    if (allCompleted) return "Completed";
  }

  if (hasDelayedStage(stages)) return "Delayed";

  const activeStage = Array.isArray(stages)
    ? stages.find((stage) => {
        const status = normalizeStageStatus(stage.status);
        return status === "in-progress" || status === "active";
      })
    : null;

  if (activeStage?.name) return activeStage.name;

  const nextStage = Array.isArray(stages)
    ? stages.find((stage) => {
        const status = normalizeStageStatus(stage.status);
        return ["pending", "not-started"].includes(status);
      })
    : null;

  if (nextStage?.name) return nextStage.name;

  return formatOrderStatus(order?.status, order?.contract_status);
};

const getStageProgressColor = (project) => {
  const status = String(project?.status || "").toLowerCase();

  if (status === "completed") return "bg-emerald-500";
  if (status === "installation") return "bg-sky-500";
  if (status === "fabrication" || status === "processing") return "bg-amber-500";
  if (status === "assembly") return "bg-blue-500";
  if (status === "cutting") return "bg-orange-500";
  if (status === "delayed") return "bg-rose-500";
  if (status === "accepted") return "bg-violet-500";
  if (status === "pending") return "bg-slate-400";

  const progress = Number(project?.progress) || 0;
  if (progress >= 70) return "bg-emerald-500";
  if (progress >= 31) return "bg-amber-500";
  return "bg-red-500";
};

const getProjectStatusBadgeClasses = (status) => {
  const statusClasses = {
    pending: "border-slate-300 bg-slate-100 text-slate-700",
    cutting: "border-orange-200 bg-orange-100 text-orange-800",
    assembly: "border-blue-200 bg-blue-100 text-blue-800",
    fabrication: "border-amber-200 bg-amber-100 text-amber-800",
    installation: "border-sky-200 bg-sky-100 text-sky-800",
    completed: "border-emerald-200 bg-emerald-100 text-emerald-800",
    delayed: "border-rose-200 bg-rose-100 text-rose-800",
    accepted: "border-violet-200 bg-violet-100 text-violet-800",
    cancelled: "border-rose-200 bg-rose-100 text-rose-800",
  };

  return statusClasses[normalizeStageStatus(status)] || "border-slate-300 bg-slate-100 text-slate-700";
};

const mapProgressFromStatus = (status, progress) => {
  // If API already provided a numeric progress, respect it but avoid showing 100%
  // for non-completed orders (cap at 90).
  if (typeof progress === "number") {
    return progress >= 100 && status !== "completed" ? 90 : progress;
  }

  if (status === "completed") return 100;
  if (status === "approved") return 0;
  if (status === "site_inspection") return 70;
  if (status === "processing") return 65;
  if (status === "contract_accepted") return 50;
  if (status === "contract_sent") return 25;
  return 15;
};

const formatClientType = (order) => {
  const rawType = (order.acceptance_method || order.order_type || "online_order").toString();
  return rawType
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

const buildProjectRows = (order) => {
  const orderId = order?._id || order?.id || "unknown-order";
  const items = Array.isArray(order?.items) && order.items.length > 0 ? order.items.filter(Boolean) : [null];

  return items.map((item, index) => {
    const stages = Array.isArray(item?.progress_stages) && item.progress_stages.length > 0
      ? item.progress_stages
      : order.progress_stages || [];
    const itemProgress = typeof item?.progress === "number" ? item.progress : null;
    const itemName =
      item?.name ||
      item?.product_name ||
      item?.product_id?.name ||
      item?.category ||
      order?.product_name ||
      order?.project_name ||
      "Project";

    const customerName =
      order.customer_name ||
      `${order.customer?.first_name || ""} ${order.customer?.last_name || ""}`.trim() ||
      "Unknown";

    return {
      id: item?._id || item?.id || `${orderId}-item-${index}`,
      orderId,
      client: customerName,
      clientEmail: order.customer?.email || order.customer_email || "",
      product: itemName,
      clientType: formatClientType(order),
      inspection: formatDateToMMMDDYYYY(order.inspection_date) ||
        (order.inspection_status && order.inspection_status !== "pending"
          ? order.inspection_status.charAt(0).toUpperCase() + order.inspection_status.slice(1)
          : "TBD"),
      installation: formatDateToMMMDDYYYY(order.estimated_installation_date) || "TBD",
      estimated_installation_date: order.estimated_installation_date,
      progress: itemProgress ?? mapProgressFromStatus(order.status, order.progress),
      stages,
      status: getProjectStatus(order, stages),
      statusKey: order.status,
      contract_status: order.contract_status,
      payment_status: order.payment_status,
      inspection_status: order.inspection_status,
      inspection_date: order.inspection_date,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      contract_terms: order.contract_terms,
      rawOrder: order,
      itemIndex: index,
    };
  });
};

const isSameProjectRow = (currentProject, targetProject) => {
  if (!currentProject || !targetProject) return false;

  if (currentProject.id && targetProject.id && currentProject.id === targetProject.id) {
    return true;
  }

  return (
    currentProject.orderId === targetProject.orderId &&
    currentProject.itemIndex === targetProject.itemIndex
  );
};

function ProgressMonitor() {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const [isSidebarOpen, setIsSidebarOpen] =
    useState(() => {
      if (typeof window === "undefined") return true;
      const stored = localStorage.getItem("sidebarOpen");
      return stored !== null ? JSON.parse(stored) : true;
    });

  const [currentPage, setCurrentPage] =
    useState(1);

  useEffect(() => {
    localStorage.setItem("sidebarOpen", JSON.stringify(isSidebarOpen));
  }, [isSidebarOpen]);

  const [statusFilter, setStatusFilter] =
    useState("Pending");

  const [search, setSearch] =
    useState("");

  const [showEditModal, setShowEditModal] =
    useState(false);

  const [showViewModal, setShowViewModal] = useState(false);

  const [selectedProject, setSelectedProject] =
    useState(null);

  const [cancelConfirm, setCancelConfirm] = useState({ open: false, id: null });
  const [cancellingId, setCancellingId] = useState(null);
  const [startingProjectId, setStartingProjectId] = useState(null);

  const rowsPerPage = 5;

  const [projectList, setProjectList] = useState([]);
  const [projectLoading, setProjectLoading] = useState(false);

  const filteredProjects =
    projectList.filter((project) => {
      const matchSearch =
        project.client
          .toLowerCase()
          .includes(search.toLowerCase()) ||
        project.product
          .toLowerCase()
          .includes(search.toLowerCase());

      const matchStatus =
        statusFilter === "Added stages"
          ? hasAddedStages(project.stages)
          : statusFilter === "All"
          ? true
          : statusFilter === "Pending"
          ? project.status === "Pending"
          : project.status === statusFilter;

      return matchSearch && matchStatus;
    });

  const lastIndex =
    currentPage * rowsPerPage;

  const firstIndex =
    lastIndex - rowsPerPage;

  const currentProjects = isMobile
    ? filteredProjects
    : filteredProjects.slice(
      firstIndex,
      lastIndex
    );

  const totalPages = Math.max(1, Math.ceil(
    filteredProjects.length / rowsPerPage
  ));

  useEffect(() => {
    const fetchProjects = async () => {
      setProjectLoading(true);
      try {
        const response = await getAdminOrders({ module: "progress_monitoring" });
        const orders = response.orders || [];
        const projects = orders
          .filter((order) =>
            [
              "approved",
              "admin_review",
              "processing",
              "contract_accepted",
              "completed",
            ].includes(order.status)
            || (order.contract_status && order.contract_status.toString().toLowerCase() === "accepted")
          )
          .flatMap((order) => buildProjectRows(order));
        setProjectList(projects);
      } catch (error) {
        console.error("Failed to load progress monitor projects", error);
        setProjectList([]);
      } finally {
        setProjectLoading(false);
      }
    };

    fetchProjects();
  }, []);

  const handleSave = async (updated, fileContexts = [], onUploadProgress) => {
    let updatedProject = { ...updated };
    try {
      if (fileContexts && fileContexts.length > 0) {
        const files = fileContexts.map((ctx) => ctx.file);
        const res = await uploadFiles(files, onUploadProgress, { purpose: "progress-media" });
        const uploadedUrls = (res.files || []).map((f) => f.url).filter(Boolean);

        uploadedUrls.forEach((url, index) => {
          const context = fileContexts[index];
          if (typeof context.subIndex === "number") {
            updatedProject.stages[context.stageIndex].subStages[context.subIndex].images = [
              ...(updatedProject.stages[context.stageIndex].subStages[context.subIndex].images || []),
              url,
            ];
          } else {
            updatedProject.stages[context.stageIndex].images = [
              ...(updatedProject.stages[context.stageIndex].images || []),
              url,
            ];
          }
        });
      }

      const targetOrderId = updatedProject.orderId || updatedProject.id;
      if (targetOrderId) {
        const response = await updateOrderProgress(targetOrderId, {
          progress: updatedProject.progress,
          status: updatedProject.status,
          estimated_installation_date: updatedProject.installation,
          stages: updatedProject.stages,
          proof_images: [],
          ...(updatedProject.rawOrder?.items?.length > 1 ? { itemIndex: updatedProject.itemIndex } : {}),
        });
        recordActivity(user, `Updated progress for ${updatedProject.product} in order ${targetOrderId}.`, "Progress Monitor");

        if (response?.order) {
          const savedOrder = response.order;
          const savedItem = savedOrder.items?.[updatedProject.itemIndex];
          const savedStages = savedItem?.progress_stages?.length
            ? savedItem.progress_stages
            : savedOrder.progress_stages || [];
          updatedProject = {
            ...updatedProject,
            rawOrder: savedOrder,
            statusKey: savedOrder.status,
            contract_status: savedOrder.contract_status,
            payment_status: savedOrder.payment_status,
            inspection_status: savedOrder.inspection_status,
            inspection_date: savedOrder.inspection_date,
            installation: formatDateToMMMDDYYYY(savedOrder.estimated_installation_date) || "TBD",
            estimated_installation_date: savedOrder.estimated_installation_date,
            createdAt: savedOrder.createdAt,
            updatedAt: savedOrder.updatedAt,
            contract_terms: savedOrder.contract_terms,
            progress: typeof savedItem?.progress === "number"
              ? savedItem.progress
              : mapProgressFromStatus(savedOrder.status, savedOrder.progress),
            stages: savedStages,
            progress_stages: savedStages,
            status: getProjectStatus(savedOrder, savedStages),
          };
        }
      }

      setProjectList((items) =>
        items.map((item) =>
          isSameProjectRow(item, updatedProject)
            ? { ...item, ...updatedProject, id: item.id || updatedProject.id, orderId: item.orderId || updatedProject.orderId }
            : item
        )
      );
      setSelectedProject(updatedProject);
    } catch (err) {
      console.error("Failed to save progress", err);
      throw err;
    }
  };

  const handleStartProject = async (project) => {
    const targetOrderId = project.orderId || project.id;
    if (!targetOrderId) return;

    setStartingProjectId(project.id);
    try {
      const isBatchOrder = project.rawOrder?.items?.length > 1;
      const stages = buildStartedProgressStages(project.stages);
      const response = await updateOrderProgress(targetOrderId, {
        progress: 20,
        status: "Cutting",
        estimated_installation_date: project.estimated_installation_date || "",
        stages,
        proof_images: [],
        ...(isBatchOrder ? { itemIndex: project.itemIndex } : {}),
      });

      const savedOrder = response.order;
      const savedItem = savedOrder.items?.[project.itemIndex];
      const savedStages = savedItem?.progress_stages?.length
        ? savedItem.progress_stages
        : savedOrder.progress_stages?.length
          ? savedOrder.progress_stages
          : stages;
      const updatedProject = {
        ...project,
        rawOrder: savedOrder,
        statusKey: savedOrder.status,
        progress: typeof savedItem?.progress === "number"
          ? savedItem.progress
          : typeof savedOrder.progress === "number"
            ? savedOrder.progress
            : 20,
        stages: savedStages,
        progress_stages: savedStages,
        status: getProjectStatus(savedOrder, savedStages),
      };

      setProjectList((items) =>
        items.map((item) =>
          isSameProjectRow(item, updatedProject) ? { ...item, ...updatedProject } : item
        )
      );
      setCurrentPage(1);
      recordActivity(user, `Started project ${project.product} in order ${targetOrderId}.`, "Progress Monitor");
      toast.success("Project started at Cutting.");
    } catch (error) {
      toast.error(error?.data?.message || error?.message || "Unable to start project.");
    } finally {
      setStartingProjectId(null);
    }
  };

  const handleTimelineOrderChange = (savedOrder) => {
    if (!savedOrder) return;
    const orderId = savedOrder._id || savedOrder.id || selectedProject?.orderId || selectedProject?.id;
    const updatedProject = {
      ...(selectedProject || {}),
      id: selectedProject?.id || orderId,
      orderId,
      client:
        savedOrder.customer_name ||
        `${savedOrder.customer?.first_name || ""} ${savedOrder.customer?.last_name || ""}`.trim() ||
        selectedProject?.client ||
        "Unknown",
      product:
        selectedProject?.product ||
        (savedOrder.items && savedOrder.items.length > 0
          ? savedOrder.items[0].name || savedOrder.items[0].category || "Project"
          : "Project"),
      inspection: formatDateToMMMDDYYYY(savedOrder.inspection_date) ||
        (savedOrder.inspection_status && savedOrder.inspection_status !== "pending"
          ? savedOrder.inspection_status.charAt(0).toUpperCase() + savedOrder.inspection_status.slice(1)
          : "TBD"),
      installation: formatDateToMMMDDYYYY(savedOrder.estimated_installation_date) || "TBD",
      estimated_installation_date: savedOrder.estimated_installation_date,
      progress: mapProgressFromStatus(savedOrder.status, savedOrder.progress),
      stages: savedOrder.progress_stages || [],
      progress_stages: savedOrder.progress_stages || [],
      status: getProjectStatus(savedOrder),
      statusKey: savedOrder.status,
      contract_status: savedOrder.contract_status,
      payment_status: savedOrder.payment_status,
      inspection_status: savedOrder.inspection_status,
      inspection_date: savedOrder.inspection_date,
      createdAt: savedOrder.createdAt,
      updatedAt: savedOrder.updatedAt,
      contract_terms: savedOrder.contract_terms,
      rawOrder: savedOrder,
    };

    setProjectList((items) =>
      items.map((item) =>
        isSameProjectRow(item, updatedProject)
          ? { ...item, ...updatedProject, id: item.id || updatedProject.id, orderId }
          : item
      )
    );
    setSelectedProject(updatedProject);
  };

  const closeCancelModal = () => setCancelConfirm({ open: false, id: null });

  const handleConfirmCancel = async () => {
    const orderId = cancelConfirm.id;
    setCancelConfirm({ open: false, id: null });
    if (!orderId) return;
    const prev = projectList.find((p) => (p.orderId || p.id) === orderId && p.itemIndex === selectedProject?.itemIndex);
    const prevStatus = prev?.statusKey || prev?.status || null;
    try {
      setCancellingId(orderId);
      const res = await updateOrderStatus(orderId, { status: "cancelled" });
      recordActivity(user, `Cancelled project ${orderId}.`, "Progress Monitor");
      if (res && res.order) {
        const saved = res.order;
        setProjectList((prevList) =>
          prevList.map((p) =>
            isSameProjectRow(p, prev)
              ? {
                  ...p,
                  rawOrder: saved,
                  statusKey: saved.status,
                  contract_status: saved.contract_status,
                  payment_status: saved.payment_status,
                  inspection_status: saved.inspection_status,
                  inspection_date: saved.inspection_date,
                  createdAt: saved.createdAt,
                  updatedAt: saved.updatedAt,
                  contract_terms: saved.contract_terms,
                  progress: mapProgressFromStatus(saved.status, saved.progress),
                  stages: saved.progress_stages || [],
                  progress_stages: saved.progress_stages || [],
                  status: getProjectStatus(saved),
                }
              : p
          )
        );

        toast((t) => (
          <div className="flex items-center justify-between gap-4">
            <div>Order cancelled</div>
            <div className="flex items-center gap-2">
              {prevStatus && (
                <button
                  onClick={async () => {
                    toast.dismiss(t.id);
                    try {
                      const undoRes = await updateOrderStatus(orderId, { status: prevStatus });
                      if (undoRes && undoRes.order) {
                        const restored = undoRes.order;
                        setProjectList((prevList) =>
                          prevList.map((p) =>
                            p.id === orderId
                              ? {
                                  ...p,
                                  rawOrder: restored,
                                  statusKey: restored.status,
                                  contract_status: restored.contract_status,
                                  payment_status: restored.payment_status,
                                  inspection_status: restored.inspection_status,
                                  inspection_date: restored.inspection_date,
                                  createdAt: restored.createdAt,
                                  updatedAt: restored.updatedAt,
                                  contract_terms: restored.contract_terms,
                                  progress: mapProgressFromStatus(restored.status, restored.progress),
                                  stages: restored.progress_stages || [],
                                  progress_stages: restored.progress_stages || [],
                                  status: getProjectStatus(restored),
                                }
                              : p
                          )
                        );
                        toast.success("Order restored");
                      }
                    } catch (e) {
                      console.error("Failed to restore order", e);
                      toast.error("Failed to restore order");
                    }
                  }}
                  className="text-sm text-blue-600"
                >
                  Undo
                </button>
              )}
            </div>
          </div>
        ), { duration: 6000 });
      } else {
        // fallback: mark locally
        setProjectList((prevList) => prevList.map((p) => (isSameProjectRow(p, prev) ? { ...p, status: "Cancelled", statusKey: "cancelled" } : p)));
        toast((t) => (
          <div className="flex items-center justify-between gap-4">
            <div>Order cancelled</div>
            <div className="flex items-center gap-2">
              {prevStatus && (
                <button
                  onClick={async () => {
                    toast.dismiss(t.id);
                    try {
                      const undoRes = await updateOrderStatus(orderId, { status: prevStatus });
                      if (undoRes && undoRes.order) {
                        const restored = undoRes.order;
                        setProjectList((prevList) =>
                          prevList.map((p) =>
                            (p.orderId || p.id) === orderId
                              ? {
                                  ...p,
                                  rawOrder: restored,
                                  statusKey: restored.status,
                                  contract_status: restored.contract_status,
                                  payment_status: restored.payment_status,
                                  inspection_status: restored.inspection_status,
                                  inspection_date: restored.inspection_date,
                                  createdAt: restored.createdAt,
                                  updatedAt: restored.updatedAt,
                                  contract_terms: restored.contract_terms,
                                  progress: mapProgressFromStatus(restored.status, restored.progress),
                                  stages: restored.progress_stages || [],
                                  progress_stages: restored.progress_stages || [],
                                  status: getProjectStatus(restored),
                                }
                              : p
                          )
                        );
                        toast.success("Order restored");
                      }
                    } catch (e) {
                      console.error("Failed to restore order", e);
                      toast.error("Failed to restore order");
                    }
                  }}
                  className="text-sm text-blue-600"
                >
                  Undo
                </button>
              )}
            </div>
          </div>
        ), { duration: 6000 });
      }
    } catch (err) {
      console.error("Failed to cancel order", err);
      toast.error(err?.data?.message || err?.message || "Failed to cancel order.");
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100">
      <Toaster position="bottom-right" />
      <Sidebar isOpen={isSidebarOpen} onToggle={() => setIsSidebarOpen((open) => !open)} />

      <div className="flex-1 min-h-0 flex flex-col">
        <Navbar />

        <main className="flex-1 min-h-0 overflow-y-auto p-6">

          <AdminPageHeader
            title="Progress Monitor"
            description="Monitor fabrication and installation progress."
            stats={[
              { label: "Projects", value: projectList.length, color: "text-blue-200" },
              { label: "In Progress", value: projectList.filter((project) => project.progress < 100 && project.status !== "Cancelled").length, color: "text-amber-200" },
              { label: "Completed", value: projectList.filter((project) => project.status === "Completed" || project.progress >= 100).length, color: "text-emerald-300" },
            ]}
          />

          {/* FILTERS */}

          <div className="bg-white rounded-3xl shadow mt-6 p-6">

            <div className="relative">
              <Search
                size={18}
                className="absolute left-4 top-4 text-gray-400"
              />

              <input
                type="text"
                placeholder="Search client or product..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full pl-12 pr-4 py-3 border rounded-xl"
              />
            </div>

            <div className="mt-4 md:hidden">
              <select
                aria-label="Project status category"
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value);
                  setCurrentPage(1);
                }}
                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-700 shadow-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100"
              >
                {[
                  "All",
                  "Pending",
                  "Cutting",
                  "Assembly",
                  "Fabrication",
                  "Installation",
                  "Completed",
                  "Delayed",
                  "Added stages",
                ].map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
            </div>

            <div className="mt-4 hidden flex-wrap gap-3 md:flex">
              {[
                "All",
                "Pending",
                "Cutting",
                "Assembly",
                "Fabrication",
                "Installation",
                "Completed",
                "Delayed",
                "Added stages",
              ].map((status) => (
                <button
                  key={status}
                  onClick={() => {
                    setStatusFilter(status)
                    setCurrentPage(1)
                  }}
                  className={`px-4 py-2 rounded-xl ${
                    statusFilter === status
                      ? "bg-red-600 text-white"
                      : "bg-gray-100"
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>

          </div>

          {/* TABLE */}

          <div className="bg-white rounded-3xl shadow mt-6 overflow-hidden">
            <div className="hidden md:block">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="p-4 text-left">Client</th>
                      <th className="p-4 text-left">Client Type</th>
                      <th className="p-4 text-left">Product</th>
                      <th className="p-4 text-left">Site Inspection</th>
                      <th className="p-4 text-left">Est. Installation</th>
                      <th className="p-4 text-left">Progress</th>
                      {statusFilter === "All" && <th className="p-4 text-left">Status</th>}
                      <th className="p-4 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projectLoading && (
                      <tr>
                        <td className="p-6 text-center text-gray-500" colSpan={statusFilter === "All" ? 8 : 7}>
                          Loading projects...
                        </td>
                      </tr>
                    )}
                    {!projectLoading && currentProjects.map((project, index) => (
                      <tr key={index} className="border-t hover:bg-gray-50">
                        <td className="p-4"><ProfileAvatar name={project.client} email={project.clientEmail} /></td>
                        <td className="p-4">{project.clientType}</td>
                        <td className="p-4">{project.product}</td>
                        <td className="p-4">{project.inspection}</td>
                        <td className="p-4">{project.installation}</td>
                        <td className="p-4">
                          <div className="w-full bg-gray-200 rounded-full h-3">
                            {(() => {
                              const progressColor = getStageProgressColor(project);
                              return (
                                <div className={`h-3 rounded-full ${progressColor}`} style={{ width: `${project.progress}%` }} />
                              );
                            })()}
                          </div>
                          <span className="font-semibold text-sm">{project.progress}%</span>
                        </td>
                        {statusFilter === "All" && <td className="p-4"><span className="px-3 py-1 rounded-full bg-gray-100">{project.status}</span></td>}
                        <td className="p-4">
                          <div className="flex justify-center gap-2">
                            <button onClick={() => { setSelectedProject(project); setShowViewModal(true); }} className="bg-blue-100 text-blue-600 p-2 rounded-lg" aria-label={`View ${project.product} progress`}>
                              <Eye size={18} />
                            </button>
                            {project.status === "Pending" ? (
                              <button onClick={() => handleStartProject(project)} disabled={startingProjectId === project.id} className="bg-emerald-100 text-emerald-700 p-2 rounded-lg disabled:cursor-wait disabled:opacity-50" title="Start project at Cutting" aria-label={`Start ${project.product} at Cutting`}>
                                <Play size={18} />
                              </button>
                            ) : Number(project.progress) < 100 && (
                              <button onClick={() => { setSelectedProject(project); setShowEditModal(true); }} className="bg-yellow-100 text-yellow-600 p-2 rounded-lg">
                                <Pencil size={18} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!projectLoading && currentProjects.length === 0 && (
                      <tr>
                        <td className="p-6 text-center text-gray-500" colSpan={8}>No projects found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-3 p-3 md:hidden">
              {projectLoading ? (
                <div className="rounded-2xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">Loading projects...</div>
              ) : currentProjects.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">No projects found.</div>
              ) : currentProjects.map((project) => (
                <div key={project.id || project.client + project.product} className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-gray-900">{project.product}</p>
                      <p className="mt-1 text-xs text-gray-500">{project.client}</p>
                    </div>
                    <div className="flex max-w-[52%] flex-wrap justify-end gap-1.5">
                      {hasAddedStages(project.stages) && (
                        <span className="rounded-full border border-violet-200 bg-violet-100 px-2.5 py-1 text-[10px] font-semibold text-violet-800">
                          Added stages
                        </span>
                      )}
                      <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${getProjectStatusBadgeClasses(project.status)}`}>
                        {project.status}
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-600">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-gray-400">Type</p>
                      <p className="mt-1 font-medium text-gray-700">{project.clientType}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-gray-400">Progress</p>
                      <p className="mt-1 font-semibold text-gray-900">{project.progress}%</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-gray-400">Inspection</p>
                      <p className="mt-1 font-medium text-gray-700">{project.inspection}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-gray-400">Install</p>
                      <p className="mt-1 font-medium text-gray-700">{project.installation}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex justify-end gap-2">
                    <button onClick={() => { setSelectedProject(project); setShowViewModal(true); }} className="bg-blue-100 text-blue-600 p-2 rounded-lg" aria-label={`View ${project.product} progress`}>
                      <Eye size={18} />
                    </button>
                    {project.status === "Pending" ? (
                      <button onClick={() => handleStartProject(project)} disabled={startingProjectId === project.id} className="bg-emerald-100 text-emerald-700 p-2 rounded-lg disabled:cursor-wait disabled:opacity-50" title="Start project at Cutting" aria-label={`Start ${project.product} at Cutting`}>
                        <Play size={18} />
                      </button>
                    ) : Number(project.progress) < 100 && (
                      <button onClick={() => { setSelectedProject(project); setShowEditModal(true); }} className="bg-yellow-100 text-yellow-600 p-2 rounded-lg">
                        <Pencil size={18} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* PAGINATION */}

            <div className="hidden justify-center items-center p-4 border-t bg-gray-50 gap-4 md:flex">

              <span>
                Page {currentPage} of {totalPages}
              </span>

              <div className="flex gap-2">

                <button
                  disabled={currentPage === 1}
                  onClick={() =>
                    setCurrentPage(currentPage - 1)
                  }
                  className="px-4 py-2 border rounded-lg"
                >
                  Previous
                </button>

                {[...Array(totalPages)].map(
                  (_, index) => (
                    <button
                      key={index}
                      onClick={() =>
                        setCurrentPage(index + 1)
                      }
                      className={`w-10 h-10 rounded-lg ${
                        currentPage === index + 1
                          ? "bg-red-600 text-white"
                          : "border"
                      }`}
                    >
                      {index + 1}
                    </button>
                  )
                )}

                <button
                  disabled={
                    currentPage === totalPages
                  }
                  onClick={() =>
                    setCurrentPage(currentPage + 1)
                  }
                  className="px-4 py-2 border rounded-lg"
                >
                  Next
                </button>

              </div>

            </div>

          </div>

          {showViewModal && selectedProject && (
            <ProgressViewModal
              project={selectedProject}
              onClose={() => setShowViewModal(false)}
              onOrderChange={handleTimelineOrderChange}
            />
          )}

          {showEditModal && selectedProject && (
            <ProgressEditModal project={selectedProject} onClose={() => setShowEditModal(false)} onSave={handleSave} />
          )}

          {cancelConfirm.open && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
              <div className="absolute inset-0" onClick={closeCancelModal} />
              <div className="relative bg-white rounded-3xl shadow-lg p-6 w-full max-w-md">
                <h2 className="text-2xl font-bold mb-2">Confirm Cancel</h2>
                <p className="text-sm text-slate-600 mb-6">Are you sure you want to cancel this project/order? This action will mark the order as cancelled.</p>
                <div className="flex justify-end gap-3">
                  <button onClick={closeCancelModal} className="px-4 py-2 rounded-lg bg-gray-100 text-slate-700 hover:bg-gray-200 transition">Close</button>
                  <button onClick={handleConfirmCancel} disabled={cancellingId === cancelConfirm.id} className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
                    {cancellingId === cancelConfirm.id ? "Cancelling..." : "Confirm Cancel"}
                  </button>
                </div>
              </div>
            </div>
          )}

        </main>
      </div>
    </div>
  );
}

export default ProgressMonitor;
