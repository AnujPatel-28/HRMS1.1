export type ScopeType = "self" | "direct_reports" | "company" | "project" | "channel";

export type Grant = {
  action: string;
  scopeType: ScopeType;
  scopeId?: string;
};

export type CapabilitySummary = {
  tenantId: string;
  // P1-02 must use the same md5(tenant_id::text || ':' || user_id::text)::uuid
  // expression as its membership primary-key default so this derived id remains stable.
  membershipId: string;
  membershipStatus: "active" | "suspended" | "revoked";
  employeeId: string | null;
  accessVersion: number;
  responsibilities: string[];
  grants: Grant[];
  enabledModules: string[];
  unavailableReason: string | null;
  issuedAt: string;
  contractVersion: "v0.5";
};
