import { useState, useEffect, useMemo } from "react";
import type { OrgNode } from "../../utils/orgChart";
import { isAncestorOf } from "../../utils/orgChart";

interface OrgChartNodeProps {
  node: OrgNode;
  depth: number;
  isRoot?: boolean;
  onNodeClick: (node: OrgNode) => void;
  forceExpandState?: boolean;
  highlightedNodeId: string | null;
}

export function OrgChartNode({
  node,
  depth,
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

  // Scroll to this node if it is currently highlighted/focused
  useEffect(() => {
    if (highlightedNodeId === node.id) {
      const element = document.getElementById(`node-${node.id}`);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      }
    }
  }, [highlightedNodeId, node.id]);

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

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }} className="org-node-container">
      {/* Node Card */}
      <div
        id={`node-${node.id}`}
        onClick={() => onNodeClick(node)}
        style={{
          background: isHighlighted ? "#f0fdf4" : "var(--color-background-primary)",
          border: isHighlighted
            ? "2px solid var(--color-brand-600, #059669)"
            : "1px solid var(--color-border-secondary)",
          borderRadius: "12px",
          padding: "16px",
          cursor: "pointer",
          minWidth: "180px",
          maxWidth: "220px",
          textAlign: "center",
          boxShadow: isHighlighted
            ? "0 10px 25px -5px rgba(5, 150, 105, 0.15), 0 8px 10px -6px rgba(5, 150, 105, 0.15)"
            : "0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05)",
          transform: isHighlighted ? "scale(1.06)" : "none",
          transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          position: "relative",
          zIndex: isHighlighted ? 10 : 1,
        }}
        className="hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 group"
      >
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
            className="ring-2 ring-slate-100 group-hover:ring-brand-100 transition-all duration-200"
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
            className="ring-2 ring-slate-100"
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
        <p style={{ fontSize: "10px", color: "var(--color-text-secondary)", margin: 0 }} className="opacity-85 capitalize">
          {node.department}
        </p>

        {node.grade && (
          <span className="inline-block mt-2 px-2 py-0.5 text-[9px] font-bold text-slate-500 bg-slate-100 rounded-full">
            {node.grade}
          </span>
        )}

        {/* Expand / Collapse Action Trigger */}
        {node.children.length > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            style={{
              marginTop: "10px",
              fontSize: "10px",
              fontWeight: "600",
              padding: "4px 10px",
              background: expanded ? "var(--color-background-secondary)" : "#059669",
              border: "none",
              borderRadius: "20px",
              cursor: "pointer",
              color: expanded ? "var(--color-text-secondary)" : "#ffffff",
              transition: "all 0.2s",
            }}
            className="hover:scale-105 shadow-sm inline-flex items-center gap-1"
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
