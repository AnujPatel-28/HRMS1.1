import { useEffect, useMemo, useState } from "react";
import { useTenant } from "../contexts/TenantContext";
import { db } from "../insforge/client";
import type { EmploymentTypeOption, JobTitle, OrgUnit, WorkLocation } from "../types";

interface OrgStructureState {
  orgUnits: OrgUnit[];
  jobTitles: JobTitle[];
  locations: WorkLocation[];
  employmentTypes: EmploymentTypeOption[];
  loading: boolean;
  error: string | null;
}

const initialState: OrgStructureState = {
  orgUnits: [],
  jobTitles: [],
  locations: [],
  employmentTypes: [],
  loading: true,
  error: null,
};

export function useOrgStructure() {
  const { tenantId } = useTenant();
  const [state, setState] = useState<OrgStructureState>(initialState);

  useEffect(() => {
    if (!tenantId) {
      setState({ ...initialState, loading: false });
      return;
    }

    let active = true;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    const fetchOrgStructure = async () => {
      try {
        const [orgUnitsRes, jobTitlesRes, locationsRes, employmentTypesRes] = await Promise.all([
          db.from("org_units").select("*").eq("tenant_id", tenantId).eq("is_active", true).order("name", { ascending: true }),
          db.from("job_titles").select("*").eq("tenant_id", tenantId).eq("is_active", true).order("title", { ascending: true }),
          db.from("locations").select("*").eq("tenant_id", tenantId).eq("is_active", true).order("name", { ascending: true }),
          db.from("employment_types").select("*").eq("tenant_id", tenantId).eq("is_active", true).order("name", { ascending: true }),
        ]);

        const firstError = orgUnitsRes.error ?? jobTitlesRes.error ?? locationsRes.error ?? employmentTypesRes.error;
        if (firstError) throw firstError;

        if (active) {
          setState({
            orgUnits: (orgUnitsRes.data ?? []) as OrgUnit[],
            jobTitles: (jobTitlesRes.data ?? []) as JobTitle[],
            locations: (locationsRes.data ?? []) as WorkLocation[],
            employmentTypes: (employmentTypesRes.data ?? []) as EmploymentTypeOption[],
            loading: false,
            error: null,
          });
        }
      } catch (err) {
        console.error("Failed to load org structure", err);
        if (active) {
          setState({ ...initialState, loading: false, error: "Failed to load organization structure." });
        }
      }
    };

    void fetchOrgStructure();

    return () => {
      active = false;
    };
  }, [tenantId]);

  return useMemo(() => state, [state]);
}