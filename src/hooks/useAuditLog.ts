import { useCallback, useContext } from "react";
import { useAuth } from "../hooks/useAuth";
import { TenantContext } from "../contexts/TenantContext";
import { db, auth } from "../insforge/client";

export function useAuditLog() {
  const { user, role } = useAuth();
  const tenantContext = useContext(TenantContext);
  const tenantId = tenantContext?.tenantId;

  const logAction = useCallback(async (
    action: string,
    targetType?: string,
    targetId?: string,
    details?: any
  ) => {
    try {
      // For failed login, we might not have a user or tenant context
      let currentActorId = user?.id;
      let currentRole = role;
      let currentTenantId = tenantId;

      // If we don't have context (e.g. login failed, or login success before context updates)
      if (!currentActorId) {
        const { data: sessionData } = await auth.getCurrentUser();
        if (sessionData?.user) {
           currentActorId = sessionData.user.id;
        }
      }

      // If we still don't have an actor_id and this is not a failed login, we might skip
      // But for login.failed, actor_id is allowed to be null.
      
      // Get IP
      let ip_address: string | null = null;
      try {
        const res = await fetch("https://api.ipify.org?format=json");
        const data = await res.json();
        ip_address = data.ip;
      } catch (e) {
        // ignore IP error
      }

      // If no tenantId is available (e.g. failed login without tenant context), we'll try to find it if we have an email in details
      if (!currentTenantId && details?.email) {
        const { data: empData } = await db
          .from("employees")
          .select("tenant_id")
          .eq("email", details.email.toLowerCase())
          .limit(1)
          .maybeSingle();
        if (empData) {
          currentTenantId = empData.tenant_id as string;
        }
      }

      // If still no tenant_id, we can't insert because tenant_id is NOT NULL in the table schema
      if (!currentTenantId) return;

      await db.from("audit_logs").insert([{
        tenant_id: currentTenantId,
        actor_id: currentActorId || null,
        actor_role: currentRole || "unknown",
        action,
        target_type: targetType || null,
        target_id: targetId || null,
        details: details || null,
        ip_address
      }]);
    } catch (err) {
      // Silently catch errors so audit logging never breaks the main flow
      console.error("Audit log failed", err);
    }
  }, [user, role, tenantId]);

  return { logAction };
}
