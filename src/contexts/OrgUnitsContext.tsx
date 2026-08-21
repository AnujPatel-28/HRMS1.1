/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTenant } from "./TenantContext";
import { db } from "../insforge/client";
import { departmentLabel, type HasOrgUnit, type UnitNameLookup } from "../utils/departmentLabel";
import { jobTitleLabel, type HasJobTitle, type JobTitleLookup } from "../utils/jobTitleLabel";

/**
 * One tenant-wide `org_unit_id -> name` lookup, fetched once, so the ~25 screens that render an
 * employee's department do not each issue their own query.
 *
 * Deliberately NOT reusing `useOrgStructure()`: that hook filters `is_active = true`, which is right
 * for pickers (you should not be able to assign someone into a retired unit) and wrong for labels —
 * an employee already sitting in a deactivated unit must still render with that unit's name rather
 * than falling back to "—". This provider therefore fetches ALL units, active or not.
 */
type OrgUnitsContextValue = {
  unitNames: UnitNameLookup;
  jobTitles: JobTitleLookup;
  loading: boolean;
};

// Job titles ride along in this provider rather than getting their own: they are the same KIND of
// thing (tenant reference data resolved by id for display), they are needed by the same screens, and
// a second provider would mean a second round trip on every tenant screen for one extra small table.
const OrgUnitsContext = createContext<OrgUnitsContextValue>({ unitNames: {}, jobTitles: {}, loading: true });

export function OrgUnitsProvider({ children }: { children: ReactNode }) {
  const { tenantId } = useTenant();
  const [unitNames, setUnitNames] = useState<UnitNameLookup>({});
  const [jobTitles, setJobTitles] = useState<JobTitleLookup>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) {
      setUnitNames({});
      setJobTitles({});
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);

    void (async () => {
      const [unitsRes, titlesRes] = await Promise.all([
        db.from("org_units").select("id, name").eq("tenant_id", tenantId),
        // Inactive titles included for the same reason as inactive units: someone already holding a
        // retired title must still render with it rather than falling back to "—".
        db.from("job_titles").select("id, title").eq("tenant_id", tenantId),
      ]);
      const { data, error } = unitsRes;

      if (!active) return;

      if (error || titlesRes.error) {
        // Labels degrade to the fallback rather than blanking the screen. Not fatal: no screen's
        // primary content is the department name.
        console.error("Failed to load org lookups", error ?? titlesRes.error);
        setUnitNames({});
        setJobTitles({});
        setLoading(false);
        return;
      }

      const lookup: UnitNameLookup = {};
      for (const unit of (data ?? []) as { id: string; name: string }[]) {
        lookup[unit.id] = unit.name;
      }
      setUnitNames(lookup);

      const titleLookup: JobTitleLookup = {};
      for (const t of (titlesRes.data ?? []) as { id: string; title: string }[]) {
        titleLookup[t.id] = t.title;
      }
      setJobTitles(titleLookup);

      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [tenantId]);

  const value = useMemo(() => ({ unitNames, jobTitles, loading }), [unitNames, jobTitles, loading]);
  return <OrgUnitsContext.Provider value={value}>{children}</OrgUnitsContext.Provider>;
}

/** The raw lookup — for callers that resolve many rows at once, or pass it to non-React helpers. */
export function useUnitNames(): UnitNameLookup {
  return useContext(OrgUnitsContext).unitNames;
}

/**
 * The common case: `const deptLabel = useDepartmentLabel();` then `deptLabel(employee)`.
 * Pass a second argument to override the "—" fallback, e.g. `deptLabel(emp, "No department")`.
 */
export function useDepartmentLabel() {
  const { unitNames } = useContext(OrgUnitsContext);
  return useCallback(
    (employee: HasOrgUnit, fallback = "—") => departmentLabel(employee, unitNames, fallback),
    [unitNames],
  );
}

/** The raw job-title lookup — for callers resolving many rows, or passing it to non-React helpers. */
export function useJobTitles(): JobTitleLookup {
  return useContext(OrgUnitsContext).jobTitles;
}

/** `const titleLabel = useJobTitleLabel();` then `titleLabel(employee)` — mirrors useDepartmentLabel. */
export function useJobTitleLabel() {
  const { jobTitles } = useContext(OrgUnitsContext);
  return useCallback(
    (employee: HasJobTitle, fallback = "—") => jobTitleLabel(employee, jobTitles, fallback),
    [jobTitles],
  );
}
