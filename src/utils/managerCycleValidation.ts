import { db } from "../insforge/client";

/**
 * Validates if assigning candidateManagerId as the manager for employeeId creates a cycle or circular reference.
 * 
 * A cycle occurs if:
 * 1. An employee assigns themselves as their manager (self-manager).
 * 2. An employee assigns a manager who is currently a direct or indirect report of the employee.
 * 
 * @param employeeId The ID of the employee being edited (null or empty for a new employee).
 * @param candidateManagerId The manager ID we want to assign.
 * @param tenantId The current tenant ID.
 * @returns An object with isValid boolean and an optional error message.
 */
export async function validateManagerAssignment(
  employeeId: string | null | undefined,
  candidateManagerId: string | null | undefined,
  tenantId: string
): Promise<{ isValid: boolean; message?: string }> {
  // 1. Check if candidate manager is empty or null (which is always valid)
  if (!candidateManagerId) {
    return { isValid: true };
  }

  // 2. Prevent self-manager assignment
  if (employeeId && employeeId === candidateManagerId) {
    return { isValid: false, message: "An employee cannot be their own manager." };
  }

  // 3. For new employee creation, there can be no cycle since they have no reports
  if (!employeeId) {
    return { isValid: true };
  }

  try {
    // Fetch all active/inactive employee manager mappings in this tenant to build the hierarchy map
    const { data: mappings, error } = await db
      .from("employees")
      .select("id, manager_id, full_name")
      .eq("tenant_id", tenantId);

    if (error) {
      console.error("Failed to fetch manager mappings for validation", error);
      // Fallback: assume valid if db fails, but log it
      return { isValid: true };
    }

    if (!mappings || mappings.length === 0) {
      return { isValid: true };
    }

    // Build lookup map for parent hierarchy: employeeId -> managerId
    const managerMap = new Map<string, string>();
    const nameMap = new Map<string, string>();
    
    for (const emp of mappings) {
      nameMap.set(emp.id, emp.full_name);
      if (emp.manager_id) {
        managerMap.set(emp.id, emp.manager_id);
      }
    }

    // A cycle occurs if candidateManagerId eventually reports to employeeId.
    // So we start from candidateManagerId and traverse upwards (manager_id chain).
    // If we hit employeeId, there is a circular reporting chain.
    let currentId: string | undefined = candidateManagerId;
    const visited = new Set<string>();
    const path: string[] = [nameMap.get(candidateManagerId) || candidateManagerId];

    while (currentId) {
      // If we find our employeeId in the manager's reporting line, it's a cycle
      if (currentId === employeeId) {
        const cyclePathStr = [...path, nameMap.get(employeeId) || employeeId].join(" → ");
        return {
          isValid: false,
          message: `Circular reporting line detected: ${cyclePathStr}`
        };
      }

      // Safeguard against pre-existing cycles in database
      if (visited.has(currentId)) {
        break;
      }
      visited.add(currentId);

      // Go up the chain
      const nextId: string | undefined = managerMap.get(currentId);
      if (nextId) {
        path.push(nameMap.get(nextId) || nextId);
      }
      currentId = nextId;
    }

    return { isValid: true };
  } catch (err) {
    console.error("Error validating manager cycle", err);
    return { isValid: true }; // Fallback to avoid blocking
  }
}
