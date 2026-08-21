import { useEffect, useMemo, useState, useRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Search, Download, GitBranch, X, ChevronRight, Filter, Network, ZoomIn, ZoomOut, RefreshCw, AlertTriangle } from "lucide-react";
import type { Employee } from "../../types";
import { useTenant } from "../../contexts/TenantContext";
import { useOrgStructure } from "../../hooks/useOrgStructure";
import { useTenantHrIds } from "../../hooks/useTenantHrIds";
import { db } from "../../insforge/client";
import { useToast } from "../ToastContext";
import { Skeleton } from "../Skeleton";
import { SelectDropdown } from "../components/SelectDropdown";
import { OrgChartNode } from "../components/OrgChartNode";
import { buildOrgTreeWithOrphans, flattenOrgTree } from "../../utils/orgChart";
import type { OrgNode } from "../../utils/orgChart";

const getDeptStyle = (dept: string) => {
  const d = (dept || "").toLowerCase();
  if (d.includes("eng") || d.includes("tech") || d.includes("dev")) {
    return { borderClass: "border-t-blue-500", tagClass: "text-blue-700 bg-blue-50" };
  }
  if (d.includes("hr") || d.includes("people") || d.includes("talent")) {
    return { borderClass: "border-t-pink-500", tagClass: "text-pink-700 bg-pink-50" };
  }
  if (d.includes("prod") || d.includes("design") || d.includes("ux")) {
    return { borderClass: "border-t-purple-500", tagClass: "text-purple-700 bg-purple-50" };
  }
  if (d.includes("sale") || d.includes("market") || d.includes("growth")) {
    return { borderClass: "border-t-emerald-500", tagClass: "text-emerald-700 bg-emerald-50" };
  }
  if (d.includes("fin") || d.includes("audit") || d.includes("acc")) {
    return { borderClass: "border-t-amber-500", tagClass: "text-amber-700 bg-amber-50" };
  }
  if (d.includes("ops") || d.includes("admin")) {
    return { borderClass: "border-t-indigo-500", tagClass: "text-indigo-700 bg-indigo-50" };
  }
  return { borderClass: "border-t-slate-400", tagClass: "text-slate-700 bg-slate-50" };
};

