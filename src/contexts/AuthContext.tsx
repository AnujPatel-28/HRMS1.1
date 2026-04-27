/* eslint-disable react-hooks/set-state-in-effect */
/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { auth, db } from "../insforge/client";
import type { EmployeeRole } from "../types";

type AuthUser = {
  id: string;
  email?: string;
  metadata?: Record<string, unknown>;
  profile?: Record<string, unknown> | null;
};

type LoginResult =
  | { error: string; requiresVerification?: false }
  | { error: null; requiresVerification: true; email: string }
  | { error: null; requiresVerification?: false };

type AuthContextValue = {
  user: AuthUser | null;
  role: EmployeeRole | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  verifyEmail: (email: string, otp: string) => Promise<{ error: string | null }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const extractRole = (user: AuthUser | null): EmployeeRole | null => {
  if (!user) return null;
  const raw = user.metadata?.role ?? user.profile?.role;
  return raw === "hr" || raw === "employee" ? raw : null;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [role, setRole] = useState<EmployeeRole | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    const { data, error } = await auth.getCurrentUser();
    if (error || !data?.user) {
      setUser(null);
      setRole(null);
      if (showLoading) setLoading(false);
      return;
    }

    const nextUser = data.user as AuthUser;
    let resolvedRole = extractRole(nextUser);

    // Fallback: if no role in metadata/profile, check the employees DB table
    if (!resolvedRole) {
      const empCheck = await db
        .from("employees")
        .select("id")
        .eq("user_id", nextUser.id)
        .limit(1);
      if (empCheck.data && empCheck.data.length > 0) {
        resolvedRole = "employee";
      }
    }

    setUser(nextUser);
    setRole(resolvedRole);
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
    await refreshUser(false); // silent – don't flash loading screen
    return { error: null };
  }, [refreshUser]);

  const verifyEmail = useCallback(async (email: string, otp: string) => {
    const { data, error } = await auth.verifyEmail({ email, otp });
    if (error || !data?.user) {
      return { error: error?.message ?? "Invalid code. Please try again." };
    }
    // Fetch full user with role metadata after verification
    await refreshUser(false); // silent – don't flash loading screen
    return { error: null };
  }, [refreshUser]);

  const logout = useCallback(async () => {
    await auth.signOut();
    setUser(null);
    setRole(null);
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  const value = useMemo(
    () => ({ user, role, loading, login, verifyEmail, logout, refreshUser }),
    [user, role, loading, login, verifyEmail, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
