import { useEffect, useMemo, useState } from "react";
import { Building2, BriefcaseBusiness, Layers, Loader2, MapPin, Network, Plus, Save, UsersRound } from "lucide-react";
import { db } from "../insforge/client";
import { useTenant } from "../contexts/TenantContext";
import { useToast } from "../shared/ToastContext";
import { useAuditLog } from "../hooks/useAuditLog";
import type { EmployeeGrade, EmploymentTypeOption, JobTitle, OrgUnit, OrgUnitType, WorkLocation } from "../types";

type TabKey = "org_units" | "unit_types" | "job_titles" | "grades" | "locations" | "employment_types";

type OrgUnitForm = {
  id?: string;
  name: string;
  unit_type: OrgUnit["unit_type"];
  type_id: string;
  head_employee_id: string;
  code: string;
  description: string;
  parent_id: string;
  is_active: boolean;
};

type OrgUnitTypeForm = {
  id?: string;
  name: string;
  structural_role: OrgUnitType["structural_role"];
  level_order: string;
  is_active: boolean;
};

type EmployeeGradeForm = {
  id?: string;
  name: string;
  level: string;
  default_notice_days: string;
  default_probation_months: string;
  is_active: boolean;
};

type JobTitleForm = {
  id?: string;
  title: string;
  grade: string;
  level: string;
  description: string;
  is_active: boolean;
};

type EmploymentTypeForm = {
  id?: string;
  name: string;
  code: string;
  is_active: boolean;
};

type LocationForm = {
  id?: string;
  name: string;
  country: string;
  state: string;
  city: string;
  timezone: string;
  is_active: boolean;
};

const emptyOrgUnit: OrgUnitForm = {
  name: "",
  unit_type: "department",
  type_id: "",
  head_employee_id: "",
  code: "",
  description: "",
  parent_id: "",
  is_active: true,
};

const emptyOrgUnitType: OrgUnitTypeForm = {
  name: "",
  structural_role: "department",
  level_order: "",
  is_active: true,
};

const emptyEmployeeGrade: EmployeeGradeForm = {
  name: "",
  level: "",
  default_notice_days: "",
  default_probation_months: "",
  is_active: true,
};

const emptyJobTitle: JobTitleForm = {
  title: "",
  grade: "",
  level: "",
  description: "",
  is_active: true,
};

const emptyEmploymentType: EmploymentTypeForm = {
  name: "",
  code: "",
  is_active: true,
};

const emptyLocation: LocationForm = {
  name: "",
  country: "",
  state: "",
  city: "",
  timezone: "",
  is_active: true,
};

const tabs = [
  { key: "org_units", label: "Org Units", icon: Building2 },
  { key: "unit_types", label: "Unit Types", icon: Network },
  { key: "job_titles", label: "Job Titles", icon: BriefcaseBusiness },
  { key: "grades", label: "Grades", icon: Layers },
  { key: "locations", label: "Locations", icon: MapPin },
  { key: "employment_types", label: "Employment Types", icon: UsersRound },
] as const;

const structuralRoles: OrgUnitType["structural_role"][] = ["division", "department", "team"];

function statusBadge(isActive: boolean) {
  return isActive
    ? "bg-emerald-50 text-emerald-700 border-emerald-100"
    : "bg-slate-50 text-slate-500 border-slate-200";
}

/**
 * An RLS refusal is not an error. PostgREST matches zero rows and answers 200 with an empty array, so
 * a save that inspects only `error` reports "Saved" while the database is unchanged. Every write that
 * goes through here chains `.select()` and treats an empty result as a refusal — the same fix applied
 * in src/admin/TenantModulesPanel.tsx.
 */
function rowsOrThrow(result: { data: unknown; error: unknown }, refusal: string): any[] {
  if (result.error) throw result.error;
  const rows = (result.data ?? []) as any[];
  if (rows.length === 0) throw new Error(refusal);
  return rows;
}

