import type { Employee } from "../types";

/**
 * Input to the tree builders: an employee plus a resolved `department` LABEL. `employees.department`
 * was dropped (06 §5 step 6), so callers resolve the unit name from `org_unit_id` first — see
 * `lookupDecoratedEmployees` in shared/pages/OrgChart.tsx. Kept on the node because OrgChartNode
 * styles and renders it.
 */
export type OrgTreeInput = Employee & { department?: string | null; designation?: string | null };

export interface OrgNode {
  id: string;
  full_name: string;
  designation: string;
  department: string;
  profile_photo_url: string | null;
  grade: string | null;
  manager_id: string | null;
  secondary_manager_id: string | null;
  secondary_manager_name?: string | null;
  status?: string;
  hasCycle?: boolean;
  children: OrgNode[];
}

export interface OrgTreeResult {
  /**
   * Employees with no manager (`manager_id === null`) — intentional roots / top leaders.
   * Also includes cycle-flagged nodes as a fallback.
   */
  roots: OrgNode[];
  /**
   * Employees whose `manager_id` is set but the manager is NOT in the visible employee
   * set (i.e. the manager is inactive, terminated, or deleted). These employees need
   * manager reassignment and should be surfaced as a data quality warning.
   *
   * Distinction:
   *   - `!manager_id`              → intentional root / top leader
   *   - `manager_id && !visibleManager` → orphan / needs reassignment  ← this array
   *   - `hasCycle`                 → data error (separate; falls back to roots)
   */
  orphans: OrgNode[];
}

/**
 * Builds the org tree and separately identifies orphaned employees.
 *
 * An orphan is an employee whose manager_id is set but the referenced manager
 * is not present in the visible employee set (e.g. the manager is inactive or deleted).
 *
 * Use `buildOrgTree` for a plain root array (backward-compatible wrapper).
 */
export function buildOrgTreeWithOrphans(employees: OrgTreeInput[]): OrgTreeResult {
  // Build a map for quick lookup
  const map = new Map<string, OrgNode>();
  employees.forEach(emp => {
    map.set(emp.id, {
      id: emp.id,
      full_name: emp.full_name,
      designation: emp.designation || "",
      department: emp.department || "",
      profile_photo_url: emp.profile_photo_url,
      grade: emp.grade || null,
      manager_id: emp.manager_id || null,
      secondary_manager_id: emp.secondary_manager_id || null,
      secondary_manager_name: (emp as any).secondary_manager_name || null,
      status: emp.status,
      children: [],
    });
  });

  // Cycle detection
  employees.forEach(emp => {
    const node = map.get(emp.id)!;
    let currentId = emp.manager_id;
    const visited = new Set<string>();
    while (currentId) {
      if (currentId === emp.id) {
        node.hasCycle = true;
        break;
      }
      if (visited.has(currentId)) break;
      visited.add(currentId);
      const mgr = map.get(currentId);
      currentId = mgr ? mgr.manager_id : null;
    }
  });

  const roots: OrgNode[] = [];
  const orphans: OrgNode[] = [];

  employees.forEach(emp => {
    const node = map.get(emp.id)!;

    if (node.hasCycle) {
      // Cycle-flagged nodes fall back to roots (data error, separate concern from orphans)
      roots.push(node);
    } else if (!emp.manager_id) {
      // Intentional root: no manager assigned — top leader
      roots.push(node);
    } else if (!map.has(emp.manager_id)) {
      // Orphan: manager_id is set, but the referenced manager is not in the visible set
      // (the manager is inactive, terminated, or deleted)
      orphans.push(node);
    } else {
      // Has a visible manager — add as child
      const parent = map.get(emp.manager_id)!;
      parent.children.push(node);
    }
  });

  return { roots, orphans };
}

/**
 * Backward-compatible wrapper. Returns only the root nodes of the org tree.
 * Use `buildOrgTreeWithOrphans` to also detect orphaned employees.
 */
export function buildOrgTree(employees: Employee[]): OrgNode[] {
  return buildOrgTreeWithOrphans(employees).roots;
}

export function flattenOrgTree(nodes: OrgNode[]): OrgNode[] {
  // Returns all nodes in breadth-first order (for search)
  const result: OrgNode[] = [];
  const queue = [...nodes];
  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push(node);
    queue.push(...node.children);
  }
  return result;
}

export function isAncestorOf(node: OrgNode, targetId: string): boolean {
  if (!node.children || node.children.length === 0) return false;
  return node.children.some(child => child.id === targetId || isAncestorOf(child, targetId));
}

export function getTotalDescendantCount(node: OrgNode): number {
  if (!node.children || node.children.length === 0) return 0;
  return node.children.reduce(
    (sum, child) => sum + 1 + getTotalDescendantCount(child),
    0
  );
}
