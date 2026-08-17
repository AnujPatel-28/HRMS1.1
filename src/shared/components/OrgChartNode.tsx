import { useState, useEffect, useMemo } from "react";
import type { OrgNode } from "../../utils/orgChart";
import { isAncestorOf, getTotalDescendantCount } from "../../utils/orgChart";
import { Link2, AlertTriangle, HelpCircle } from "lucide-react";

interface OrgChartNodeProps {
  node: OrgNode;
  depth: number;
  isRoot?: boolean;
  onNodeClick: (node: OrgNode) => void;
  forceExpandState?: boolean;
  highlightedNodeId: string | null;
}

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

export function OrgChartNode({
  node,
  depth,
  isRoot = false,
  onNodeClick,
  forceExpandState,
  highlightedNodeId,
}: OrgChartNodeProps) {
  const [expanded, setExpanded] = useState(depth < 2); // Auto-expand first 2 levels (CEO and EM)

  // Sync expanded state with forceExpandState from parent controls
  useEffect(() => {
    if (forceExpandState !== undefined) {
      setExpanded(forceExpandState);
    }
  }, [forceExpandState]);

  // Auto-expand parents if this node is an ancestor of the highlighted node
  const isAncestor = useMemo(() => {
    if (!highlightedNodeId) return false;
    return isAncestorOf(node, highlightedNodeId);
  }, [node, highlightedNodeId]);

  useEffect(() => {
    if (isAncestor) {
      setExpanded(true);
    }
  }, [isAncestor]);

  const isHighlighted = highlightedNodeId === node.id;

  // Generate short initials for fallback avatar
  const initials = useMemo(() => {
    return node.full_name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }, [node.full_name]);

  const deptStyle = useMemo(() => getDeptStyle(node.department), [node.department]);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }} className="org-node-container">
      {/* Node Card */}
      <div
        id={`node-${node.id}`}
        onClick={() => onNodeClick(node)}
        className={`hover:shadow-lg hover:-translate-y-1 transition-all duration-300 group border-t-4 ${deptStyle.borderClass} ${
          isHighlighted ? "bg-emerald-50/30 ring-2 ring-emerald-500" : "bg-white"
        }`}
        style={{
          borderLeft: "1px solid var(--color-border-secondary)",
          borderRight: "1px solid var(--color-border-secondary)",
          borderBottom: "1px solid var(--color-border-secondary)",
          borderRadius: "12px",
          padding: "16px",
          cursor: "pointer",
          minWidth: "190px",
          maxWidth: "220px",
          textAlign: "center",
          boxShadow: isHighlighted
            ? "0 10px 25px -5px rgba(16, 185, 129, 0.15), 0 8px 10px -6px rgba(16, 185, 129, 0.15)"
            : "0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05)",
          transform: isHighlighted ? "scale(1.05)" : "none",
          position: "relative",
          zIndex: isHighlighted ? 10 : 1,
          opacity: node.status && node.status !== "active" ? 0.75 : 1,
        }}
      >
        {node.secondary_manager_id && (
          <span
            className="absolute top-2 left-2 rounded-full border border-dashed border-indigo-400 bg-indigo-50 px-1.5 py-0.5 text-[8px] font-bold text-indigo-700 uppercase tracking-wider"
            title={node.secondary_manager_name ? `Dotted-line: ${node.secondary_manager_name}` : "Dotted-line manager assigned"}
          >
            {node.secondary_manager_name
              ? `\u27cb ${node.secondary_manager_name.split(" ")[0]}`
              : "Matrix"}
          </span>
        )}
        {node.hasCycle && (
          <span className="absolute top-2 right-2 rounded-full bg-rose-100 p-1 text-rose-700 border border-rose-200" title="Circular reporting loop detected!">
            <AlertTriangle className="h-3.5 w-3.5 animate-bounce" />
          </span>
        )}
        {!node.manager_id && !isRoot && !node.hasCycle && (
          <span className="absolute top-2 right-2 rounded-full bg-amber-100 p-1 text-amber-700 border border-amber-200" title="Orphan node: Missing manager reference">
            <HelpCircle className="h-3.5 w-3.5 animate-pulse" />
          </span>
        )}
        {/* Highlight Pulse Glow */}
        {isHighlighted && (
          <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500"></span>
          </span>
        )}

        {/* Profile Avatar */}
        {node.profile_photo_url ? (
          <img
            src={node.profile_photo_url}
            alt={node.full_name}
            style={{ width: "52px", height: "52px", borderRadius: "50%", margin: "0 auto 10px", objectFit: "cover" }}
            className="ring-2 ring-slate-100 group-hover:ring-brand-100 transition-all duration-200 shadow-sm"
          />
        ) : (
          <div
            style={{
              width: "52px",
              height: "52px",
              borderRadius: "50%",
              background: "var(--color-background-info)",
              color: "var(--color-text-info)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "16px",
              fontWeight: "600",
              margin: "0 auto 10px",
            }}
            className="ring-2 ring-slate-100 shadow-sm"
          >
            {initials}
          </div>
        )}

        <h4 style={{ fontSize: "13px", fontWeight: "600", margin: "0 0 4px", color: "var(--color-text-primary)" }}>
          {node.full_name}
        </h4>
        <p style={{ fontSize: "11px", color: "var(--color-text-secondary)", margin: "0 0 2px" }} className="font-medium">
          {node.designation}
        </p>

        {node.department && (
          <span className={`inline-block mt-1 px-2 py-0.5 text-[9px] font-bold rounded-full capitalize ${deptStyle.tagClass}`}>
            {node.department}
          </span>
        )}

        {node.status && node.status !== "active" && (
          <div className="mt-2">
            <span className="inline-block px-2 py-0.5 text-[9px] font-bold text-amber-700 bg-amber-50 rounded-full border border-amber-100 capitalize">
              {node.status === "inactive" ? "Pending HR" : node.status.replace(/_/g, " ")}
            </span>
          </div>
        )}

        {node.secondary_manager_id && (
          <div className="mt-2 pt-1.5 border-t border-dashed border-indigo-200 text-[9px] font-bold text-indigo-650 flex items-center justify-center gap-1">
            <Link2 className="h-3 w-3 shrink-0 animate-pulse" />
            <span>Matrix: {node.secondary_manager_name || "Assigned"}</span>
          </div>
        )}

        {/* Expand / Collapse Action Trigger */}
        {node.children.length > 0 && (
          <div className="mt-3">
            <p className="text-[9px] text-slate-400 font-semibold mb-1">
              {getTotalDescendantCount(node)} total reports
            </p>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(!expanded);
              }}
              className={`px-3 py-1 rounded-full text-[10px] font-bold shadow-sm inline-flex items-center gap-1 transition-all hover:scale-105 ${
                expanded
                  ? "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  : "bg-brand-600 text-white hover:bg-brand-700"
              }`}
            >
              {expanded ? (
                <>
                  <span>▲</span> Collapse
                </>
              ) : (
                <>
                  <span>▼</span> {node.children.length} {node.children.length === 1 ? "report" : "reports"}
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Connection line down to children */}
      {expanded && node.children.length > 0 && (
        <div
          style={{
            width: "1px",
            height: "20px",
            background: "var(--color-border-secondary)",
          }}
        />
      )}

      {/* Children Row Tree rendering */}
      {expanded && node.children.length > 0 && (
        <div style={{ display: "flex", gap: "24px", alignItems: "flex-start" }}>
          {node.children.map((child, index) => (
            <div
              key={child.id}
              style={{
                position: "relative",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              {/* Horizontal line row connector */}
              {node.children.length > 1 && (
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: index === 0 ? "50%" : 0,
                    right: index === node.children.length - 1 ? "50%" : 0,
                    height: "1px",
                    background: "var(--color-border-secondary)",
                  }}
                />
              )}

              {/* Vertical branch line connector down to the child card */}
              <div
                style={{
                  width: "1px",
                  height: "20px",
                  background: "var(--color-border-secondary)",
                }}
              />

              <OrgChartNode
                node={child}
                depth={depth + 1}
                onNodeClick={onNodeClick}
                forceExpandState={forceExpandState}
                highlightedNodeId={highlightedNodeId}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
