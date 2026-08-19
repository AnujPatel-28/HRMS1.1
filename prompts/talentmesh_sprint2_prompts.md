# TalentMesh — Sprint 2 Build Prompts
# Org Chart · PMS · Expense Management · Insurance · Tax Declaration
# Detailed, Agent-Safe. Run ONE prompt at a time. Git commit between each.

---

## PRE-SPRINT 2 CHECKLIST

```bash
# Confirm Sprint 1 is fully working and committed
git log --oneline -6
# Should show all S1-A through S1-F commits

# Confirm these tables exist from S1-A:
# posts, post_reactions, projects, insurance_policies, expenses

# Confirm employees table has: manager_id, grade, blood_group, work_location

npm run dev
# App must be fully working before starting Sprint 2
```

---

# PROMPT S2-A — Organisation Hierarchy / Org Chart
# Goal: Interactive visual org chart showing company structure.
#       Every employee can view it. HR can manage the hierarchy.
# What changes: New org chart page in both portals.
# What does NOT change: Everything existing.
# Risk: Low — new page, reads existing data.
# Time: 3-4 hours

```
CONTEXT — READ FULLY BEFORE DOING ANYTHING:

I have a working TalentMesh HRMS multi-tenant SaaS.
The employees table has manager_id (uuid, FK to employees.id).
This creates a hierarchy: employees with manager_id = null are at the top.
Employees with manager_id pointing to someone are their direct reports.

The hierarchy can be multiple levels deep:
CEO (manager_id = null)
  └── Engineering Manager (manager_id = CEO.id)
        └── Senior Developer (manager_id = EM.id)
              └── Junior Developer (manager_id = SD.id)

YOUR TASK:
Build an interactive org chart page. No external org chart library —
build it with recursive React components and CSS flexbox.

STEP 1 — Create src/utils/orgChart.ts:

Utility functions for building the org chart tree.

```typescript
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
    map.set(emp.id, { ...emp, children: [] });
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
```

STEP 2 — Create src/shared/components/OrgChartNode.tsx:

A single node in the org chart tree.

```tsx
interface OrgChartNodeProps {
  node: OrgNode;
  depth: number;
  isRoot?: boolean;
  onNodeClick: (node: OrgNode) => void;
}

