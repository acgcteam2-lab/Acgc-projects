import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getPublicCustomerPermissions, getSystemSettings } from "@/api/users";
import { subscribeToRealtime } from "@/lib/realtimeEvents";
import {
  defaultCustomerPermissions,
  getApplicableGlobalCustomerPermissions,
  normalizeGlobalCustomerPermissions,
  resolveCustomerPermissions,
} from "@/lib/customerPermissions";

export const useCustomerPermissions = () => {
  const { user } = useAuth();
  const accountId = user?.id || user?._id;
  const accountRole = user?.role;
  const [globalPermissions, setGlobalPermissions] = useState(defaultCustomerPermissions);

  useEffect(() => {
    if (accountRole && accountRole !== "customer") return undefined;

    let active = true;
    const loadGlobalPermissions = async () => {
      try {
        const settings = accountRole === "customer"
          ? await getSystemSettings()
          : await getPublicCustomerPermissions();
        if (active) setGlobalPermissions(normalizeGlobalCustomerPermissions(settings.global_permissions || {}));
      } catch {
        if (active) setGlobalPermissions(defaultCustomerPermissions());
      }
    };

    loadGlobalPermissions();
    const unsubscribeRealtime = subscribeToRealtime("settings", loadGlobalPermissions);
    return () => {
      active = false;
      unsubscribeRealtime();
    };
  }, [accountId, accountRole]);

  const applicableGlobalPermissions = getApplicableGlobalCustomerPermissions(accountRole, globalPermissions);

  return resolveCustomerPermissions(user?.access_permissions, applicableGlobalPermissions);
};