/* eslint-disable react-hooks/set-state-in-effect */
/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { auth, db } from "../insforge/client";
import type { EmployeeRole, Employee } from "../types";

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
  isManager: boolean;
  currentEmployee: Employee | null;
  login: (email: string, password: string) => Promise<LoginResult>;
  verifyEmail: (email: string, otp: string) => Promise<{ error: string | null }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [role, setRole] = useState<EmployeeRole | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [isManager, setIsManager] = useState(false);
  const [currentEmployee, setCurrentEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    const { data, error } = await auth.getCurrentUser();
    if (error || !data?.user) {
      setUser(null);
      setRole(null);
      setTenantId(null);
      setIsManager(false);
      setCurrentEmployee(null);
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
      if (showLoading) setLoading(false);
      return;
    }

    setUser(nextUser);
    setRole(resolvedRole);
    setTenantId(resolvedRole === "superadmin" ? null : resolvedTenantId);

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
  }, []);

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
        return {
          error:
            "Your account setup is incomplete. Please check your email for an onboarding link, or contact your HR team.",
        };
      }
    }

    return { error: null };
  }, [refreshUser]);

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
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  const value = useMemo(
    () => ({ user, role, tenantId, loading, isManager, currentEmployee, login, verifyEmail, logout, refreshUser }),
    [user, role, tenantId, loading, isManager, currentEmployee, login, verifyEmail, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