export default function OrgStructureManagement() {
  const { tenantId } = useTenant();
  const { success, error: toastError } = useToast();
  const { logAction } = useAuditLog();

  const [activeTab, setActiveTab] = useState<TabKey>("org_units");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);
  const [unitTypes, setUnitTypes] = useState<OrgUnitType[]>([]);
  const [jobTitles, setJobTitles] = useState<JobTitle[]>([]);
  const [grades, setGrades] = useState<EmployeeGrade[]>([]);
  const [locations, setLocations] = useState<WorkLocation[]>([]);
  const [employmentTypes, setEmploymentTypes] = useState<EmploymentTypeOption[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "archived">("all");

  const [orgUnitForm, setOrgUnitForm] = useState<OrgUnitForm>(emptyOrgUnit);
  const [unitTypeForm, setUnitTypeForm] = useState<OrgUnitTypeForm>(emptyOrgUnitType);
  const [jobTitleForm, setJobTitleForm] = useState<JobTitleForm>(emptyJobTitle);
  const [gradeForm, setGradeForm] = useState<EmployeeGradeForm>(emptyEmployeeGrade);
  const [locationForm, setLocationForm] = useState<LocationForm>(emptyLocation);
  const [employmentTypeForm, setEmploymentTypeForm] = useState<EmploymentTypeForm>(emptyEmploymentType);

  const activeOrgUnits = useMemo(() => orgUnits.filter((unit) => unit.is_active), [orgUnits]);

  // Compute active employee usage counts for all lookups
  const usageCounts = useMemo(() => {
    const orgUnitMap = new Map<string, number>();
    const jobTitleMap = new Map<string, number>();
    const locationMap = new Map<string, number>();
    const employmentTypeMap = new Map<string, number>();
    const gradeMap = new Map<string, number>();
    const unitTypeMap = new Map<string, number>();

    employees.forEach((emp) => {
      if (emp.status === "active") {
        if (emp.org_unit_id) orgUnitMap.set(emp.org_unit_id, (orgUnitMap.get(emp.org_unit_id) || 0) + 1);
        if (emp.job_title_id) jobTitleMap.set(emp.job_title_id, (jobTitleMap.get(emp.job_title_id) || 0) + 1);
        if (emp.location_id) locationMap.set(emp.location_id, (locationMap.get(emp.location_id) || 0) + 1);
        if (emp.employment_type_id) employmentTypeMap.set(emp.employment_type_id, (employmentTypeMap.get(emp.employment_type_id) || 0) + 1);
        if (emp.grade_id) gradeMap.set(emp.grade_id, (gradeMap.get(emp.grade_id) || 0) + 1);
      }
    });

    // A unit type is used by UNITS, not employees, and archived units are counted too: an archived unit
    // still holds the type_id FK, so counting only active ones would let an admin archive the units,
    // change structural_role, and restore them — the silent re-scoping the §4 guardrail exists to stop.
    orgUnits.forEach((unit) => {
      if (unit.type_id) unitTypeMap.set(unit.type_id, (unitTypeMap.get(unit.type_id) || 0) + 1);
    });

    return { orgUnit: orgUnitMap, jobTitle: jobTitleMap, location: locationMap, employmentType: employmentTypeMap, grade: gradeMap, unitType: unitTypeMap };
  }, [employees, orgUnits]);

  const employeeNameById = useMemo(
    () => new Map<string, string>(employees.map((emp) => [emp.id as string, (emp.full_name as string) ?? ""])),
    [employees]
  );

  const unitTypeById = useMemo(() => new Map(unitTypes.map((type) => [type.id, type])), [unitTypes]);

  // Reset search and status filter on tab change to prevent confusing empty lists
  useEffect(() => {
    setSearchQuery("");
    setStatusFilter("all");
  }, [activeTab]);

  const fetchLookups = async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const [orgUnitsRes, unitTypesRes, jobTitlesRes, gradesRes, locationsRes, employmentTypesRes, employeesRes] = await Promise.all([
        db.from("org_units").select("*").eq("tenant_id", tenantId).order("name", { ascending: true }),
        db.from("org_unit_types").select("*").eq("tenant_id", tenantId).order("level_order", { ascending: true }),
        db.from("job_titles").select("*").eq("tenant_id", tenantId).order("title", { ascending: true }),
        db.from("employee_grades").select("*").eq("tenant_id", tenantId).order("level", { ascending: true }),
        db.from("locations").select("*").eq("tenant_id", tenantId).order("name", { ascending: true }),
        db.from("employment_types").select("*").eq("tenant_id", tenantId).order("name", { ascending: true }),
        db.from("employees").select("id, full_name, status, org_unit_id, job_title_id, location_id, employment_type_id, grade_id").eq("tenant_id", tenantId),
      ]);

      const firstError = orgUnitsRes.error ?? unitTypesRes.error ?? jobTitlesRes.error ?? gradesRes.error ?? locationsRes.error ?? employmentTypesRes.error ?? employeesRes.error;
      if (firstError) throw firstError;

      setOrgUnits((orgUnitsRes.data ?? []) as OrgUnit[]);
      setUnitTypes((unitTypesRes.data ?? []) as OrgUnitType[]);
      setJobTitles((jobTitlesRes.data ?? []) as JobTitle[]);
      setGrades((gradesRes.data ?? []) as EmployeeGrade[]);
      setLocations((locationsRes.data ?? []) as WorkLocation[]);
      setEmploymentTypes((employmentTypesRes.data ?? []) as EmploymentTypeOption[]);
      setEmployees((employeesRes.data ?? []) as any[]);
    } catch (err) {
      console.error(err);
      toastError("Failed to load organization setup.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchLookups();
  }, [tenantId]);

  const saveOrgUnit = async () => {
    if (!tenantId || !orgUnitForm.name.trim()) {
      toastError("Org unit name is required.");
      return;
    }
    // A unit's type can be changed but never cleared. type_id is what the system reasons about, and a
    // null type sitting next to a legacy `unit_type` text is exactly the two-sources-of-truth drift
    // this module exists to remove. Skipped only if the tenant has no active type to pick — never the
    // case for a preseeded tenant, but it must not make the screen unusable if it happens.
    if (!orgUnitForm.type_id && unitTypes.some((type) => type.is_active)) {
      toastError("Unit type is required.");
      return;
    }
    setSaving(true);
    try {
      const selectedType = unitTypes.find((type) => type.id === orgUnitForm.type_id);
      const payload = {
        tenant_id: tenantId,
        name: orgUnitForm.name.trim(),
        // The deployed SPA still reads the legacy `unit_type` text — Directory, EmployeeList,
        // EmployeeCreate and EmployeeDetail all filter it with `=== "department"`. Keep writing it,
        // derived from the chosen type's structural_role so those screens keep classifying units
        // correctly. Dropping the column is a separate, deploy-gated step (06-... §5 step 6).
        unit_type: selectedType ? selectedType.structural_role : orgUnitForm.unit_type,
        type_id: orgUnitForm.type_id || null,
        head_employee_id: orgUnitForm.head_employee_id || null,
        code: orgUnitForm.code.trim() || null,
        description: orgUnitForm.description.trim() || null,
        // Always sent, never narrowed to changed fields: both path triggers are scoped to
        // `UPDATE OF parent_id`, so omitting it would leave `path` stale.
        parent_id: orgUnitForm.parent_id || null,
        is_active: orgUnitForm.is_active,
      };

      const result = orgUnitForm.id
        ? await db.from("org_units").update(payload).eq("tenant_id", tenantId).eq("id", orgUnitForm.id).select()
        : await db.from("org_units").insert([payload]).select();

      const savedRows = rowsOrThrow(result, "Org unit was not saved — the write was rejected.");
      const savedId = orgUnitForm.id ?? savedRows[0]?.id;
      const action = orgUnitForm.id ? "org_unit.updated" : "org_unit.created";
      void logAction(action, "org_units", savedId, { name: orgUnitForm.name.trim() });
      success(orgUnitForm.id ? "Org unit updated." : "Org unit created.");
      setOrgUnitForm(emptyOrgUnit);
      void fetchLookups();
    } catch (err: any) {
      toastError(err.message || "Failed to save org unit.");
    } finally {
      setSaving(false);
    }
  };

  const saveUnitType = async () => {
    if (!tenantId || !unitTypeForm.name.trim()) {
      toastError("Unit type name is required.");
      return;
    }
    const levelOrder = Number(unitTypeForm.level_order);
    if (!unitTypeForm.level_order.trim() || !Number.isInteger(levelOrder)) {
      toastError("Level order must be a whole number.");
      return;
    }
    setSaving(true);
    try {
      // §4 guardrail: structural_role is what approval routing and policy scoping key off, so it must
      // not change under live data. Once ANY unit references this type the column is left out of the
      // payload entirely — an update that does not carry the column cannot change it, which is a
      // stronger guarantee than validating a value we still send.
      const roleLocked = Boolean(unitTypeForm.id) && (usageCounts.unitType.get(unitTypeForm.id!) || 0) > 0;
      const payload = {
        tenant_id: tenantId,
        name: unitTypeForm.name.trim(),
        ...(roleLocked ? {} : { structural_role: unitTypeForm.structural_role }),
        level_order: levelOrder,
        is_active: unitTypeForm.is_active,
      };

      const result = unitTypeForm.id
        ? await db.from("org_unit_types").update(payload).eq("tenant_id", tenantId).eq("id", unitTypeForm.id).select()
        : await db.from("org_unit_types").insert([payload]).select();

      const savedRows = rowsOrThrow(result, "Unit type was not saved — the write was rejected.");
      const savedId = unitTypeForm.id ?? savedRows[0]?.id;
      const action = unitTypeForm.id ? "org_unit_type.updated" : "org_unit_type.created";
      void logAction(action, "org_unit_types", savedId, { name: unitTypeForm.name.trim(), structural_role_locked: roleLocked });
      success(unitTypeForm.id ? "Unit type updated." : "Unit type created.");
      setUnitTypeForm(emptyOrgUnitType);
      void fetchLookups();
    } catch (err: any) {
      toastError(err.message || "Failed to save unit type.");
    } finally {
      setSaving(false);
    }
  };

  const saveJobTitle = async () => {
    if (!tenantId || !jobTitleForm.title.trim()) {
      toastError("Job title is required.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        tenant_id: tenantId,
        title: jobTitleForm.title.trim(),
        grade: jobTitleForm.grade.trim() || null,
        level: jobTitleForm.level.trim() || null,
        description: jobTitleForm.description.trim() || null,
        is_active: jobTitleForm.is_active,
      };

      const result = jobTitleForm.id
        ? await db.from("job_titles").update(payload).eq("tenant_id", tenantId).eq("id", jobTitleForm.id)
        : await db.from("job_titles").insert([payload]);

      if (result.error) throw result.error;
      const savedId = jobTitleForm.id ?? (result as any).data?.[0]?.id;
      const action = jobTitleForm.id ? "job_title.updated" : "job_title.created";
      void logAction(action, "job_titles", savedId, { title: jobTitleForm.title.trim() });
      success(jobTitleForm.id ? "Job title updated." : "Job title created.");
      setJobTitleForm(emptyJobTitle);
      void fetchLookups();
    } catch (err: any) {
      toastError(err.message || "Failed to save job title.");
    } finally {
      setSaving(false);
    }
  };

  const saveGrade = async () => {
    if (!tenantId || !gradeForm.name.trim()) {
      toastError("Grade name is required.");
      return;
    }
    const level = Number(gradeForm.level);
    if (!gradeForm.level.trim() || !Number.isInteger(level)) {
      toastError("Level must be a whole number.");
      return;
    }
    const noticeDays = gradeForm.default_notice_days.trim() ? Number(gradeForm.default_notice_days) : null;
    const probationMonths = gradeForm.default_probation_months.trim() ? Number(gradeForm.default_probation_months) : null;
    if ((noticeDays !== null && !Number.isInteger(noticeDays)) || (probationMonths !== null && !Number.isInteger(probationMonths))) {
      toastError("Notice days and probation months must be whole numbers.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        tenant_id: tenantId,
        name: gradeForm.name.trim(),
        level,
        default_notice_days: noticeDays,
        default_probation_months: probationMonths,
        is_active: gradeForm.is_active,
      };

      const result = gradeForm.id
        ? await db.from("employee_grades").update(payload).eq("tenant_id", tenantId).eq("id", gradeForm.id).select()
        : await db.from("employee_grades").insert([payload]).select();

      const savedRows = rowsOrThrow(result, "Grade was not saved — the write was rejected.");
      const savedId = gradeForm.id ?? savedRows[0]?.id;
      const action = gradeForm.id ? "employee_grade.updated" : "employee_grade.created";
      void logAction(action, "employee_grades", savedId, { name: gradeForm.name.trim() });
      success(gradeForm.id ? "Grade updated." : "Grade created.");
      setGradeForm(emptyEmployeeGrade);
      void fetchLookups();
    } catch (err: any) {
      toastError(err.message || "Failed to save grade.");
    } finally {
      setSaving(false);
    }
  };

  const saveEmploymentType = async () => {
    if (!tenantId || !employmentTypeForm.name.trim() || !employmentTypeForm.code.trim()) {
      toastError("Employment type name and code are required.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        tenant_id: tenantId,
        name: employmentTypeForm.name.trim(),
        code: employmentTypeForm.code.trim().toLowerCase().replace(/\s+/g, "_"),
        is_active: employmentTypeForm.is_active,
      };

      const result = employmentTypeForm.id
        ? await db.from("employment_types").update(payload).eq("tenant_id", tenantId).eq("id", employmentTypeForm.id)
        : await db.from("employment_types").insert([payload]);

      if (result.error) throw result.error;
      const savedId = employmentTypeForm.id ?? (result as any).data?.[0]?.id;
      const action = employmentTypeForm.id ? "employment_type.updated" : "employment_type.created";
      void logAction(action, "employment_types", savedId, { name: employmentTypeForm.name.trim() });
      success(employmentTypeForm.id ? "Employment type updated." : "Employment type created.");
      setEmploymentTypeForm(emptyEmploymentType);
      void fetchLookups();
    } catch (err: any) {
      toastError(err.message || "Failed to save employment type.");
    } finally {
      setSaving(false);
    }
  };

  const saveLocation = async () => {
    if (!tenantId || !locationForm.name.trim()) {
      toastError("Location name is required.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        tenant_id: tenantId,
        name: locationForm.name.trim(),
        country: locationForm.country.trim() || null,
        state: locationForm.state.trim() || null,
        city: locationForm.city.trim() || null,
        timezone: locationForm.timezone.trim() || null,
        is_active: locationForm.is_active,
      };

      const result = locationForm.id
        ? await db.from("locations").update(payload).eq("tenant_id", tenantId).eq("id", locationForm.id)
        : await db.from("locations").insert([payload]);

      if (result.error) throw result.error;
      const savedId = locationForm.id ?? (result as any).data?.[0]?.id;
      const action = locationForm.id ? "location.updated" : "location.created";
      void logAction(action, "locations", savedId, { name: locationForm.name.trim() });
      success(locationForm.id ? "Location updated." : "Location created.");
      setLocationForm(emptyLocation);
      void fetchLookups();
    } catch (err: any) {
      toastError(err.message || "Failed to save location.");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (table: "org_units" | "org_unit_types" | "job_titles" | "employee_grades" | "locations" | "employment_types", id: string, isActive: boolean) => {
    if (!tenantId) return;
    setSaving(true);
    try {
      if (isActive) {
        let count = 0;
        if (table === "org_units") count = usageCounts.orgUnit.get(id) || 0;
        else if (table === "org_unit_types") count = usageCounts.unitType.get(id) || 0;
        else if (table === "job_titles") count = usageCounts.jobTitle.get(id) || 0;
        else if (table === "employee_grades") count = usageCounts.grade.get(id) || 0;
        else if (table === "locations") count = usageCounts.location.get(id) || 0;
        else if (table === "employment_types") count = usageCounts.employmentType.get(id) || 0;

        if (count > 0) {
          const confirmArchive = table === "org_unit_types"
            ? window.confirm(
                `This type is currently used by ${count} org unit(s). Archiving hides it from the unit form, but those units keep it. Do you want to proceed?`
              )
            : window.confirm(
                `This item is currently referenced by ${count} active employee(s). Archiving will hide it from selection lists, but existing employee records will remain unchanged. Do you want to proceed?`
              );
          if (!confirmArchive) {
            setSaving(false);
            return;
          }
        }
      }

      const result = await db.from(table).update({ is_active: !isActive }).eq("tenant_id", tenantId).eq("id", id).select();
      rowsOrThrow(result, "Status was not changed — the write was rejected.");
      // Derive event name: table name → prefix, isActive=true means it was active and is now being archived
      const tablePrefix = table.replace(/_s$/, "").replace(/_types$/, "_type");
      const toggleAction = isActive ? `${tablePrefix}.archived` : `${tablePrefix}.restored`;
      void logAction(toggleAction, table, id, { was_active: isActive });
      success(isActive ? "Lookup archived." : "Lookup restored.");
      void fetchLookups();
    } catch (err: any) {
      toastError(err.message || "Failed to update lookup status.");
    } finally {
      setSaving(false);
    }
  };

  const getOrgUnitDepth = (unit: OrgUnit, allUnits: OrgUnit[]): number => {
    let depth = 0;
    let parentId = unit.parent_id;
    const visited = new Set<string>();
    while (parentId) {
      if (visited.has(parentId)) break;
      visited.add(parentId);
      const parent = allUnits.find((u) => u.id === parentId);
      if (parent) {
        depth++;
        parentId = parent.parent_id;
      } else {
        break;
      }
    }
    return depth;
  };

  const sortHierarchically = (units: OrgUnit[]): OrgUnit[] => {
    const roots = units.filter((u) => !u.parent_id || !units.some((p) => p.id === u.parent_id));
    const childrenMap = new Map<string, OrgUnit[]>();
    units.forEach((u) => {
      if (u.parent_id) {
        const list = childrenMap.get(u.parent_id) || [];
        list.push(u);
        childrenMap.set(u.parent_id, list);
      }
    });

    const result: OrgUnit[] = [];
    const traverse = (node: OrgUnit) => {
      result.push(node);
      const children = childrenMap.get(node.id) || [];
      children.sort((a, b) => a.name.localeCompare(b.name));
      children.forEach(traverse);
    };

    roots.sort((a, b) => a.name.localeCompare(b.name));
    roots.forEach(traverse);

    units.forEach((u) => {
      if (!result.some((r) => r.id === u.id)) {
        result.push(u);
      }
    });

    return result;
  };

  const filteredOrgUnits = useMemo(() => {
    const sorted = sortHierarchically(orgUnits);
    return sorted.filter((unit) => {
      const matchesSearch =
        unit.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (unit.code || "").toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus =
        statusFilter === "all" ? true : statusFilter === "active" ? unit.is_active : !unit.is_active;
      return matchesSearch && matchesStatus;
    });
  }, [orgUnits, searchQuery, statusFilter]);

  const filteredUnitTypes = useMemo(() => {
    return unitTypes.filter((type) => {
      const matchesSearch =
        type.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        type.structural_role.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus =
        statusFilter === "all" ? true : statusFilter === "active" ? type.is_active : !type.is_active;
      return matchesSearch && matchesStatus;
    });
  }, [unitTypes, searchQuery, statusFilter]);

  const filteredGrades = useMemo(() => {
    return grades.filter((grade) => {
      const matchesSearch = grade.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus =
        statusFilter === "all" ? true : statusFilter === "active" ? grade.is_active : !grade.is_active;
      return matchesSearch && matchesStatus;
    });
  }, [grades, searchQuery, statusFilter]);

  const filteredJobTitles = useMemo(() => {
    return jobTitles.filter((title) => {
      const matchesSearch =
        title.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (title.grade || "").toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus =
        statusFilter === "all" ? true : statusFilter === "active" ? title.is_active : !title.is_active;
      return matchesSearch && matchesStatus;
    });
  }, [jobTitles, searchQuery, statusFilter]);

  const filteredLocations = useMemo(() => {
    return locations.filter((loc) => {
      const matchesSearch =
        loc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (loc.city || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (loc.state || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (loc.country || "").toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus =
        statusFilter === "all" ? true : statusFilter === "active" ? loc.is_active : !loc.is_active;
      return matchesSearch && matchesStatus;
    });
  }, [locations, searchQuery, statusFilter]);

  const filteredEmploymentTypes = useMemo(() => {
    return employmentTypes.filter((type) => {
      const matchesSearch =
        type.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        type.code.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus =
        statusFilter === "all" ? true : statusFilter === "active" ? type.is_active : !type.is_active;
      return matchesSearch && matchesStatus;
    });
  }, [employmentTypes, searchQuery, statusFilter]);

  const renderOrgUnits = () => (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Head</th>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredOrgUnits.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-10 text-center text-slate-500 font-semibold">
                  No org units found.
                </td>
              </tr>
            ) : (
              filteredOrgUnits.map((unit) => {
                const depth = getOrgUnitDepth(unit, orgUnits);
                const count = usageCounts.orgUnit.get(unit.id) || 0;
                const unitType = unit.type_id ? unitTypeById.get(unit.type_id) : undefined;
                return (
                  <tr key={unit.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <div style={{ paddingLeft: `${depth * 1.25}rem` }} className="flex items-center gap-1.5">
                        {depth > 0 && <span className="text-slate-300">└─</span>}
                        <span className="font-semibold text-slate-900">{unit.name}</span>
                        {count > 0 ? (
                          <span className="inline-flex items-center rounded-full bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold text-blue-600">
                            {count} active
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-slate-50 px-1.5 py-0.5 text-[9px] font-bold text-slate-400">
                            0 active
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {unitType ? (
                        <span className="flex flex-col">
                          <span className="font-semibold text-slate-700">{unitType.name}</span>
                          <span className="text-[10px] uppercase tracking-wider text-slate-400">{unitType.structural_role}</span>
                        </span>
                      ) : (
                        <span className="capitalize text-slate-400">{unit.unit_type.replace("_", " ")}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {unit.head_employee_id
                        ? employeeNameById.get(unit.head_employee_id) || "Unknown"
                        : <span className="text-slate-400">Not set</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{unit.code || "-"}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusBadge(unit.is_active)}`}>
                        {unit.is_active ? "Active" : "Archived"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button type="button" onClick={() => setOrgUnitForm({
                        id: unit.id,
                        name: unit.name,
                        unit_type: unit.unit_type,
                        type_id: unit.type_id ?? "",
                        head_employee_id: unit.head_employee_id ?? "",
                        code: unit.code ?? "",
                        description: unit.description ?? "",
                        parent_id: unit.parent_id ?? "",
                        is_active: unit.is_active,
                      })} className="mr-3 text-xs font-bold text-brand-600 hover:underline">
                        Edit
                      </button>
                      <button type="button" onClick={() => toggleActive("org_units", unit.id, unit.is_active)} className="text-xs font-bold text-slate-500 hover:text-slate-800">
                        {unit.is_active ? "Archive" : "Restore"}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
        <h3 className="font-bold text-slate-900">{orgUnitForm.id ? "Edit Org Unit" : "Add Org Unit"}</h3>
        <input value={orgUnitForm.name} onChange={(e) => setOrgUnitForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Department / team name" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500/20" />
        <select value={orgUnitForm.type_id} onChange={(e) => setOrgUnitForm((prev) => ({ ...prev, type_id: e.target.value }))} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none">
          {!orgUnitForm.type_id && <option value="">Select unit type</option>}
          {unitTypes.filter((type) => type.is_active || type.id === orgUnitForm.type_id).map((type) => (
            <option key={type.id} value={type.id}>{type.name} ({type.structural_role})</option>
          ))}
        </select>
        <select value={orgUnitForm.parent_id} onChange={(e) => setOrgUnitForm((prev) => ({ ...prev, parent_id: e.target.value }))} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none">
          <option value="">No parent</option>
          {activeOrgUnits.filter((unit) => unit.id !== orgUnitForm.id).map((unit) => (
            <option key={unit.id} value={unit.id}>{unit.name}</option>
          ))}
        </select>
        {/* The approval engine's dept_head step and the task-submission notification walk both resolve
            against this. Inactive employees stay listed only when they are the unit's current head, so
            editing an unrelated field cannot silently clear it. */}
        <select value={orgUnitForm.head_employee_id} onChange={(e) => setOrgUnitForm((prev) => ({ ...prev, head_employee_id: e.target.value }))} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none">
          <option value="">No unit head</option>
          {employees
            .filter((emp) => emp.status === "active" || emp.id === orgUnitForm.head_employee_id)
            .sort((a, b) => (a.full_name || "").localeCompare(b.full_name || ""))
            .map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.full_name}{emp.status === "active" ? "" : " (inactive)"}
              </option>
            ))}
        </select>
        <input value={orgUnitForm.code} onChange={(e) => setOrgUnitForm((prev) => ({ ...prev, code: e.target.value }))} placeholder="Optional code" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none" />
        <textarea value={orgUnitForm.description} onChange={(e) => setOrgUnitForm((prev) => ({ ...prev, description: e.target.value }))} placeholder="Description" rows={3} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none" />
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input type="checkbox" checked={orgUnitForm.is_active} onChange={(e) => setOrgUnitForm((prev) => ({ ...prev, is_active: e.target.checked }))} />
          Active
        </label>
        <button type="button" disabled={saving} onClick={saveOrgUnit} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
          <Save className="h-4 w-4" />
          Save Org Unit
        </button>
      </div>
    </div>
  );

  const renderUnitTypes = () => {
    const unitsUsingEdited = unitTypeForm.id ? usageCounts.unitType.get(unitTypeForm.id) || 0 : 0;
    return (
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Structural Role</th>
                <th className="px-4 py-3">Level</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredUnitTypes.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-slate-500 font-semibold">
                    No unit types found.
                  </td>
                </tr>
              ) : (
                filteredUnitTypes.map((type) => {
                  const count = usageCounts.unitType.get(type.id) || 0;
                  return (
                    <tr key={type.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-slate-900">{type.name}</span>
                          {count > 0 ? (
                            <span className="inline-flex items-center rounded-full bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold text-blue-600">
                              {count} unit{count === 1 ? "" : "s"}
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-slate-50 px-1.5 py-0.5 text-[9px] font-bold text-slate-400">
                              0 units
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 capitalize text-slate-600">{type.structural_role}</td>
                      <td className="px-4 py-3 text-slate-500">{type.level_order}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusBadge(type.is_active)}`}>
                          {type.is_active ? "Active" : "Archived"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button type="button" onClick={() => setUnitTypeForm({
                          id: type.id,
                          name: type.name,
                          structural_role: type.structural_role,
                          level_order: String(type.level_order),
                          is_active: type.is_active,
                        })} className="mr-3 text-xs font-bold text-brand-600 hover:underline">
                          Edit
                        </button>
                        <button type="button" onClick={() => toggleActive("org_unit_types", type.id, type.is_active)} className="text-xs font-bold text-slate-500 hover:text-slate-800">
                          {type.is_active ? "Archive" : "Restore"}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
          <h3 className="font-bold text-slate-900">{unitTypeForm.id ? "Edit Unit Type" : "Add Unit Type"}</h3>
          <p className="text-xs text-slate-500">
            Name the level the way your company says it — "Practice", "Chapter", "Vertical". The structural
            role is what approval routing and policy scoping read, so it stays one of division, department
            or team.
          </p>
          <input value={unitTypeForm.name} onChange={(e) => setUnitTypeForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="e.g. Practice" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none" />
          <select
            value={unitTypeForm.structural_role}
            disabled={unitsUsingEdited > 0}
            onChange={(e) => setUnitTypeForm((prev) => ({ ...prev, structural_role: e.target.value as OrgUnitType["structural_role"] }))}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none disabled:bg-slate-50 disabled:text-slate-500"
          >
            {structuralRoles.map((role) => (
              <option key={role} value={role}>{role}</option>
            ))}
          </select>
          {unitsUsingEdited > 0 && (
            <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {unitsUsingEdited} org unit{unitsUsingEdited === 1 ? "" : "s"} already use this type, so its
              structural role is locked — changing it would silently re-scope approvals and policies.
              Renaming it is safe. To use a different role, create a new type and move the units.
            </p>
          )}
          <input value={unitTypeForm.level_order} onChange={(e) => setUnitTypeForm((prev) => ({ ...prev, level_order: e.target.value }))} placeholder="Level order, e.g. 2" inputMode="numeric" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none" />
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={unitTypeForm.is_active} onChange={(e) => setUnitTypeForm((prev) => ({ ...prev, is_active: e.target.checked }))} />
            Active
          </label>
          <button type="button" disabled={saving} onClick={saveUnitType} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
            <Save className="h-4 w-4" />
            Save Unit Type
          </button>
          {unitTypeForm.id && (
            <button type="button" onClick={() => setUnitTypeForm(emptyOrgUnitType)} className="w-full text-xs font-bold text-slate-500 hover:text-slate-800">
              Cancel edit
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderJobTitles = () => (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Grade</th>
              <th className="px-4 py-3">Level</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredJobTitles.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-10 text-center text-slate-500 font-semibold">
                  No job titles found.
                </td>
              </tr>
            ) : (
              filteredJobTitles.map((title) => {
                const count = usageCounts.jobTitle.get(title.id) || 0;
                return (
                  <tr key={title.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-slate-900">{title.title}</span>
                        {count > 0 ? (
                          <span className="inline-flex items-center rounded-full bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold text-blue-600">
                            {count} active
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-slate-50 px-1.5 py-0.5 text-[9px] font-bold text-slate-400">
                            0 active
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{title.grade || "-"}</td>
                    <td className="px-4 py-3 text-slate-500">{title.level || "-"}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusBadge(title.is_active)}`}>
                        {title.is_active ? "Active" : "Archived"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button type="button" onClick={() => setJobTitleForm({
                        id: title.id,
                        title: title.title,
                        grade: title.grade ?? "",
                        level: title.level ?? "",
                        description: title.description ?? "",
                        is_active: title.is_active,
                      })} className="mr-3 text-xs font-bold text-brand-600 hover:underline">
                        Edit
                      </button>
                      <button type="button" onClick={() => toggleActive("job_titles", title.id, title.is_active)} className="text-xs font-bold text-slate-500 hover:text-slate-800">
                        {title.is_active ? "Archive" : "Restore"}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
        <h3 className="font-bold text-slate-900">{jobTitleForm.id ? "Edit Job Title" : "Add Job Title"}</h3>
        <input value={jobTitleForm.title} onChange={(e) => setJobTitleForm((prev) => ({ ...prev, title: e.target.value }))} placeholder="e.g. Software Engineer" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none" />
        <input value={jobTitleForm.grade} onChange={(e) => setJobTitleForm((prev) => ({ ...prev, grade: e.target.value }))} placeholder="Grade, e.g. M3" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none" />
        <input value={jobTitleForm.level} onChange={(e) => setJobTitleForm((prev) => ({ ...prev, level: e.target.value }))} placeholder="Level, e.g. Senior" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none" />
        <textarea value={jobTitleForm.description} onChange={(e) => setJobTitleForm((prev) => ({ ...prev, description: e.target.value }))} placeholder="Description" rows={3} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none" />
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input type="checkbox" checked={jobTitleForm.is_active} onChange={(e) => setJobTitleForm((prev) => ({ ...prev, is_active: e.target.checked }))} />
          Active
        </label>
        <button type="button" disabled={saving} onClick={saveJobTitle} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
          <Save className="h-4 w-4" />
          Save Job Title
        </button>
      </div>
    </div>
  );

  const renderGrades = () => (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Level</th>
              <th className="px-4 py-3">Notice (days)</th>
              <th className="px-4 py-3">Probation (months)</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredGrades.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center">
                  <p className="font-semibold text-slate-700">
                    {grades.length === 0 ? "No grades yet." : "No grades found."}
                  </p>
                  {grades.length === 0 && (
                    <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
                      A grade is the band an employee sits in — "L3", "Senior", "Band 4" — and it carries the
                      notice-period and probation defaults for everyone in it. Add your first one with the form
                      on the right; <span className="font-semibold">Level</span> only sets the order, lowest first.
                    </p>
                  )}
                </td>
              </tr>
            ) : (
              filteredGrades.map((grade) => {
                const count = usageCounts.grade.get(grade.id) || 0;
                return (
                  <tr key={grade.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-slate-900">{grade.name}</span>
                        {count > 0 ? (
                          <span className="inline-flex items-center rounded-full bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold text-blue-600">
                            {count} active
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-slate-50 px-1.5 py-0.5 text-[9px] font-bold text-slate-400">
                            0 active
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{grade.level}</td>
                    <td className="px-4 py-3 text-slate-500">{grade.default_notice_days ?? "-"}</td>
                    <td className="px-4 py-3 text-slate-500">{grade.default_probation_months ?? "-"}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusBadge(grade.is_active)}`}>
                        {grade.is_active ? "Active" : "Archived"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button type="button" onClick={() => setGradeForm({
                        id: grade.id,
                        name: grade.name,
                        level: String(grade.level),
                        default_notice_days: grade.default_notice_days === null ? "" : String(grade.default_notice_days),
                        default_probation_months: grade.default_probation_months === null ? "" : String(grade.default_probation_months),
                        is_active: grade.is_active,
                      })} className="mr-3 text-xs font-bold text-brand-600 hover:underline">
                        Edit
                      </button>
                      <button type="button" onClick={() => toggleActive("employee_grades", grade.id, grade.is_active)} className="text-xs font-bold text-slate-500 hover:text-slate-800">
                        {grade.is_active ? "Archive" : "Restore"}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
        <h3 className="font-bold text-slate-900">{gradeForm.id ? "Edit Grade" : "Add Grade"}</h3>
        <input value={gradeForm.name} onChange={(e) => setGradeForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="e.g. L3" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none" />
        <input value={gradeForm.level} onChange={(e) => setGradeForm((prev) => ({ ...prev, level: e.target.value }))} placeholder="Level, e.g. 3" inputMode="numeric" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none" />
        <input value={gradeForm.default_notice_days} onChange={(e) => setGradeForm((prev) => ({ ...prev, default_notice_days: e.target.value }))} placeholder="Default notice period (days)" inputMode="numeric" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none" />
        <input value={gradeForm.default_probation_months} onChange={(e) => setGradeForm((prev) => ({ ...prev, default_probation_months: e.target.value }))} placeholder="Default probation (months)" inputMode="numeric" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none" />
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input type="checkbox" checked={gradeForm.is_active} onChange={(e) => setGradeForm((prev) => ({ ...prev, is_active: e.target.checked }))} />
          Active
        </label>
        <button type="button" disabled={saving} onClick={saveGrade} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
          <Save className="h-4 w-4" />
          Save Grade
        </button>
        {gradeForm.id && (
          <button type="button" onClick={() => setGradeForm(emptyEmployeeGrade)} className="w-full text-xs font-bold text-slate-500 hover:text-slate-800">
            Cancel edit
          </button>
        )}
      </div>
    </div>
  );

  const renderLocations = () => (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">City</th>
              <th className="px-4 py-3">State</th>
              <th className="px-4 py-3">Country</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredLocations.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-10 text-center text-slate-500 font-semibold">
                  No locations found.
                </td>
              </tr>
            ) : (
              filteredLocations.map((location) => {
                const count = usageCounts.location.get(location.id) || 0;
                return (
                  <tr key={location.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-slate-900">{location.name}</span>
                        {count > 0 ? (
                          <span className="inline-flex items-center rounded-full bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold text-blue-600">
                            {count} active
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-slate-50 px-1.5 py-0.5 text-[9px] font-bold text-slate-400">
                            0 active
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{location.city || "-"}</td>
                    <td className="px-4 py-3 text-slate-500">{location.state || "-"}</td>
                    <td className="px-4 py-3 text-slate-500">{location.country || "-"}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusBadge(location.is_active)}`}>
                        {location.is_active ? "Active" : "Archived"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button type="button" onClick={() => setLocationForm({
                        id: location.id,
                        name: location.name,
                        country: location.country ?? "",
                        state: location.state ?? "",
                        city: location.city ?? "",
                        timezone: location.timezone ?? "",
                        is_active: location.is_active,
                      })} className="mr-3 text-xs font-bold text-brand-600 hover:underline">
                        Edit
                      </button>
                      <button type="button" onClick={() => toggleActive("locations", location.id, location.is_active)} className="text-xs font-bold text-slate-500 hover:text-slate-800">
                        {location.is_active ? "Archive" : "Restore"}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
        <h3 className="font-bold text-slate-900">{locationForm.id ? "Edit Location" : "Add Location"}</h3>
        <input value={locationForm.name} onChange={(e) => setLocationForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="e.g. Head Office" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none" />
        <input value={locationForm.city} onChange={(e) => setLocationForm((prev) => ({ ...prev, city: e.target.value }))} placeholder="City" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none" />
        <input value={locationForm.state} onChange={(e) => setLocationForm((prev) => ({ ...prev, state: e.target.value }))} placeholder="State" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none" />
        <input value={locationForm.country} onChange={(e) => setLocationForm((prev) => ({ ...prev, country: e.target.value }))} placeholder="Country" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none" />
        <input value={locationForm.timezone} onChange={(e) => setLocationForm((prev) => ({ ...prev, timezone: e.target.value }))} placeholder="Timezone, e.g. Asia/Kolkata" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none" />
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input type="checkbox" checked={locationForm.is_active} onChange={(e) => setLocationForm((prev) => ({ ...prev, is_active: e.target.checked }))} />
          Active
        </label>
        <button type="button" disabled={saving} onClick={saveLocation} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
          <Save className="h-4 w-4" />
          Save Location
        </button>
      </div>
    </div>
  );

  const renderEmploymentTypes = () => (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredEmploymentTypes.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-10 text-center text-slate-500 font-semibold">
                  No employment types found.
                </td>
              </tr>
            ) : (
              filteredEmploymentTypes.map((type) => {
                const count = usageCounts.employmentType.get(type.id) || 0;
                return (
                  <tr key={type.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-slate-900">{type.name}</span>
                        {count > 0 ? (
                          <span className="inline-flex items-center rounded-full bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold text-blue-600">
                            {count} active
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-slate-50 px-1.5 py-0.5 text-[9px] font-bold text-slate-400">
                            0 active
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{type.code}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusBadge(type.is_active)}`}>
                        {type.is_active ? "Active" : "Archived"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button type="button" onClick={() => setEmploymentTypeForm({
                        id: type.id,
                        name: type.name,
                        code: type.code,
                        is_active: type.is_active,
                      })} className="mr-3 text-xs font-bold text-brand-600 hover:underline">
                        Edit
                      </button>
                      <button type="button" onClick={() => toggleActive("employment_types", type.id, type.is_active)} className="text-xs font-bold text-slate-500 hover:text-slate-800">
                        {type.is_active ? "Archive" : "Restore"}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
        <h3 className="font-bold text-slate-900">{employmentTypeForm.id ? "Edit Employment Type" : "Add Employment Type"}</h3>
        <input value={employmentTypeForm.name} onChange={(e) => setEmploymentTypeForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="e.g. Full Time" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none" />
        <input value={employmentTypeForm.code} onChange={(e) => setEmploymentTypeForm((prev) => ({ ...prev, code: e.target.value }))} placeholder="e.g. full_time" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none" />
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input type="checkbox" checked={employmentTypeForm.is_active} onChange={(e) => setEmploymentTypeForm((prev) => ({ ...prev, is_active: e.target.checked }))} />
          Active
        </label>
        <button type="button" disabled={saving} onClick={saveEmploymentType} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
          <Save className="h-4 w-4" />
          Save Employment Type
        </button>
      </div>
    </div>
  );

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand-600">Organization Setup</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-950">Structure Lookups</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Maintain the normalized lookup tables that power Employee Create, Employee Detail, Directory filters, and Org Chart labels.
          </p>
        </div>
        <button type="button" onClick={() => void fetchLookups()} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50">
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold transition ${active ? "bg-brand-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"}`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center bg-white p-3 border border-slate-200 rounded-2xl shadow-sm">
        <div className="relative flex-1">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Search by name or code...`}
            className="w-full rounded-lg border border-slate-300 py-2 px-3 text-sm outline-none transition-shadow hover:bg-slate-50 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          />
        </div>
        <div className="w-full sm:w-48">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none hover:bg-slate-50 focus:border-brand-500"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active Only</option>
            <option value="archived">Archived Only</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="grid min-h-[20rem] place-items-center rounded-2xl border border-slate-200 bg-white text-slate-500">
          <div className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin text-brand-600" />
            Loading organization setup...
          </div>
        </div>
      ) : (
        <>
          {activeTab === "org_units" && renderOrgUnits()}
          {activeTab === "unit_types" && renderUnitTypes()}
          {activeTab === "job_titles" && renderJobTitles()}
          {activeTab === "grades" && renderGrades()}
          {activeTab === "locations" && renderLocations()}
          {activeTab === "employment_types" && renderEmploymentTypes()}
        </>
      )}

      <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-800">
        <div className="flex items-start gap-2">
          {saving ? <Loader2 className="mt-0.5 h-4 w-4 animate-spin" /> : <Plus className="mt-0.5 h-4 w-4" />}
          <p>
            These lookups are additive. Archiving hides options from new selections, but existing employees keep their legacy text values and foreign-key history.
          </p>
        </div>
      </div>
    </section>
  );
}
