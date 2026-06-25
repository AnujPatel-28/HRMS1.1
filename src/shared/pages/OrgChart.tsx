import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Search, Download, GitBranch, X, ChevronRight, Filter, Network } from "lucide-react";
import type { Employee } from "../../types";
import { useTenant } from "../../contexts/TenantContext";
import { db } from "../../insforge/client";
import { useToast } from "../ToastContext";
import { Skeleton } from "../Skeleton";
import { SelectDropdown } from "../components/SelectDropdown";
import { OrgChartNode } from "../components/OrgChartNode";
import { buildOrgTree, flattenOrgTree } from "../../utils/orgChart";
import type { OrgNode } from "../../utils/orgChart";

export default function OrgChart() {
  const { tenantId } = useTenant();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { error: toastError } = useToast();

  const isHrPortal = location.pathname.startsWith("/hr");

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<OrgNode | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterDept, setFilterDept] = useState("all");
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);

  // Version counter to trigger mass expand/collapse events in the children tree
  const [expandTrigger, setExpandTrigger] = useState<{ type: boolean; version: number }>({
    type: true,
    version: 0,
  });

  // Fetch all active employees for this tenant
  useEffect(() => {
    let active = true;
    setIsLoading(true);

    db.from("employees")
      .select("id, full_name, designation, department, profile_photo_url, grade, manager_id, status")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .then(({ data, error }) => {
        if (active) {
          if (error) {
            toastError("Failed to fetch organisation directory.");
            console.error(error);
          } else {
            setEmployees((data as Employee[]) || []);
          }
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [tenantId, toastError]);

  // Compute trees and lists
  const orgTree = useMemo(() => buildOrgTree(employees), [employees]);
  const flatNodes = useMemo(() => flattenOrgTree(orgTree), [orgTree]);

  // Fetch unique departments
  const departmentOptions = useMemo(() => {
    const depts = new Set<string>();
    employees.forEach((emp) => {
      if (emp.department) depts.add(emp.department);
    });
    return [
      { value: "all", label: "All Departments" },
      ...Array.from(depts).sort().map((d) => ({
        value: d,
        label: d.charAt(0).toUpperCase() + d.slice(1),
      })),
    ];
  }, [employees]);

  // Filter by department
  const filteredTree = useMemo(() => {
    if (filterDept === "all") return orgTree;
    return buildOrgTree(employees.filter((e) => e.department === filterDept));
  }, [orgTree, employees, filterDept]);

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

  // Focus a node: clears search, resets department filter if needed, and sets highlight
  const handleFocusNode = (nodeId: string) => {
    const target = employees.find((e) => e.id === nodeId);
    if (target) {
      if (filterDept !== "all" && target.department !== filterDept) {
        setFilterDept("all");
      }
      setHighlightedNodeId(nodeId);
      setSearchQuery("");

      // Open side drawer if it was clicked inside the drawer
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
                    onClick={() => handleFocusNode(result.id)}
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

      {/* CHART CANVAS AREA */}
      <div className="mt-6 border border-slate-100 rounded-xl bg-slate-50/50 min-h-[550px] flex overflow-auto org-chart-wrapper pt-10 pb-16 justify-center">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center w-full gap-3">
            <Skeleton className="h-16 w-48 rounded-xl" />
            <div className="flex gap-4">
              <Skeleton className="h-16 w-48 rounded-xl" />
              <Skeleton className="h-16 w-48 rounded-xl" />
            </div>
          </div>
        ) : filteredTree.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center p-8">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500 mb-3">
              <GitBranch className="h-6 w-6" />
            </div>
            <h4 className="text-sm font-semibold text-slate-800">No chart branches found</h4>
            <p className="text-xs text-slate-500 mt-1">Try clearing department filters.</p>
          </div>
        ) : (
          <div className="flex gap-20 items-start justify-center min-w-max px-10">
            {filteredTree.map((rootNode) => (
              <OrgChartNode
                key={rootNode.id}
                node={rootNode}
                depth={0}
                onNodeClick={(node) => setSelectedNode(node)}
                forceExpandState={expandTrigger.version > 0 ? expandTrigger.type : undefined}
                highlightedNodeId={highlightedNodeId}
              />
            ))}
          </div>
        )}
      </div>

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
                  <span className="inline-block rounded-full bg-slate-100 px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600 mt-2">
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
            <div className="border-t border-slate-100 p-6 flex gap-3 bg-slate-50/50">
              <button
                type="button"
                onClick={() => setSelectedNode(null)}
                className="flex-1 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition shadow-sm"
              >
                Close
              </button>
              {isHrPortal && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedNode(null);
                    navigate(`/hr/employees/${selectedNode.id}`);
                  }}
                  className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 transition shadow"
                >
                  View Profile
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