export function OrgChartNode({ node, depth, onNodeClick }: OrgChartNodeProps) {
  const [expanded, setExpanded] = useState(depth < 2); // auto-expand first 2 levels

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {/* The node card */}
      <div
        onClick={() => onNodeClick(node)}
        style={{
          background: 'var(--color-background-primary)',
          border: '1px solid var(--color-border-secondary)',
          borderRadius: '10px',
          padding: '12px 16px',
          cursor: 'pointer',
          minWidth: '160px',
          maxWidth: '180px',
          textAlign: 'center',
          transition: 'all 0.15s',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
        }}
      >
        {/* Avatar */}
        {node.profile_photo_url ? (
          <img
            src={node.profile_photo_url}
            style={{ width: '48px', height: '48px', borderRadius: '50%', marginBottom: '8px' }}
          />
        ) : (
          <div style={{
            width: '48px', height: '48px', borderRadius: '50%',
            background: 'var(--color-background-info)',
            color: 'var(--color-text-info)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '16px', fontWeight: '500', margin: '0 auto 8px',
          }}>
            {node.full_name.split(' ').map(n => n[0]).join('').slice(0,2)}
          </div>
        )}
        <p style={{ fontSize: '12px', fontWeight: '500', margin: '0 0 2px', color: 'var(--color-text-primary)' }}>
          {node.full_name}
        </p>
        <p style={{ fontSize: '11px', color: 'var(--color-text-secondary)', margin: '0 0 2px' }}>
          {node.designation}
        </p>
        <p style={{ fontSize: '10px', color: 'var(--color-text-secondary)', margin: 0 }}>
          {node.department}
        </p>
        {/* Expand/collapse if has children */}
        {node.children.length > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            style={{
              marginTop: '6px', fontSize: '10px', padding: '2px 8px',
              background: 'var(--color-background-secondary)',
              border: 'none', borderRadius: '10px', cursor: 'pointer',
              color: 'var(--color-text-secondary)',
            }}
          >
            {expanded ? '▲ Collapse' : `▼ ${node.children.length} reports`}
          </button>
        )}
      </div>

      {/* Children */}
      {expanded && node.children.length > 0 && (
        <div style={{ position: 'relative', marginTop: '0' }}>
          {/* Vertical line from parent to children row */}
          <div style={{
            position: 'absolute', top: 0, left: '50%',
            width: '1px', height: '20px',
            background: 'var(--color-border-secondary)',
          }} />
          <div style={{ height: '20px' }} />
          {/* Horizontal line connecting children */}
          {node.children.length > 1 && (
            <div style={{
              position: 'absolute', top: '20px',
              left: `calc(50% / ${node.children.length})`,
              right: `calc(50% / ${node.children.length})`,
              height: '1px',
              background: 'var(--color-border-secondary)',
            }} />
          )}
          {/* Children row */}
          <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
            {node.children.map(child => (
              <div key={child.id} style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                {/* Vertical line from horizontal bar to this child */}
                <div style={{
                  width: '1px', height: '20px',
                  background: 'var(--color-border-secondary)',
                }} />
                <OrgChartNode
                  node={child}
                  depth={depth + 1}
                  onNodeClick={onNodeClick}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

STEP 3 — Create src/shared/pages/OrgChart.tsx:

Used in both portals: /hr/org-chart and /employee/org-chart

```tsx
export default function OrgChart() {
  const { tenantId } = useTenant();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<OrgNode | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterDept, setFilterDept] = useState('all');

  // Fetch all active employees for this tenant
  useEffect(() => {
    insforge.from('employees')
      .select('id, full_name, designation, department, profile_photo_url, grade, manager_id, status')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .then(({ data }) => {
        setEmployees(data || []);
        setIsLoading(false);
      });
  }, [tenantId]);

  const orgTree = useMemo(() => buildOrgTree(employees), [employees]);
  const flatNodes = useMemo(() => flattenOrgTree(orgTree), [orgTree]);

  // Filter by department
  const filteredTree = filterDept === 'all'
    ? orgTree
    : buildOrgTree(employees.filter(e => e.department === filterDept));

  // Search highlights matching nodes
  const searchResults = searchQuery.length > 1
    ? flatNodes.filter(n =>
        n.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        n.designation.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : [];
```

PAGE LAYOUT:

Header: "Organisation Chart" | "{count} employees" | "{dept count} departments"

Controls row:
  Search input: "Search by name or designation..."
    When search is active: show search results as a list below (not the full tree)
    Each result: avatar + name + designation + department
    Click result → scroll to that node in the tree and highlight it

  Department filter dropdown: "All Departments" + each unique department
  "Expand All" button | "Collapse All" button
  "Download" button (triggers window.print() for the chart)

Main chart area:
  Horizontally scrollable container (org charts can be wide)
  Render OrgChartNode components starting from roots
  If multiple roots (no single CEO): show them side by side

NODE CLICK → side panel or modal:
  Shows full employee card:
  Photo | Name | Designation | Department | Grade
  Manager: "{manager name}" with a link to their node
  Direct reports: list of names reporting to this person
  "View Profile" button (HR only) → navigate to employee detail

STEP 4 — Add to sidebars:
HR sidebar (under "People" section): "Org Chart" with GitBranch icon
Employee sidebar (under Directory): "Org Chart" with GitBranch icon

STEP 5 — Update HR employee detail:
In EmployeeDetail.tsx, add to the "Job Info" tab:
  "Organisational Position" section:
  - Reports to: {manager name} (clickable → goes to org chart focused on manager)
  - Direct reports: {count} people report to this employee
  - Department hierarchy: {company} → {department} → {this person}

DO NOT change any existing employee queries.
DO NOT change attendance, leaves, or tasks.
Test: create a 3-level hierarchy in test data, confirm the tree renders correctly.
```

---

# PROMPT S2-B — PMS: Project Management System
# Goal: Projects as a parent container above tasks.
#       HR/Managers create projects, assign tasks within projects.
#       Better overview of work across teams.
# What changes: New Projects pages. Existing tasks get project_id field.
# What does NOT change: Existing standalone tasks still work exactly as before.
# Risk: Low — additive. Existing tasks without project_id are "standalone".
# Time: 4-5 hours

```
CONTEXT — READ FULLY BEFORE DOING ANYTHING:

I have a working TalentMesh HRMS with a tasks system.
The tasks table has: id, tenant_id, title, description, assigned_to,
assigned_by, priority, due_date, status, project_id (nullable — added S1-A).

The projects table was created in S1-A:
id, tenant_id, name, description, status, manager_id, start_date, end_date,
created_by, created_at, updated_at.

The existing task assignment and punch-out gate system must NOT be changed.
Standalone tasks (project_id = null) continue to work exactly as before.
The only change to existing task behaviour: tasks can optionally belong to a project.

YOUR TASK:
Build the PMS module. This is separate from the existing Task Management page.
The existing Task Management at /hr/tasks stays EXACTLY as-is.
New PMS at /hr/pms shows projects with tasks nested inside them.

STEP 1 — Create src/hr/pms/ProjectList.tsx:
Route: /hr/pms

Page layout:
Header: "Projects" | "Active projects: X" | "+ New Project" button

STATS ROW (4 cards):
Active | Planning | Completed | Total tasks across all projects

FILTER tabs: All | Planning | Active | On Hold | Completed
Search input for project name.

PROJECT CARDS (grid layout, 2 columns desktop, 1 mobile):
Each card shows:
  - Project name (bold, large)
  - Status badge (color coded:
    planning=blue, active=green, on_hold=amber, completed=gray, cancelled=red)
  - Description (truncated to 2 lines)
  - Manager: avatar + name (from manager_id join)
  - Dates: "May 1 → Jun 30" (start_date to end_date)
  - Task progress bar:
    Fetch count of tasks for this project grouped by status
    Progress = approved tasks / total tasks × 100%
    Show: "12 / 20 tasks completed" with a green progress bar
  - Team avatars: show up to 5 unique assigned_to avatars (from tasks in this project)
    If more than 5: show "+X more"
  - "View Project" button → /hr/pms/{project_id}

"+ New Project" button → opens NewProjectModal

NEW PROJECT MODAL:
Fields:
  Project name: text input (required)
  Description: textarea
  Status: dropdown (default: planning)
  Project Manager: searchable dropdown of HR + manager role employees
  Start date: date picker
  End date: date picker (must be after start date)
  Visibility: All employees / Specific departments / Specific people
    (store as JSON in projects table — add visibility_config jsonb column if needed)

On submit: INSERT into projects with tenant_id, created_by = current HR user.
Success toast: "Project created. Now add tasks to it."
Navigate to /hr/pms/{new_project_id}

STEP 2 — Create src/hr/pms/ProjectDetail.tsx:
Route: /hr/pms/:projectId

BREADCRUMB: Projects → {project name}

PROJECT HEADER card:
  Project name (large, editable inline — click to edit)
  Status badge (clickable dropdown to change status)
  Manager name | Start date - End date
  Description
  Edit button (opens ProjectEditModal with same fields as create)

TABS: Tasks | Team | Timeline | Overview

TASKS TAB (main tab):
Shows all tasks where project_id = this project's id.

Kanban-style columns (4 columns horizontal scroll on mobile):
  ASSIGNED | IN PROGRESS | SUBMITTED | APPROVED

Each task card in the kanban:
  Priority badge (colored dot)
  Task title
  Assignee avatar + name
  Due date (red if overdue)
  Drag to move between columns (update tasks.status on drop)
  Click to open task detail side panel

"+ Add Task" button in each column header OR a single button above kanban.
Opens AddTaskToProjectModal:
  Pre-fills project_id = current project
  Same fields as existing task assignment form:
  title, description, assigned_to (dropdown), priority, due_date
  On submit: INSERT task with project_id = this project's id
  This triggers the same punch-out gate logic as existing tasks
  (employee cannot punch out until task is approved — no change here)

TEAM TAB:
Shows all employees who have tasks in this project.
For each team member: avatar, name, task count, completion rate.
Manager can quickly assign new tasks to team members from here.

TIMELINE TAB (simple version):
Horizontal timeline showing:
  Project start → project end as a bar
  Each task as a smaller bar below (from due_date - 1 day to due_date)
  Color-coded by status
  This is a simple CSS-based timeline, no charting library needed

OVERVIEW TAB:
Stats for this project:
  Total tasks | Completed | In progress | Overdue
  Team size | Days remaining | Progress % (large circular indicator)
  Recent activity: last 10 status changes (read from audit_logs where target_id = tasks in this project)

STEP 3 — Update employee My Tasks page:
In src/employee/MyTasks.tsx, add a "Projects" tab next to the existing "My Tasks" tab.

Projects tab shows:
  Projects this employee has tasks in
  Each project: name, status, their task count, their completion rate
  Click project → /employee/pms/{projectId} (employee read-only view)

Create src/employee/pms/EmployeeProjectView.tsx:
Route: /employee/pms/:projectId
Shows:
  Project name + description
  Only THIS employee's tasks in this project (filtered by assigned_to = currentEmployeeId)
  Task cards with submit button (same as existing task submission)
  Team section: other people working on this project (just names, no tasks visible)

STEP 4 — Update existing TaskManagement.tsx (minimal change):
Add a small "Project" column to the existing tasks table.
If task has project_id: show project name as a badge (clickable → goes to project detail)
If task has no project_id: show "Standalone" in muted gray text.
That's the ONLY change to the existing TaskManagement page.

STEP 5 — Add PMS to sidebars:
HR sidebar (under HR Management section): "Projects" with FolderKanban icon
  Add PlanGate: feature="pms" (Growth plan and above)
Employee sidebar (under My Tasks): "My Projects" link
  Only visible if employee has tasks with project_id (check on login)

DO NOT change the task approval or punch-out gate logic at all.
DO NOT change existing TaskManagement.tsx except adding the "Project" column.
DO NOT change notifications for tasks — they continue as-is.
All existing standalone tasks remain standalone and work identically.
```

---

# PROMPT S2-C — Expense Management
# Goal: Employees submit expenses for reimbursement.
#       HR approves. Approved expenses auto-include in payroll.
# What changes: New expense pages in both portals. Payroll run update.
# What does NOT change: Existing payroll logic except adding expense line item.
# Risk: Low-Medium. Test payroll integration carefully.
# Time: 4-5 hours

```
CONTEXT — READ FULLY BEFORE DOING ANYTHING:

I have a working TalentMesh HRMS with payroll system.
The expenses table was created in S1-A:
id, tenant_id, employee_id, title, amount, currency, category,
expense_date, description, receipt_url, receipt_name, status,
reviewed_by, reviewed_at, rejection_reason, payroll_run_id, reimbursed_at.

Categories: travel / food / accommodation / equipment / medical / other
Statuses: pending / approved / rejected / reimbursed

The payroll system at src/payroll/hr/RunPayroll.tsx already calculates
net payable per employee. I need to add approved expenses as a line item.

STEP 1 — Create src/employee/Expenses.tsx:
Route: /employee/expenses
Add to Employee sidebar: "Expenses" with Receipt icon
Add PlanGate wrapper: feature="expenses" (Growth plan)

EMPLOYEE EXPENSE PAGE — two tabs:

TAB 1: "Submit Expense"
Form:
  Title: text input — e.g. "Uber to client meeting"
  Amount: number input with ₹ prefix
  Category: dropdown (Travel / Food / Accommodation / Equipment / Medical / Other)
  Date: date picker (default today, cannot be future date)
  Description: textarea (optional but encouraged)
  Receipt upload: file input
    Accepts: JPG, PNG, PDF (max 5 MB)
    Upload to InsForge Storage bucket 'expense-receipts' (create if not exists)
    Show preview after upload (image thumbnail or PDF icon)

  Submit button → INSERT into expenses:
    { tenant_id, employee_id: currentEmployee.id, title, amount, category,
      expense_date, description, receipt_url, receipt_name, status: 'pending' }

  On success: toast "Expense submitted for approval." Switch to My Expenses tab.
  Create notification for HR:
    title: "New expense claim",
    body: "{employee name} submitted a ₹{amount} expense for {category}",
    type: 'general'

TAB 2: "My Expenses" (default tab)
Table of all this employee's expenses (newest first):
Columns: Date | Title | Category | Amount | Receipt | Status | Reimbursed

Status badges:
  Pending: amber (clock icon)
  Approved: blue (check icon) — approved but not yet reimbursed
  Rejected: red (x icon)
  Reimbursed: green (money icon) — included in a payroll run

Category icons: use lucide icons for each category
  Travel: Car / Plane
  Food: UtensilsCrossed
  Accommodation: Building
  Equipment: Monitor
  Medical: Stethoscope
  Other: Receipt

Receipt column: if receipt_url exists, show a small "View" link that opens the file.
"Reimbursed in" column: if reimbursed, show "Month Year payroll" (from payroll_runs join).

SUMMARY CARD above the table:
  "Total pending: ₹X across Y claims"
  "Total approved (unpaid): ₹X across Y claims"
  "Total reimbursed this year: ₹X"

CANCEL expense: employee can cancel ONLY pending expenses.
Show cancel button on pending rows. Confirm modal.
On confirm: DELETE the expense row.

REJECTION: When expense is rejected, show rejection reason in a tooltip/expandable row.

STEP 2 — Create src/hr/Expenses.tsx:
Route: /hr/expenses
Add to HR sidebar: "Expenses" with Receipt icon (under HR Management section)
Add PlanGate: feature="expenses"

HR EXPENSE MANAGEMENT — three tabs:

TAB 1: "Pending Review" (default, shows count badge)
Cards (not table) for each pending expense — more visual for approval:

Each card:
  Top row: employee photo + name + department | submitted timestamp
  Title: expense title (large)
  Amount: ₹{amount} (large, prominent)
  Category badge (with icon)
  Date: expense date
  Description: if exists, show it
  Receipt: if receipt_url, show thumbnail (image) or "View PDF" link
  
  ACTION BUTTONS:
  Approve (green) → UPDATE expenses SET status='approved', reviewed_by=hrId, reviewed_at=now()
    Create notification for employee:
    title: "Expense Approved"
    body: "Your ₹{amount} {category} expense '{title}' has been approved. It will be included in your next payroll."
    
  Reject (red) → opens rejection modal:
    Text input: "Reason for rejection (shown to employee)"
    Confirm → UPDATE expenses SET status='rejected', rejection_reason=input
    Create notification for employee:
    title: "Expense Rejected"
    body: "Your {category} expense '{title}' was rejected. Reason: {rejection_reason}"

Bulk approve: checkboxes on each card, "Approve Selected" button at top.

TAB 2: "All Expenses"
Full table with all expenses for this tenant:
Columns: Employee | Date | Category | Title | Amount | Receipt | Status | Reviewed by | Payroll

Filters: by employee, by category, by status, by date range, by month.
Sort by: date, amount, employee name.
Export to CSV button.

Summary stats above table:
  Total approved unpaid: ₹X | Total reimbursed this month: ₹X | Pending count: X

TAB 3: "Reimbursement History"
Shows all expenses grouped by payroll run month.
Month selector → shows all expenses reimbursed in that payroll run.
Useful for accounting: total reimbursements per month.

STEP 3 — Wire approved expenses into payroll run:
In src/payroll/hr/RunPayroll.tsx, in Step 2 (calculation):

After calculating regular pay for each employee, fetch their approved expenses:

```typescript
const { data: approvedExpenses } = await insforge
  .from('expenses')
  .select('*')
  .eq('tenant_id', tenantId)
  .eq('employee_id', employee.id)
  .eq('status', 'approved')
  .is('payroll_run_id', null); // not yet reimbursed
// payroll_run_id = null means approved but not yet included in any payroll run

const totalExpenses = approvedExpenses?.reduce((sum, e) => sum + e.amount, 0) || 0;
```

Add to the payslip calculation:
  expenses_reimbursement: totalExpenses
  net_payable = existing net_payable + totalExpenses
  (reimbursements are added to net pay, not taxed)

In the payslip PDF, show a separate section:
  "Reimbursements" with each expense as a line:
  {date} | {category} | {title} | ₹{amount}
  Total reimbursements: ₹X

Add expenses_reimbursement column to payslips table:
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS expenses_reimbursement numeric NOT NULL DEFAULT 0;

When payroll is APPROVED (status changes to 'approved'):
UPDATE expenses SET
  status = 'reimbursed',
  payroll_run_id = {payrollRunId},
  reimbursed_at = now()
WHERE id IN (all expense IDs included in this payroll run)

STEP 4 — Add expense count badge to employee sidebar item:
Show count of pending_review expenses for HR as badge on sidebar "Expenses" item.
Fetch count on load:
  WHERE tenant_id = tenantId AND status = 'pending'

DO NOT change existing payroll calculation for salary/attendance/deductions.
Only ADD the expense reimbursement line item.
DO NOT change any task, leave, or attendance logic.
Test: submit an expense as employee → approve as HR →
run payroll → confirm expense appears in payslip → confirm expense marked reimbursed.
```

---

# PROMPT S2-D — Insurance Management
# Goal: HR adds insurance policies per employee.
#       Employee views their policy + relationship manager contact.
# What changes: New insurance pages in both portals.
# What does NOT change: Everything existing.
# Risk: Very Low — new standalone feature.
# Time: 2-3 hours

```
CONTEXT — READ FULLY BEFORE DOING ANYTHING:

I have a working TalentMesh HRMS.
The insurance_policies table was created in S1-A:
id, tenant_id, employee_id, insurer_name, policy_number, policy_type,
coverage_amount, premium_amount, premium_frequency, start_date, expiry_date,
status, rm_name, rm_phone, rm_email, rm_company, notes, policy_document_url.

This is a simple data management feature — no live insurer API.
HR enters insurance data manually. Employee views their policy + RM contact.
Looking at Kredily's Insurance Management — it's exactly this: display + contact info.

STEP 1 — Create src/hr/Insurance.tsx:
Route: /hr/insurance
Add to HR sidebar (under "People" section): "Insurance" with Shield icon
Add PlanGate: feature="insurance" (Growth plan)

HR INSURANCE MANAGEMENT:

LIST VIEW — table of all insurance policies for this tenant:
Columns: Employee | Policy Type | Insurer | Policy Number | Coverage | Status | Expiry | Actions

Filter by: employee, policy type, status (active/expired/cancelled)
Search by: employee name, policy number, insurer name

"Expiring soon" highlight: policies expiring in next 30 days shown in amber.
"Expired" policies shown in red.

"Add Policy" button → opens AddPolicyModal (or side panel)

ADD/EDIT POLICY FORM:
  Employee: searchable dropdown (shows all active employees)
  Policy type: dropdown (Health / Life / Accident / Dental / Vision / Group)
  Insurer name: text input (e.g. "Star Health", "HDFC Ergo")
  Policy number: text input
  Coverage amount: number input with ₹ prefix
  Premium amount: number input with ₹ prefix
  Premium frequency: dropdown (Monthly / Quarterly / Annual)
  Start date: date picker
  Expiry date: date picker
  Status: dropdown (Active / Expired / Cancelled)

  RELATIONSHIP MANAGER section (collapsible):
  Label: "Relationship Manager (shown to employee for claims/queries)"
  RM name: text input
  RM phone: text input
  RM email: email input
  RM company: text input (e.g. "Star Health Insurance")

  Notes: textarea (internal HR notes, not shown to employee)
  Policy document: file upload (PDF) → InsForge Storage 'insurance-documents'

  Save → INSERT/UPDATE insurance_policies

ACTIONS per table row:
  Edit (opens same form pre-filled)
  Delete (confirm modal: "This will remove the insurance record. Employee will no longer see it.")
  Download policy doc (if uploaded)
  "Notify employee" button: creates an in-app notification:
    title: "Insurance Update"
    body: "Your {policy_type} insurance policy with {insurer_name} has been updated. Please review your coverage details."

BULK ACTIONS:
Select multiple rows → "Export to CSV" for reporting.

STEP 2 — Create src/employee/Insurance.tsx:
Route: /employee/insurance
Add to Employee sidebar: "Insurance" with Shield icon
Add PlanGate: feature="insurance"

EMPLOYEE INSURANCE VIEW:

If no policies exist for this employee:
  Show empty state: Shield icon + "No insurance policies on file"
  "Contact HR for insurance queries" text

If policies exist — show each policy as a CARD (not a table):

POLICY CARD design:
Header: policy type icon + Policy type (large, colored)
  Health = green heart, Life = blue shield, Accident = amber alert, etc.

Card body:
  Insurer: {insurer_name} (bold)
  Policy Number: {policy_number} (copyable — click to copy)
  Coverage: ₹{coverage_amount} (large)
  Valid: {start_date} to {expiry_date}
  Status badge: Active (green) / Expiring soon (amber) / Expired (red)

If expiry within 30 days:
  Show amber banner: "⚠️ This policy expires on {date}. Please contact HR to renew."

"View Policy Document" button (if document uploaded):
  Opens PDF in new tab using signed URL from InsForge Storage

RELATIONSHIP MANAGER section (shown at bottom of card):
Only shown if RM details are filled in:
  Label: "For claims, hospitalization or medical queries, contact your relationship manager:"
  Small card inside the main card:
    RM name (bold)
    RM company
    📞 {rm_phone} (tap to call on mobile)
    ✉️ {rm_email} (tap to email)
  This is exactly what Kredily shows in their insurance RM popup

"Contact RM" button on mobile → triggers tel: link for phone call

STEP 3 — Add insurance expiry reminders:
Create InsForge Edge Function: insurance-expiry-check
Schedule: runs on 1st of every month

Logic:
1. Find all insurance_policies where:
   expiry_date BETWEEN NOW() AND NOW() + INTERVAL '30 days'
   AND status = 'active'
2. For each policy:
   a. Create notification for the employee (employee_id)
      title: "Insurance Expiring Soon"
      body: "Your {policy_type} insurance with {insurer_name} expires on {expiry_date}. Please contact HR."
   b. Create notification for HR (all HR employees for this tenant)
      title: "Employee Insurance Expiring"
      body: "{employee_name}'s {policy_type} insurance expires on {expiry_date}."

DO NOT integrate with any real insurance API.
DO NOT handle actual claims processing.
This is purely a data display and contact information feature.
Test: HR adds a health policy for an employee.
Employee logs in and sees the policy card with RM contact info.
```

---

# PROMPT S2-E — Tax Declaration (Simplified)
# Goal: Employees declare their IT investments for TDS computation.
#       HR opens/closes declaration window. Simplified version — no auto tax calculation.
# What changes: New declaration pages. New DB tables.
# What does NOT change: Existing payroll logic (TDS remains manual for now).
# Risk: Low — new standalone feature, payroll TDS stays manual.
# Time: 3-4 hours

```
CONTEXT — READ FULLY BEFORE DOING ANYTHING:

I have a working TalentMesh HRMS + Payroll system.
In the existing payroll, TDS is a manual number HR enters per employee.
This prompt builds the IT Declaration feature where employees can
declare their investments so HR can review and set the TDS amount.

Looking at Kredily's Declaration screenshot:
- Tabs: Overview, Deduction, Income from Previous Employer, Reimbursements, Forms
- Shows "Declaration Window is not yet open" when HR has closed it
- Shows FY year selector (2026-2027)
- "Copy From Previous Year" button
- Summary table of declared amounts

This is NOT auto-tax computation. HR reviews declarations and manually
updates TDS in the salary structure. The auto-computation phase comes later.

STEP 1 — Create DB tables via InsForge MCP:

TABLE: it_declaration_windows
-- HR opens and closes declaration windows for specific financial years
CREATE TABLE IF NOT EXISTS it_declaration_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  financial_year text NOT NULL, -- e.g. '2026-27'
  is_open boolean NOT NULL DEFAULT false,
  opens_at timestamptz,
  closes_at timestamptz,
  opened_by uuid REFERENCES employees(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE(tenant_id, financial_year)
);

TABLE: it_declarations
-- Employee's tax declarations per financial year
CREATE TABLE IF NOT EXISTS it_declarations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  financial_year text NOT NULL, -- e.g. '2026-27'
  tax_regime text NOT NULL DEFAULT 'new',
  -- 'old' = old regime with deductions, 'new' = new regime without deductions

  -- Section 80C (max ₹1.5 lakh)
  ppf_amount numeric DEFAULT 0,
  lic_premium numeric DEFAULT 0,
  elss_mutual_fund numeric DEFAULT 0,
  nsc_amount numeric DEFAULT 0,
  home_loan_principal numeric DEFAULT 0,
  tuition_fees numeric DEFAULT 0,
  other_80c numeric DEFAULT 0,

  -- Section 80D (health insurance premium)
  health_insurance_self numeric DEFAULT 0,
  health_insurance_parents numeric DEFAULT 0,

  -- HRA (if claiming HRA exemption)
  hra_rent_paid_annual numeric DEFAULT 0,
  hra_landlord_name text,
  hra_landlord_pan text,

  -- Home loan interest (Section 24)
  home_loan_interest numeric DEFAULT 0,

  -- Income from previous employer (if joined mid-year)
  prev_employer_income numeric DEFAULT 0,
  prev_employer_tds numeric DEFAULT 0,
  prev_employer_name text,

  -- Reimbursements
  lta_amount numeric DEFAULT 0,
  medical_reimbursement numeric DEFAULT 0,

  status text NOT NULL DEFAULT 'draft',
  -- draft / submitted / verified_by_hr
  submitted_at timestamptz,
  verified_by uuid REFERENCES employees(id),
  verified_at timestamptz,
  hr_notes text,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(tenant_id, employee_id, financial_year)
);

Enable RLS on both tables.
Employees can only SELECT/UPDATE their own declaration rows.
HR can SELECT all rows for their tenant, UPDATE status and hr_notes.

STEP 2 — Create src/employee/TaxDeclaration.tsx:
This is a tab/section in the Employee Payroll view (alongside Payslip, Salary, Bank tabs).
Route: /employee/payroll (existing) → add "Declaration" tab

TAB HEADER — matches Kredily exactly:
Tabs: Pay Slip | Salary Structure | Declaration | Bank Account

DECLARATION TAB:

FINANCIAL YEAR SELECTOR:
Dropdown showing available years (from it_declaration_windows for this tenant)
Default: current financial year (e.g. "2026-27")

CHECK WINDOW STATUS:
Fetch it_declaration_windows for selected year and this tenant.
If is_open = false: show red banner (exactly like Kredily):
  "Declaration Window is not yet open. Please contact your HR."
  Show the declaration as READ-ONLY below (can view but not edit)
If is_open = true: show form in edit mode
  Show closing date if closes_at is set:
  "Declaration window closes on {closes_at}. Submit before then."

TAX REGIME SELECTOR (only when window is open):
Two large radio buttons:
  NEW REGIME: "New Tax Regime (Default for FY 2026-27)"
    Subtext: "Lower tax rates, no deductions available"
  OLD REGIME: "Old Tax Regime"
    Subtext: "Higher tax rates but allows deductions under 80C, 80D, HRA etc."
  If regime change pending: show amber notice "New Tax Scheme - Request Pending" (like Kredily)

"Copy From Previous Year" button:
  If a declaration exists for the previous year, pre-fill all fields from it.
  Show toast: "Values copied from 2025-26 declaration. Review and update."

DECLARATION SECTIONS (shown as collapsible accordion):

SECTION 1: Deductions (Section 80C — max ₹1,50,000)
  Only shown if OLD REGIME selected.
  Fields with ₹ inputs:
  - PPF (Public Provident Fund)
  - LIC Premium
  - ELSS / Mutual Funds (ELSS)
  - NSC (National Savings Certificate)
  - Home Loan Principal Repayment
  - Tuition Fees (children)
  - Other 80C investments
  Running total: "Total 80C declared: ₹X / ₹1,50,000 limit"
  Progress bar showing how much of the ₹1.5L limit is used.

SECTION 2: Health Insurance (Section 80D)
  Only shown if OLD REGIME selected.
  - Health insurance premium (self + family): ₹
  - Health insurance premium (parents): ₹
  Max ₹25,000 self / ₹50,000 parents (show limit)

SECTION 3: HRA (House Rent Allowance)
  Only shown if OLD REGIME selected AND employee's salary has HRA component.
  - Annual rent paid: ₹
  - Landlord name: text
  - Landlord PAN: text (required if rent > ₹1 lakh/year — show note)

SECTION 4: Home Loan Interest (Section 24)
  - Interest on home loan: ₹ (max ₹2,00,000 self-occupied)

SECTION 5: Income from Previous Employer
  Shown for both regimes.
  - Previous employer name: text
  - Income from previous employer: ₹
  - TDS deducted by previous employer: ₹
  Note: "Required if you joined this company during the financial year"

SECTION 6: Reimbursements
  - LTA (Leave Travel Allowance): ₹
  - Medical reimbursement: ₹

OVERVIEW TAB (matches Kredily's Overview):
Summary table:
  Section | Declared Amount | Status
  80C Deductions | ₹X | {No Entry Yet / Submitted}
  80D Health Insurance | ₹X | ...
  HRA | ₹X | ...
  Previous Employer | ₹X | ...
  Reimbursements | ₹X | ...

SAVE AS DRAFT button: saves without submitting
SUBMIT button: changes status to 'submitted', sets submitted_at
  Confirm modal: "Submit your tax declaration for FY 2026-27? HR will be notified."
  After submit: form becomes read-only. Show "Submitted on {date}" badge.

STEP 3 — Add to employee payroll tabs:
Update src/payroll/employee/MyPayslips.tsx (or wherever employee payroll lives):
Add "Declaration" as the third tab (between Salary Structure and Bank Account).
Tabs order: Pay Slip | Salary Structure | Declaration | Bank Account

STEP 4 — Create HR Declaration Management view:
In src/payroll/hr/ (or src/hr/ — wherever makes sense in your structure):
Create TaxDeclarationHR.tsx

Route: /hr/declarations (add to HR sidebar under Payroll section)

DECLARATION WINDOW MANAGEMENT:
Toggle per financial year: "Open Declaration Window" / "Close Declaration Window"
Set closing date (optional)
Shows: "X of Y employees have submitted declarations"

EMPLOYEE DECLARATIONS TABLE:
Columns: Employee | FY | Tax Regime | 80C Total | Status | Submitted On | Actions

Actions:
  View: opens employee's full declaration as read-only
  Verify: marks declaration as verified_by_hr, HR can add notes
  Download: exports declaration as PDF

STEP 5 — Notification for declaration window:
When HR opens declaration window: create notification for ALL employees:
  title: "IT Declaration Window is Open"
  body: "Submit your investment declarations for FY {year} before {closing_date}."

DO NOT change existing TDS calculation in payroll.
TDS in payroll remains manual (HR enters monthly TDS in salary structure).
The declaration data is for HR's reference to set the correct TDS amount.
Auto-computation of TDS from declarations is a future enhancement.
```

---

## SPRINT 2 — GIT COMMIT SEQUENCE

```bash
# After S2-A:
git add . && git commit -m "feat: S2-A — organisation hierarchy and interactive org chart"

# After S2-B:
git add . && git commit -m "feat: S2-B — PMS project management system above tasks"

# After S2-C:
git add . && git commit -m "feat: S2-C — expense management with payroll integration"

# After S2-D:
git add . && git commit -m "feat: S2-D — insurance management with RM contact"

# After S2-E:
git add . && git commit -m "feat: S2-E — IT tax declaration with window management"

# Sprint 2 complete:
git tag v3.1.0-sprint2
```

---

## SPRINT 2 FEATURE SUMMARY

| Prompt | Feature | DB Changes | Frontend | Difficulty |
|--------|---------|------------|----------|------------|
| S2-A | Org Chart | None (uses manager_id) | New recursive component + page | Medium |
| S2-B | PMS (Projects) | projects table (already exists) | New pages, minimal task change | Medium |
| S2-C | Expense Management | expenses table (already exists) | New pages + payroll line item | Medium |
| S2-D | Insurance | insurance_policies table (exists) | New pages, very simple | Low |
| S2-E | Tax Declaration | 2 new tables | Complex form, read-only logic | Medium-High |

After Sprint 2, TalentMesh matches or exceeds Kredily on every visible feature
from the screenshots provided. The only remaining gap is the Rewards/perks
marketplace which requires a third-party partner.
```
