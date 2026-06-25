import type { Employee } from "../types";

export interface OrgNode {
  id: string;
  full_name: string;
  designation: string;
  department: string;
  profile_photo_url: string | null;
  grade: string | null;
  manager_id: string | null;
  children: OrgNode[];
}

export function buildOrgTree(employees: Employee[]): OrgNode[] {
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
      children: [],
    });
  });

  const roots: OrgNode[] = [];

  employees.forEach(emp => {
    const node = map.get(emp.id)!;
    if (!emp.manager_id || !map.has(emp.manager_id)) {
      // No manager or manager not in this company = root node
      roots.push(node);
    } else {
      // Has a manager — add as child
      const parent = map.get(emp.manager_id)!;
      parent.children.push(node);
    }
  });

  return roots;
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