export default function OrgChart() {
  const { tenantId } = useTenant();
  const hrIds = useTenantHrIds();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { error: toastError } = useToast();

  const isHrPortal = location.pathname.startsWith("/hr");

  const [employees, setEmployees] = useState<Employee[]>([]);
  const { orgUnits, jobTitles } = useOrgStructure();
  const [isLoading, setIsLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<OrgNode | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterDept, setFilterDept] = useState("all");
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);

  // Focus and View states
  const [viewMode, setViewMode] = useState<"chart" | "list">("chart");
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);

  // Version counter to trigger mass expand/collapse events in the children tree
  const [expandTrigger, setExpandTrigger] = useState<{ type: boolean; version: number }>({
    type: true,
    version: 0,
  });

  // Zoom & Pan Canvas states
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Mobile pinch-to-zoom & pan states
  const [touchStartDist, setTouchStartDist] = useState<number | null>(null);
  const [touchStartZoom, setTouchStartZoom] = useState(1);
  const [touchStartPos, setTouchStartPos] = useState<{ x: number; y: number } | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);

  // non-passive Wheel Event handler for trackpad pinch/mousewheel zoom (prevent scroll trap)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault(); // Always prevent page scroll when wheeling over the canvas
      
      if (e.ctrlKey) {
        // Pinch-to-zoom touchpad gesture or Ctrl + Scroll wheel
        const zoomIntensity = 0.05;
        const scale = e.deltaY < 0 ? 1 + zoomIntensity : 1 - zoomIntensity;
        setZoom((prev) => Math.min(2.5, Math.max(0.4, prev * scale)));
      } else {
        // Two-finger trackpad swipe or vertical/horizontal mouse wheel panning
        setPosition((prev) => ({
          x: prev.x - e.deltaX,
          y: prev.y - e.deltaY,
        }));
      }
    };

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", handleWheel);
    };
  }, []);

  // Mouse Drag Panning
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // Only left click drags
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input, select, [role='button'], .org-node-container *")) {
      return; // Do not drag when clicking on buttons/nodes
    }
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const newX = e.clientX - dragStart.x;
    const newY = e.clientY - dragStart.y;
    // Boundary Clamping: prevent dragging out of sight
    setPosition({
      x: Math.min(3000, Math.max(-3000, newX)),
      y: Math.min(3000, Math.max(-3000, newY)),
    });
  };

  const handleMouseUp = () => setIsDragging(false);
  const handleMouseLeave = () => setIsDragging(false);

  // Mobile Touch Panning & Pinch Zoom
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input, select, [role='button'], .org-node-container *")) {
      return;
    }
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      setTouchStartPos({ x: touch.clientX - position.x, y: touch.clientY - position.y });
      setIsDragging(true);
    } else if (e.touches.length === 2) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      setTouchStartDist(dist);
      setTouchStartZoom(zoom);
      setIsDragging(false);
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 1 && touchStartPos && isDragging) {
      const touch = e.touches[0];
      const newX = touch.clientX - touchStartPos.x;
      const newY = touch.clientY - touchStartPos.y;
      setPosition({
        x: Math.min(3000, Math.max(-3000, newX)),
        y: Math.min(3000, Math.max(-3000, newY)),
      });
    } else if (e.touches.length === 2 && touchStartDist) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      const scale = dist / touchStartDist;
      setZoom(Math.min(2.5, Math.max(0.4, touchStartZoom * scale)));
    }
  };

  const handleTouchEnd = () => {
    setTouchStartDist(null);
    setTouchStartPos(null);
    setIsDragging(false);
  };

  // Zoom Button Controls
  const handleZoomIn = () => {
    setZoom((prev) => Math.min(2.5, prev + 0.15));
  };

  const handleZoomOut = () => {
    setZoom((prev) => Math.max(0.4, prev - 0.15));
  };

  const handleResetZoom = () => {
    setZoom(1);
    setPosition({ x: 0, y: 0 });
  };

  const centerOnNode = (nodeId: string) => {
    const wrapper = canvasRef.current;
    const node = document.getElementById(`node-${nodeId}`);
    if (wrapper && node) {
      let el = node;
      let x = 0;
      let y = 0;
      while (el && el !== wrapper) {
        x += el.offsetLeft || 0;
        y += el.offsetTop || 0;
        el = el.offsetParent as HTMLElement;
      }
      
      const xOffset = wrapper.clientWidth / 2 - (x + node.clientWidth / 2) * zoom;
      const yOffset = 40; // Align neatly near the top of the canvas
      setPosition({ x: xOffset, y: yOffset });
    }
  };

  // Center canvas on the highlighted node
  useEffect(() => {
    if (highlightedNodeId) {
      const timer = setTimeout(() => {
        const wrapper = canvasRef.current;
        const node = document.getElementById(`node-${highlightedNodeId}`);
        if (wrapper && node) {
          let el = node;
          let x = 0;
          let y = 0;
          while (el && el !== wrapper) {
            x += el.offsetLeft || 0;
            y += el.offsetTop || 0;
            el = el.offsetParent as HTMLElement;
          }
          
          const xOffset = wrapper.clientWidth / 2 - (x + node.clientWidth / 2) * zoom;
          const yOffset = wrapper.clientHeight / 2 - (y + node.clientHeight / 2) * zoom;
          setPosition({ x: xOffset, y: yOffset });
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [highlightedNodeId, zoom]);

  // Center when focus node changes
  useEffect(() => {
    if (focusNodeId) {
      const timer = setTimeout(() => {
        centerOnNode(focusNodeId);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [focusNodeId]);

  // Fetch all active employees and reporting relationships for this tenant
  useEffect(() => {
    let active = true;
    setIsLoading(true);

    const employeesTable = isHrPortal ? "employees" : "employee_directory_public";

    Promise.all([
      db.from(employeesTable)
        .select("id, full_name, org_unit_id, job_title_id, location_id, employment_type_id, profile_photo_url, grade, status, user_id")
        .eq("tenant_id", tenantId)
        .in("status", ["active", "draft", "pending_hr_review", "inactive"]),
      db.from("employee_reporting_relationships")
        .select("employee_id, manager_id, relationship_type")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
    ]).then(([empRes, relRes]) => {
      if (active) {
        if (empRes.error || relRes.error) {
          toastError("Failed to fetch organisation directory.");
          console.error(empRes.error || relRes.error);
        } else {
          const relationships = relRes.data || [];
          const primaryMap = new Map<string, string>();
          const secondaryMap = new Map<string, string>();
          relationships.forEach((rel: any) => {
            if (rel.relationship_type === "primary") primaryMap.set(rel.employee_id, rel.manager_id);
            else if (rel.relationship_type === "secondary") secondaryMap.set(rel.employee_id, rel.manager_id);
          });

          const mapped = (empRes.data || []).map((emp: any) => ({
            ...emp,
            manager_id: primaryMap.get(emp.id) || null,
            secondary_manager_id: secondaryMap.get(emp.id) || null,
          }));

          setEmployees(mapped as Employee[]);
        }
        setIsLoading(false);
      }
    });

    return () => {
      active = false;
    };
  }, [isHrPortal, tenantId, toastError]);

  // Filter out genuinely inactive/deactivated employees (we only want active + drafts)
  const visibleEmployees = useMemo(
    () => employees.filter(e => e.status !== 'inactive' || !e.user_id),
    [employees]
  );

  const lookupDecoratedEmployees = useMemo(() => {
    const orgUnitNameById = new Map(orgUnits.map((unit) => [unit.id, unit.name]));
    const jobTitleById = new Map(jobTitles.map((title) => [title.id, title.title]));
    const employeeNameById = new Map(visibleEmployees.map((emp) => [emp.id, emp.full_name]));

    return visibleEmployees.map((employee) => ({
      ...employee,
      // Resolved unit name only — employees.department no longer exists. Everything downstream
      // (filter, grouping, search, node styling) reads THIS decorated field, not a column.
      department: employee.org_unit_id ? orgUnitNameById.get(employee.org_unit_id) ?? "" : "",
      designation: employee.job_title_id ? jobTitleById.get(employee.job_title_id) ?? "" : "",
      secondary_manager_name: employee.secondary_manager_id ? employeeNameById.get(employee.secondary_manager_id) ?? null : null,
    }));
  }, [jobTitles, orgUnits, visibleEmployees]);

  // Separate HR admins (no manager) from the reporting tree. HR now comes from
  // tenant_hr_employee_ids(); employees.role is gone, and the directory view an
  // employee-portal session reads no longer exposes it either.
  const hrAdmins = useMemo(
    () => lookupDecoratedEmployees.filter(e => hrIds.has(e.id) && !e.manager_id),
    [lookupDecoratedEmployees, hrIds]
  );
  const treeEmployees = useMemo(
    () => lookupDecoratedEmployees.filter(e => !(hrIds.has(e.id) && !e.manager_id)),
    [lookupDecoratedEmployees, hrIds]
  );

  // Compute trees and lists, separating true roots from orphaned employees
  const { orgTree, orphanNodes } = useMemo(() => {
    const result = buildOrgTreeWithOrphans(treeEmployees);
    return { orgTree: result.roots, orphanNodes: result.orphans };
  }, [treeEmployees]);
  // flatNodes includes orphans so search and breadcrumb trail work across all employees
  const flatNodes = useMemo(
    () => flattenOrgTree(orgTree).concat(orphanNodes),
    [orgTree, orphanNodes]
  );

  // HR-only: data quality summary counts (computed from loaded data, no extra fetches)
  const dataQualitySummary = useMemo(() => ({
    orphanCount: orphanNodes.length,
    secondaryManagerCount: lookupDecoratedEmployees.filter((e) => e.secondary_manager_id).length,
    cycleCount: lookupDecoratedEmployees.filter((e) => (e as any).hasCycle).length,
  }), [orphanNodes, lookupDecoratedEmployees]);

  // Center root node on initial load
  useEffect(() => {
    if (!isLoading && orgTree.length > 0 && position.x === 0 && position.y === 0) {
      const rootId = orgTree[0].id;
      const timer = setTimeout(() => {
        centerOnNode(rootId);
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [isLoading, orgTree]);

  // Fetch unique departments
  const departmentOptions = useMemo(() => {
    const depts = new Set<string>();
    treeEmployees.forEach((emp) => {
      if (emp.department) depts.add(emp.department);
    });
    return [
      { value: "all", label: "All Departments" },
      ...Array.from(depts).sort().map((d) => ({
        value: d,
        label: d.charAt(0).toUpperCase() + d.slice(1),
      })),
    ];
  }, [treeEmployees]);

  // Filtered tree with focus node capability
  const filteredTree = useMemo(() => {
    if (focusNodeId) {
      const node = flatNodes.find((n) => n.id === focusNodeId);
      return node ? [node] : [];
    }
    if (filterDept === "all") return orgTree;
    return buildOrgTreeWithOrphans(treeEmployees.filter((e) => e.department === filterDept)).roots;
  }, [orgTree, flatNodes, treeEmployees, filterDept, focusNodeId]);

  // Search queries
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length <= 1) return [];
    return flatNodes.filter(
      (n) =>
        n.full_name.toLowerCase().includes(q) ||
        n.designation.toLowerCase().includes(q)
    );
  }, [flatNodes, searchQuery]);

  // Filter list employees for the Directory List View
  const listEmployees = useMemo(() => {
    return treeEmployees.filter((emp) => {
      if (filterDept !== "all" && emp.department !== filterDept) return false;
      const q = searchQuery.trim().toLowerCase();
      if (q) {
        return (
          emp.full_name.toLowerCase().includes(q) ||
          (emp.designation || "").toLowerCase().includes(q) ||
          (emp.department || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [treeEmployees, filterDept, searchQuery]);

  // Breadcrumbs trail
  const breadcrumbs = useMemo(() => {
    if (!focusNodeId) return [];
    const trail: OrgNode[] = [];
    let currentId: string | null = focusNodeId;
    let depth = 0;
    while (currentId && depth < 20) {
      const match = flatNodes.find((n) => n.id === currentId);
      if (match) {
        trail.unshift(match);
        currentId = match.manager_id;
      } else {
        break;
      }
      depth++;
    }
    return trail;
  }, [focusNodeId, flatNodes]);

  const headcountStats = useMemo(() => {
    // Reads the RESOLVED department label, which lives on the decorated list — employees.department
    // was dropped (06 §5 step 6), so the raw rows carry only org_unit_id.
    const total = lookupDecoratedEmployees.length;
    const depts = new Set(lookupDecoratedEmployees.map(e => e.department).filter(Boolean)).size;
    const activeManagerIds = new Set(lookupDecoratedEmployees.map(e => e.manager_id).filter(Boolean));
    const managers = activeManagerIds.size;

    const deptCounts = lookupDecoratedEmployees.reduce((acc, e) => {
      if (e.department) {
        acc[e.department] = (acc[e.department] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);
    const topDepts = Object.entries(deptCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([name, count]) => `${name} (${count})`);
      
    return { total, depts, managers, topDepts };
  }, [lookupDecoratedEmployees]);

  // Focus a node: clears search, resets department filter if needed, and sets highlight
  const handleFocusNode = (nodeId: string) => {
    const target = lookupDecoratedEmployees.find((e) => e.id === nodeId);
    if (target) {
      if (filterDept !== "all" && target.department !== filterDept) {
        setFilterDept("all");
      }
      setHighlightedNodeId(nodeId);
      setSearchQuery("");

      // Open side drawer
      const fullNode = flatNodes.find((n) => n.id === nodeId);
      if (fullNode) {
        setSelectedNode(fullNode);
      }
    }
  };

  // Sync focus/highlight from URL search param `?focus=id`
  useEffect(() => {
    const focusId = searchParams.get("focus");
    if (focusId && employees.length > 0) {
      handleFocusNode(focusId);
    }
  }, [searchParams, employees]);

  // Expand All / Collapse All handlers
  const handleExpandAll = () => {
    setExpandTrigger((prev) => ({ type: true, version: prev.version + 1 }));
  };

  const handleCollapseAll = () => {
    setExpandTrigger((prev) => ({ type: false, version: prev.version + 1 }));
  };

  const handlePrint = () => {
    window.print();
  };

  // Get manager node details for selected drawer employee
  const selectedManager = useMemo(() => {
    if (!selectedNode?.manager_id) return null;
    return flatNodes.find((n) => n.id === selectedNode.manager_id) || null;
  }, [selectedNode, flatNodes]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 md:p-6 shadow-sm relative overflow-hidden">
      {/* HEADER SECTION */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-5 print-hide">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Network className="h-6 w-6 text-brand-600" />
            Organisation Chart
          </h2>
          <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-500 font-medium">
            <span>{employees.length} active employees</span>
            <span className="text-slate-300">&bull;</span>
            <span>{departmentOptions.length - 1} departments</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* View Mode Toggle */}
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 mr-2">
            <button
              onClick={() => setViewMode("chart")}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                viewMode === "chart"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Chart View
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                viewMode === "list"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              List View
            </button>
          </div>

          {viewMode === "chart" && (
            <>
              <button
                onClick={handleExpandAll}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-sm transition"
              >
                Expand All
              </button>
              <button
                onClick={handleCollapseAll}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-sm transition"
              >
                Collapse All
              </button>
            </>
          )}
          <button
            onClick={handlePrint}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700 shadow-sm transition"
          >
            <Download className="h-3.5 w-3.5" />
            Download PDF
          </button>
        </div>
      </div>

      {/* CONTROLS ROW (Search & Filter) */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 md:grid-cols-4 print-hide">
        <div className="relative md:col-span-2">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by name or designation..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-8 text-sm outline-none transition hover:bg-slate-50 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}

          {/* SEARCH SUGGESTIONS OVERLAY */}
          {searchResults.length > 0 && (
            <div className="absolute left-0 right-0 z-50 mt-1 max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1.5 shadow-xl ring-1 ring-black ring-opacity-5">
              {searchResults.map((result) => {
                const initials = result.full_name
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase();
                return (
                  <button
                    key={result.id}
                    type="button"
                    onClick={() => {
                      setViewMode("chart");
                      handleFocusNode(result.id);
                    }}
                    className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-slate-50 transition"
                  >
                    {result.profile_photo_url ? (
                      <img
                        src={result.profile_photo_url}
                        alt=""
                        className="h-8 w-8 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <div className="grid h-8 w-8 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand-700 shrink-0">
                        {initials}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-900 truncate">{result.full_name}</p>
                      <p className="text-xs text-slate-500 truncate capitalize">
                        {result.designation} &bull; {result.department}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {searchQuery.trim().length > 1 && searchResults.length === 0 && (
            <div className="absolute left-0 right-0 z-50 mt-1 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-xl">
              No matching employees found
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-400 shrink-0" />
          <SelectDropdown
            value={filterDept}
            onChange={setFilterDept}
            options={departmentOptions}
            triggerClassName="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition-shadow hover:bg-slate-50 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          />
        </div>
      </div>

      {/* STATS BAND */}
      <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 bg-slate-50 border border-slate-150 p-4 rounded-xl print-hide">
        <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-sm text-center">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Total Headcount</span>
          <span className="text-xl font-bold text-slate-900 mt-1 block">{headcountStats.total}</span>
        </div>
        <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-sm text-center">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Departments</span>
          <span className="text-xl font-bold text-slate-900 mt-1 block">{headcountStats.depts}</span>
        </div>
        <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-sm text-center">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Active Managers</span>
          <span className="text-xl font-bold text-slate-900 mt-1 block">{headcountStats.managers}</span>
        </div>
        <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-sm text-center">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Largest Departments</span>
          <span className="text-[11px] font-semibold text-slate-700 mt-1.5 block truncate">
            {headcountStats.topDepts.join(" • ") || "—"}
          </span>
        </div>
      </div>

      {/* BREADCRUMB BAR (When sub-tree focus is set) */}
      {focusNodeId && breadcrumbs.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-1.5 text-sm text-slate-500 bg-slate-50/80 border border-slate-100 rounded-lg px-4 py-2 print-hide animate-fade-in">
          <button
            onClick={() => setFocusNodeId(null)}
            className="hover:text-brand-600 hover:underline font-medium text-xs flex items-center gap-1 text-slate-500"
          >
            <Network className="h-3.5 w-3.5" />
            Organisation Chart
          </button>
          {breadcrumbs.map((node, idx) => {
            const isLast = idx === breadcrumbs.length - 1;
            return (
              <div key={node.id} className="flex items-center gap-1.5">
                <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                <button
                  onClick={() => !isLast && setFocusNodeId(node.id)}
                  disabled={isLast}
                  className={`font-semibold text-xs ${
                    isLast ? "text-slate-800" : "hover:text-brand-600 hover:underline text-slate-500"
                  }`}
                >
                  {node.full_name}
                </button>
              </div>
            );
          })}
          <button
            onClick={() => setFocusNodeId(null)}
            className="ml-auto text-[11px] font-bold text-slate-400 hover:text-slate-600"
          >
            Clear Focus
          </button>
        </div>
      )}

      {/* HR Administration band */}
      {hrAdmins.length > 0 && viewMode === "chart" && (
        <div className="rounded-2xl border border-brand-100 bg-brand-50/40 p-4 mt-5">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-brand-600">HR Administration</p>
          <div className="flex flex-wrap gap-3">
            {hrAdmins.map(admin => (
              <div key={admin.id} className="flex items-center gap-2.5 rounded-xl border border-brand-100 bg-white px-3.5 py-2 shadow-sm">
                {admin.profile_photo_url ? (
                  <img src={admin.profile_photo_url} className="h-8 w-8 rounded-full object-cover shrink-0 ring-1 ring-slate-100" alt={admin.full_name} />
                ) : (
                  <div className="grid h-8 w-8 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white shrink-0">
                    {admin.full_name.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div>
                  <p className="text-xs font-semibold text-slate-900">{admin.full_name}</p>
                  <p className="text-[10px] text-slate-500 font-medium capitalize">{admin.designation ?? "HR Admin"}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* HR-only: Data quality summary + orphan warning banner */}
      {isHrPortal && !isLoading && viewMode === "chart" && (
        <div className="mt-4 flex flex-wrap items-start gap-3 animate-fade-in print-hide">
          {/* Data quality pill summary */}
          <div className="flex flex-wrap gap-2 items-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mr-1">Data Quality</span>
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold border ${
              dataQualitySummary.orphanCount > 0
                ? "bg-amber-50 text-amber-700 border-amber-200"
                : "bg-emerald-50 text-emerald-700 border-emerald-100"
            }`}>
              {dataQualitySummary.orphanCount > 0 ? "⚠" : "✓"} {dataQualitySummary.orphanCount} need manager reassignment
            </span>
            {dataQualitySummary.secondaryManagerCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-100">
                ⟋ {dataQualitySummary.secondaryManagerCount} dotted-line manager{dataQualitySummary.secondaryManagerCount !== 1 ? "s" : ""}
              </span>
            )}
            {dataQualitySummary.cycleCount > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                ⚠ {dataQualitySummary.cycleCount} cycle warning{dataQualitySummary.cycleCount !== 1 ? "s" : ""}
              </span>
            ) : (
              dataQualitySummary.orphanCount === 0 && (
                <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">
                  ✓ Structure looks clean
                </span>
              )
            )}
          </div>
        </div>
      )}

      {viewMode === "chart" ? (
        /* CHART CANVAS AREA */
        <div 
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className={`mt-6 border border-slate-100 rounded-xl bg-slate-50/50 min-h-[550px] relative overflow-hidden select-none flex items-center justify-center ${
            isDragging ? "cursor-grabbing" : "cursor-grab"
          }`}
        >
          {isLoading ? (
            <div className="flex flex-col items-center justify-center w-full gap-3 pointer-events-none">
              <Skeleton className="h-16 w-48 rounded-xl" />
              <div className="flex gap-4">
                <Skeleton className="h-16 w-48 rounded-xl" />
                <Skeleton className="h-16 w-48 rounded-xl" />
              </div>
            </div>
          ) : filteredTree.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center p-8 pointer-events-none">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500 mb-3">
                <GitBranch className="h-6 w-6" />
              </div>
              <h4 className="text-sm font-semibold text-slate-800">No chart branches found</h4>
              <p className="text-xs text-slate-500 mt-1">Try clearing department filters or focus settings.</p>
            </div>
          ) : (
            <>
              {/* Transform Canvas Element */}
              <div 
                style={{
                  transform: `translate(${position.x}px, ${position.y}px) scale(${zoom})`,
                  transformOrigin: "top center",
                  transition: isDragging ? "none" : "transform 0.15s ease-out",
                }}
                className="flex gap-20 items-start justify-center min-w-max px-10 pt-10 pb-16"
              >
                {filteredTree.map((rootNode) => (
                  <OrgChartNode
                    key={rootNode.id}
                    node={rootNode}
                    depth={0}
                    isRoot={true}
                    onNodeClick={(node) => setSelectedNode(node)}
                    forceExpandState={expandTrigger.version > 0 ? expandTrigger.type : undefined}
                    highlightedNodeId={highlightedNodeId}
                  />
                ))}
              </div>

              {/* FLOATING CANVAS CONTROLS */}
              <div className="absolute bottom-4 right-4 z-10 flex items-center gap-1 bg-white border border-slate-200 shadow-md rounded-xl p-1 print-hide">
                <button
                  type="button"
                  onClick={handleZoomOut}
                  className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition"
                  title="Zoom Out"
                >
                  <ZoomOut className="h-4 w-4" />
                </button>
                <span className="text-xs font-bold text-slate-600 px-1 min-w-[3rem] text-center select-none">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={handleZoomIn}
                  className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition"
                  title="Zoom In"
                >
                  <ZoomIn className="h-4 w-4" />
                </button>
                <div className="h-4 w-px bg-slate-200 mx-1" />
                <button
                  type="button"
                  onClick={handleResetZoom}
                  className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition"
                  title="Reset Zoom & Pan"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        /* DIRECTORY LIST VIEW */
        <div className="mt-6 border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm print-hide animate-fade-in">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm text-slate-500">
              <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-700 border-b border-slate-200">
                <tr>
                  <th scope="col" className="px-6 py-4">Employee</th>
                  <th scope="col" className="px-6 py-4">Designation</th>
                  <th scope="col" className="px-6 py-4">Department</th>
                  <th scope="col" className="px-6 py-4">Grade</th>
                  <th scope="col" className="px-6 py-4">Reporting Manager</th>
                  <th scope="col" className="px-6 py-4">Status</th>
                  <th scope="col" className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center">
                      <div className="space-y-3">
                        <Skeleton className="h-8 w-full" />
                        <Skeleton className="h-8 w-full" />
                        <Skeleton className="h-8 w-full" />
                      </div>
                    </td>
                  </tr>
                ) : listEmployees.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-10 text-center text-slate-400 font-medium">
                      No matching records found.
                    </td>
                  </tr>
                ) : (
                  listEmployees.map((emp) => {
                    const manager = flatNodes.find((m) => m.id === emp.manager_id);
                    const initials = emp.full_name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
                    const deptStyle = getDeptStyle(emp.department);
                    return (
                      <tr key={emp.id} className="hover:bg-slate-50/50 transition duration-150">
                        <td className="px-6 py-4 flex items-center gap-3">
                          {emp.profile_photo_url ? (
                            <img src={emp.profile_photo_url} alt="" className="h-9 w-9 rounded-full object-cover shadow-sm ring-1 ring-slate-100" />
                          ) : (
                            <div className="grid h-9 w-9 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand-700 shadow-sm border border-brand-100">
                              {initials}
                            </div>
                          )}
                          <div>
                            <p className="font-semibold text-slate-900">{emp.full_name}</p>
                            <p className="text-[10px] text-slate-400 capitalize">{hrIds.has(emp.id) ? "HR" : emp.designation || ""}</p>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-slate-700 font-medium capitalize">{emp.designation || "-"}</td>
                        <td className="px-6 py-4 capitalize">
                          {emp.department ? (
                            <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${deptStyle.tagClass}`}>
                              {emp.department}
                            </span>
                          ) : "-"}
                        </td>
                        <td className="px-6 py-4 font-semibold text-slate-600 font-mono text-xs">{emp.grade || "-"}</td>
                        <td className="px-6 py-4">
                          {manager ? (
                            <button
                              onClick={() => {
                                setViewMode("chart");
                                handleFocusNode(manager.id);
                              }}
                              className="text-brand-600 hover:text-brand-700 hover:underline font-semibold text-left"
                            >
                              {manager.full_name}
                            </button>
                          ) : (
                            <span className="text-slate-400 italic">None (Top Level)</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold border capitalize ${
                            emp.status === "active" 
                              ? "bg-emerald-50 text-emerald-700 border-emerald-100" 
                              : "bg-amber-50 text-amber-700 border-amber-100"
                          }`}>
                            {emp.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => {
                              setViewMode("chart");
                              handleFocusNode(emp.id);
                            }}
                            className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-600 hover:text-brand-700 hover:underline"
                          >
                            <Network className="h-3.5 w-3.5" />
                            Show in Chart
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* HR-only: Needs Manager Assignment orphan group — sibling of the chart/list ternary */}
      {isHrPortal && !isLoading && orphanNodes.length > 0 && viewMode === "chart" && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 mt-5 print-hide animate-fade-in">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <p className="text-[11px] font-bold uppercase tracking-widest text-amber-700">
              Needs Manager Assignment ({orphanNodes.length})
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {orphanNodes.map(orphan => (
              <button
                key={orphan.id}
                type="button"
                onClick={() => setSelectedNode(orphan)}
                className="flex items-center gap-2.5 rounded-xl border border-amber-200 bg-white px-3.5 py-2 shadow-sm hover:border-amber-400 hover:shadow-md transition text-left"
              >
                {orphan.profile_photo_url ? (
                  <img src={orphan.profile_photo_url} className="h-8 w-8 rounded-full object-cover shrink-0 ring-1 ring-amber-100" alt={orphan.full_name} />
                ) : (
                  <div className="grid h-8 w-8 place-items-center rounded-full bg-amber-400 text-xs font-bold text-white shrink-0">
                    {orphan.full_name.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div>
                  <p className="text-xs font-semibold text-slate-900">{orphan.full_name}</p>
                  {orphan.designation && (
                    <p className="text-[10px] text-slate-500 font-medium capitalize">{orphan.designation}</p>
                  )}
                  {orphan.department && (
                    <p className="text-[10px] text-slate-400 font-medium capitalize">{orphan.department}</p>
                  )}
                  <p className="text-[10px] text-amber-600 font-semibold mt-0.5">
                    Manager inactive or missing
                  </p>
                </div>
                {isHrPortal && (
                  <a
                    href={`/hr/employees/${orphan.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="ml-1 shrink-0 text-[9px] font-bold uppercase tracking-wider bg-brand-50 text-brand-600 border border-brand-100 rounded-lg px-2 py-1 hover:bg-brand-100 transition"
                    title="Open Employee Detail"
                  >
                    Reassign
                  </a>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* SLIDING DETAILS PANEL DRAWER */}
      {selectedNode && (
        <div className="fixed inset-0 z-50 flex justify-end print-hide animate-fade-in">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-300"
            onClick={() => setSelectedNode(null)}
          />

          {/* Sliding Panel */}
          <div className="relative w-full max-w-md bg-white h-full shadow-2xl z-10 flex flex-col justify-between border-l border-slate-200 animate-slide-in">
            {/* Close Button */}
            <button
              onClick={() => setSelectedNode(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-50 transition"
              title="Close Drawer"
            >
              <X className="h-5 w-5" />
            </button>

            {/* Scrollable details */}
            <div className="flex-1 overflow-y-auto p-6 pt-12 space-y-6">
              {/* Header profile info */}
              <div className="flex flex-col items-center text-center border-b border-slate-100 pb-6">
                {selectedNode.profile_photo_url ? (
                  <img
                    src={selectedNode.profile_photo_url}
                    alt={selectedNode.full_name}
                    className="h-20 w-20 rounded-full object-cover shadow-md border-2 border-slate-100"
                  />
                ) : (
                  <div className="grid h-20 w-20 place-items-center rounded-full bg-brand-50 text-2xl font-bold text-brand-700 border border-brand-100">
                    {selectedNode.full_name
                      .split(" ")
                      .map((n) => n[0])
                      .join("")
                      .slice(0, 2)
                      .toUpperCase()}
                  </div>
                )}
                <h3 className="text-xl font-bold text-slate-900 mt-4">{selectedNode.full_name}</h3>
                <p className="text-sm font-semibold text-slate-500 mt-1 capitalize">
                  {selectedNode.designation || "No Designation"}
                </p>
                {selectedNode.department && (
                  <span className={`inline-block rounded-full px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider mt-2 ${
                    getDeptStyle(selectedNode.department).tagClass
                  }`}>
                    {selectedNode.department}
                  </span>
                )}
              </div>

              {/* Attributes fields */}
              <div className="space-y-4">
                {selectedNode.grade && (
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Grade</span>
                    <p className="font-semibold text-slate-800 mt-0.5">{selectedNode.grade}</p>
                  </div>
                )}

                {/* Reporting Manager details */}
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                    Reporting Manager
                  </span>
                  <p className="font-semibold text-slate-800 mt-1">
                    {selectedManager ? (
                      <button
                        onClick={() => handleFocusNode(selectedManager.id)}
                        className="inline-flex items-center gap-1 text-brand-600 hover:text-brand-700 hover:underline text-left font-semibold"
                      >
                        {selectedManager.full_name} ({selectedManager.designation})
                      </button>
                    ) : (
                      <span className="text-slate-500 italic">None (Top Level)</span>
                    )}
                  </p>
                </div>

                {/* Direct Reports list */}
                <div className="border-t border-slate-100 pt-4">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-2">
                    Direct Reports ({selectedNode.children.length})
                  </span>
                  {selectedNode.children.length === 0 ? (
                    <p className="text-xs text-slate-500 italic">No direct reports</p>
                  ) : (
                    <div className="space-y-2 mt-1">
                      {selectedNode.children.map((child) => (
                        <button
                          key={child.id}
                          onClick={() => handleFocusNode(child.id)}
                          className="flex items-center gap-1.5 w-full text-left text-sm font-semibold text-slate-700 hover:text-brand-600 transition"
                        >
                          <ChevronRight className="h-4 w-4 text-slate-400" />
                          <span>{child.full_name}</span>
                          <span className="text-xs font-normal text-slate-400">({child.designation})</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Footer actions */}
            <div className="border-t border-slate-100 p-6 flex flex-col gap-2.5 bg-slate-50/50">
              <div className="flex gap-3 w-full">
                {selectedNode.children.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (focusNodeId === selectedNode.id) {
                        setFocusNodeId(null);
                      } else {
                        setFocusNodeId(selectedNode.id);
                      }
                      setSelectedNode(null);
                    }}
                    className="flex-1 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition shadow-sm flex items-center justify-center gap-1.5"
                  >
                    <GitBranch className="h-4 w-4 text-slate-500" />
                    {focusNodeId === selectedNode.id ? "Show All" : "Focus Team"}
                  </button>
                )}
                {isHrPortal && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedNode(null);
                      navigate(`/hr/employees/${selectedNode.id}`);
                    }}
                    className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 transition shadow flex items-center justify-center"
                  >
                    View Profile
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedNode(null)}
                className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition shadow-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
