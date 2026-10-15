import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

function AdminCreationModal() {
  const navigate = useNavigate();
  const location = useLocation();
  const { adminExists, adminLoading, adminError, refreshAdminStatus } = useAuth();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || location.pathname !== "/login" || adminLoading || adminExists !== false) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-8">
      <div className="w-full max-w-xl rounded-[32px] bg-white p-8 shadow-2xl border border-gray-200">
        <div className="mb-6">
          <h2 className="text-3xl font-bold text-gray-900">Administrator Access Unavailable</h2>
          <p className="mt-3 text-gray-600">
            No valid administrator account is available. Restore access using the configured system owner credentials.
          </p>
        </div>

        {adminError && (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">
            <p>{adminError}</p>
            <button type="button" onClick={refreshAdminStatus} className="mt-3 text-sm font-medium text-red-700 underline">Retry admin status</button>
          </div>
        )}

        <button type="button" onClick={() => navigate("/admin-recovery")} className="mt-4 w-full rounded-lg bg-red-700 px-6 py-3.5 font-semibold text-white hover:bg-red-800">
          Open administrator recovery
        </button>
        <button type="button" onClick={() => { setDismissed(true); navigate("/login", { replace: true }); }} className="mt-3 w-full rounded-lg border border-gray-300 px-6 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50">
          Return to login
        </button>
      </div>
    </div>
  );
}

export default AdminCreationModal;
