/* eslint-disable react-hooks/set-state-in-effect */
/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { auth, db } from "../insforge/client";
import type { EmployeeRole, Employee } from "../types";
import type { CapabilitySummary, ScopeType } from "../types/access";

type AuthUser = {
  id: string;
  email?: string;
  metadata?: Record<string, unknown>;
  profile?: Record<string, unknown> | null;
};

type EmployeeLookup = {
  id: string;
  tenant_id: string;
};

type LoginResult =
  | { error: string; requiresVerification?: false }
  | { error: null; requiresVerification: true; email: string }
  | { error: null; requiresVerification?: false };

type AuthContextValue = {
  user: AuthUser | null;
  role: EmployeeRole | null;
  tenantId: string | null;
  loading: boolean;
  capability: CapabilitySummary | null;
  capabilityLoading: boolean;
  capabilityUnavailableReason: string | null;
  hasGrant: (action: string, scopeType?: ScopeType | ScopeType[]) => boolean;
  canAccessMyWork: boolean;
  canAccessTeam: boolean;
  canAccessAdministration: boolean;
  isManager: boolean;
  currentEmployee: Employee | null;
  login: (email: string, password: string) => Promise<LoginResult>;
  verifyEmail: (email: string, otp: string) => Promise<{ error: string | null }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  refreshCapabilities: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const extractRole = (user: AuthUser | null): EmployeeRole | null => {
  if (!user) return null;
  const raw = user.metadata?.role ?? user.profile?.role;
  if (raw === "superadmin") return "superadmin";
  return raw === "hr" || raw === "employee" ? raw : null;
};

const extractTenantId = (user: AuthUser | null): string | null => {
  if (!user) return null;
  const raw = user.metadata?.tenant_id ?? user.profile?.tenant_id;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
};

const isTenantLoginBlocked = async (tenantId: string | null) => {
  if (!tenantId) return false;
  const { data } = await db.from("tenants").select("status").eq("id", tenantId).maybeSingle();
  const status = (data as { status?: string } | null)?.status;
  return status === "suspended" || status === "cancelled";
};

const resolvePlatformRole = async (): Promise<EmployeeRole | null> => {
  const { data } = await db.rpc("get_my_platform_role");
  return data ? "superadmin" : null;
};

const scopeTypes = new Set<ScopeType>(["self", "direct_reports", "company", "project", "channel"]);

const isCapabilitySummary = (value: unknown): value is CapabilitySummary => {
  if (!value || typeof value !== "object") return false;
  const summary = value as Record<string, unknown>;
  if (
    typeof summary.tenantId !== "string" ||
    typeof summary.membershipId !== "string" ||
    !["active", "suspended", "revoked"].includes(String(summary.membershipStatus)) ||
    !(summary.employeeId === null || typeof summary.employeeId === "string") ||
    !Number.isInteger(summary.accessVersion) ||
    !Array.isArray(summary.responsibilities) ||
    !summary.responsibilities.every((item) => typeof item === "string") ||
    !Array.isArray(summary.grants) ||
    !Array.isArray(summary.enabledModules) ||
    !summary.enabledModules.every((item) => typeof item === "string") ||
    !(summary.unavailableReason === null || typeof summary.unavailableReason === "string") ||
    typeof summary.issuedAt !== "string" ||
    summary.contractVersion !== "v0.5"
  ) {
    return false;
  }

  return summary.grants.every((grant) => {
    if (!grant || typeof grant !== "object") return false;
    const candidate = grant as Record<string, unknown>;
    const isScopedResource = candidate.scopeType === "project" || candidate.scopeType === "channel";
    return (
      typeof candidate.action === "string" &&
      typeof candidate.scopeType === "string" &&
      scopeTypes.has(candidate.scopeType as ScopeType) &&
      (isScopedResource ? typeof candidate.scopeId === "string" : candidate.scopeId === undefined)
    );
  });
};

const resolveCapabilitySummary = async (expectedTenantId: string | null) => {
  const { data, error } = await db.rpc("get_my_capability_summary");
  if (error || !isCapabilitySummary(data)) {
    return { summary: null, reason: "capability_unavailable" } as const;
  }
  if (expectedTenantId && data.tenantId !== expectedTenantId) {
    return { summary: null, reason: "capability_tenant_mismatch" } as const;
  }
  if (data.grants.some((grant) => grant.scopeType === "project" || grant.scopeType === "channel")) {
    return { summary: null, reason: "unsupported_capability_scope" } as const;
  }
  return { summary: data, reason: data.unavailableReason } as const;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [role, setRole] = useState<EmployeeRole | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [isManager, setIsManager] = useState(false);
  const [currentEmployee, setCurrentEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [capability, setCapability] = useState<CapabilitySummary | null>(null);
  const [capabilityLoading, setCapabilityLoading] = useState(true);
  const [capabilityUnavailableReason, setCapabilityUnavailableReason] = useState<string | null>(null);

  const clearCapability = useCallback(() => {
    setCapability(null);
    setCapabilityUnavailableReason(null);
    setCapabilityLoading(false);
  }, []);

  const refreshCapabilities = useCallback(async () => {
    if (!user || role === "superadmin") {
      clearCapability();
      return;
    }
    setCapabilityLoading(true);
    const resolved = await resolveCapabilitySummary(tenantId);
    setCapability(resolved.summary);
    setCapabilityUnavailableReason(resolved.reason);
    setCapabilityLoading(false);
  }, [clearCapability, role, tenantId, user]);

  const refreshUser = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    const { data, error } = await auth.getCurrentUser();
    if (error || !data?.user) {
      setUser(null);
      setRole(null);
      setTenantId(null);
      setIsManager(false);
      setCurrentEmployee(null);
      clearCapability();
      if (showLoading) setLoading(false);
      return;
    }

    const nextUser = data.user as AuthUser;
    let resolvedRole = await resolvePlatformRole() ?? extractRole(nextUser);
    let resolvedTenantId = extractTenantId(nextUser);

    // Fallback: if no role in metadata/profile, check the employees DB table
    if (!resolvedRole) {
      const empCheck = await db
        .from("employees")
        .select("id,tenant_id")
        .eq("user_id", nextUser.id)
        .limit(1);
      if (empCheck.data && empCheck.data.length > 0) {
        resolvedRole = "employee";
        resolvedTenantId = (empCheck.data[0] as EmployeeLookup).tenant_id;
      }
    }

    if (resolvedRole !== "superadmin" && await isTenantLoginBlocked(resolvedTenantId)) {
      await auth.signOut();
      setUser(null);
      setRole(null);
      setTenantId(null);
      setIsManager(false);
      setCurrentEmployee(null);
      clearCapability();
      if (showLoading) setLoading(false);
      return;
    }

    setUser(nextUser);
    setRole(resolvedRole);
    setTenantId(resolvedRole === "superadmin" ? null : resolvedTenantId);

    if (resolvedRole === "superadmin") {
      clearCapability();
    } else {
      setCapabilityLoading(true);
      const resolvedCapability = await resolveCapabilitySummary(resolvedTenantId);
      setCapability(resolvedCapability.summary);
      setCapabilityUnavailableReason(resolvedCapability.reason);
      setCapabilityLoading(false);
    }

    // Dynamic Manager check
    let emp: Employee | null = null;
    let managerCheck = false;
    if (resolvedRole !== "superadmin" && resolvedTenantId) {
      const { data: empData } = await db
        .from("employees")
        .select("*")
        .eq("user_id", nextUser.id)
        .eq("tenant_id", resolvedTenantId)
        .maybeSingle();
      if (empData) {
        const empStatus = (empData as Employee).status;

        // Guard: block pre-active employees from accessing the system mid-session.
        // This catches the case where an employee's status is downgraded after login.
        if (
          empStatus === "draft" ||
          empStatus === "pending_hr_review" ||
          empStatus === "pending_onboarding"
        ) {
          await auth.signOut();
          setUser(null);
          setRole(null);
          setTenantId(null);
          setIsManager(false);
          setCurrentEmployee(null);
          if (showLoading) setLoading(false);
          return;
        }

        emp = empData as Employee;
        const { count } = await db
          .from("employees")
          .select("*", { count: "exact", head: true })
          .eq("manager_id", empData.id)
          .eq("tenant_id", resolvedTenantId);
        managerCheck = (count ?? 0) > 0;
      }
    }
    setCurrentEmployee(emp);
    setIsManager(managerCheck);

    if (showLoading) setLoading(false);
  }, [clearCapability]);

  const login = useCallback(async (email: string, password: string): Promise<LoginResult> => {
    const { data, error } = await auth.signInWithPassword({ email, password });

    // InsForge returns an error when email is not yet verified
    if (error) {
      const msg = error.message ?? "";
      // Detect "email not verified" style errors from InsForge
      if (
        msg.toLowerCase().includes("email") &&
        (msg.toLowerCase().includes("verif") || msg.toLowerCase().includes("confirm"))
      ) {
        return { error: null, requiresVerification: true, email };
      }
      return { error: msg || "Login failed" };
    }

    if (!data?.user) {
      return { error: "Login failed" };
    }

    // Fetch full user (with metadata/profile including role) via getCurrentUser
    await refreshUser(false); // silent - don't flash loading screen
    const { data: current } = await auth.getCurrentUser();
    const signedInUser = current?.user as AuthUser | undefined;
    const signedInRole = await resolvePlatformRole() ?? extractRole(signedInUser ?? null);
    let signedInTenantId = extractTenantId(signedInUser ?? null);

    if (!signedInRole && signedInUser?.id) {
      const empCheck = await db
        .from("employees")
        .select("id,tenant_id")
        .eq("user_id", signedInUser.id)
        .limit(1);
      if (empCheck.data && empCheck.data.length > 0) {
        signedInTenantId = (empCheck.data[0] as EmployeeLookup).tenant_id;
      }
    }

    if (signedInRole !== "superadmin" && await isTenantLoginBlocked(signedInTenantId)) {
      await auth.signOut();
      setUser(null);
      setRole(null);
      setTenantId(null);
      setIsManager(false);
      setCurrentEmployee(null);
      clearCapability();
      return { error: "This company account is suspended. Please contact TalentMesh support." };
    }

    // Guard: block pre-active employees at login with a specific, actionable message.
    // This runs after authentication succeeds so the error is unambiguous — the
    // credentials are correct but the account hasn't been activated by HR yet.
    if (signedInRole !== "superadmin" && signedInUser?.id && signedInTenantId) {
      const { data: empStatusRow } = await db
        .from("employees")
        .select("status")
        .eq("user_id", signedInUser.id)
        .eq("tenant_id", signedInTenantId)
        .maybeSingle();

      const empStatus = (empStatusRow as { status?: string } | null)?.status;

      if (empStatus === "draft" || empStatus === "pending_hr_review") {
        await auth.signOut();
        setUser(null);
        setRole(null);
        setTenantId(null);
        setIsManager(false);
        setCurrentEmployee(null);
        clearCapability();
        return {
          error:
            "Your account is pending HR activation. Please contact your HR team.",
        };
      }

      if (empStatus === "pending_onboarding") {
        await auth.signOut();
        setUser(null);
        setRole(null);
        setTenantId(null);
        setIsManager(false);
        setCurrentEmployee(null);
        clearCapability();
        return {
          error:
            "Your account setup is incomplete. Please check your email for an onboarding link, or contact your HR team.",
        };
      }
    }

    return { error: null };
  }, [clearCapability, refreshUser]);

  const verifyEmail = useCallback(async (email: string, otp: string) => {
    const { data, error } = await auth.verifyEmail({ email, otp });
    if (error || !data?.user) {
      return { error: error?.message ?? "Invalid code. Please try again." };
    }
    // Fetch full user with role metadata after verification
    await refreshUser(false); // silent - don't flash loading screen
    return { error: null };
  }, [refreshUser]);

  const logout = useCallback(async () => {
    await auth.signOut();
    setUser(null);
    setRole(null);
    setTenantId(null);
    setIsManager(false);
    setCurrentEmployee(null);
    clearCapability();
  }, [clearCapability]);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  const hasGrant = useCallback(
    (action: string, scopeType?: ScopeType | ScopeType[]) => {
      if (!capability || capability.membershipStatus !== "active" || capabilityUnavailableReason) return false;
      const acceptedScopes = scopeType === undefined
        ? null
        : new Set(Array.isArray(scopeType) ? scopeType : [scopeType]);
      return capability.grants.some(
        (grant) => grant.action === action && (!acceptedScopes || acceptedScopes.has(grant.scopeType)),
      );
    },
    [capability, capabilityUnavailableReason],
  );

  const canAccessMyWork = Boolean(capability?.employeeId) && hasGrant("employee.basic.read", "self");
  const canAccessTeam = hasGrant("employee.basic.read", ["direct_reports", "company"]);
  const canAccessAdministration =
    hasGrant("employee.write", "company") ||
    hasGrant("org.manage", "company") ||
    hasGrant("access.manage", "company");

  const value = useMemo(
    () => ({
      user,
      role,
      tenantId,
      loading,
      capability,
      capabilityLoading,
      capabilityUnavailableReason,
      hasGrant,
      canAccessMyWork,
      canAccessTeam,
      canAccessAdministration,
      isManager,
      currentEmployee,
      login,
      verifyEmail,
      logout,
      refreshUser,
      refreshCapabilities,
    }),
    [
      user, role, tenantId, loading, capability, capabilityLoading, capabilityUnavailableReason,
      hasGrant, canAccessMyWork, canAccessTeam, canAccessAdministration, isManager, currentEmployee,
      login, verifyEmail, logout, refreshUser, refreshCapabilities,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
