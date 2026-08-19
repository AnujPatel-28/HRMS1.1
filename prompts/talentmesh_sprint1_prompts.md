# TalentMesh — Sprint 1 Build Prompts
# ID Card · Directory Upgrade · Plan Gating · Manager Role · Connect Feed
# Detailed, Agent-Safe. Run ONE prompt at a time. Git commit between each.

---

## PRE-SPRINT CHECKLIST

```bash
# Confirm your app is running perfectly before starting
npm run dev

# Confirm InsForge MCP is connected
# Run /mcp in your agent — insforge must show as connected

# Commit current state
git add .
git commit -m "baseline: before sprint 1 — kredily feature parity"
```

---

# PROMPT S1-A — Database Migrations (Foundation for all Sprint 1 features)
# Goal: Add new columns to existing tables. No frontend. No logic changes.
# Risk: Very Low — only adds columns, never removes or modifies existing ones.
# Time: 10 minutes

```
CONTEXT — READ FULLY BEFORE DOING ANYTHING:

I have a fully working multi-tenant TalentMesh HRMS SaaS built with
React + Vite frontend and InsForge (Postgres) backend.

The employees table currently has these columns that are working:
id, user_id, tenant_id, full_name, email, phone, date_of_birth, gender,
address, city, state, pincode, department, designation, employee_code,
date_of_joining, employment_type, status, aadhaar_number, pan_number,
bank_name, account_number, ifsc_code, emergency_contact_name,
emergency_contact_phone, emergency_contact_relation, profile_photo_url,
created_by, created_at, updated_at

YOUR TASK — ONLY DATABASE CHANGES, NOTHING ELSE:

Run these SQL statements via InsForge MCP one at a time.
Check if each column exists before adding (use IF NOT EXISTS).
Report result after each one.

STEP 1 — Add to employees table:
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS manager_id uuid REFERENCES employees(id),
  ADD COLUMN IF NOT EXISTS grade text,
  -- grade examples: L1, L2, L3, Senior, Lead, Manager, Director
  ADD COLUMN IF NOT EXISTS blood_group text,
  -- values: A+, A-, B+, B-, AB+, AB-, O+, O-
  ADD COLUMN IF NOT EXISTS work_location text,
  -- examples: Head Office, Branch Office, Remote, Work From Home
  ADD COLUMN IF NOT EXISTS linkedin_url text,
  ADD COLUMN IF NOT EXISTS employee_bio text;
  -- short bio shown on directory and ID card

Create index:
CREATE INDEX IF NOT EXISTS idx_employees_manager_id ON employees(manager_id);
CREATE INDEX IF NOT EXISTS idx_employees_tenant_grade ON employees(tenant_id, grade);

STEP 2 — Create posts table (for Connect / social feed — needed in Sprint 1D):
CREATE TABLE IF NOT EXISTS posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  content text NOT NULL,
  image_url text,
  type text NOT NULL DEFAULT 'post',
  -- allowed values: post / announcement / birthday / work_anniversary / welcome
  is_pinned boolean NOT NULL DEFAULT false,
  -- HR can pin announcements to top of feed
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS post_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  reaction text NOT NULL DEFAULT 'like',
  -- values: like / celebrate / clap / heart
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(post_id, employee_id)
  -- one reaction per employee per post
);

Enable RLS on both tables:
- posts: SELECT/INSERT/UPDATE/DELETE allowed only for own tenant_id
- post_reactions: same tenant_id policy
- For posts: employees can INSERT their own posts (author_id = auth.uid())
- For posts: only HR or the author can DELETE
- For posts: type = 'announcement' INSERT is restricted to HR role only

Create indexes:
CREATE INDEX IF NOT EXISTS idx_posts_tenant_created ON posts(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_reactions_post ON post_reactions(post_id);

STEP 3 — Create projects table (for PMS — needed in later sprint but add now):
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active',
  -- values: planning / active / on_hold / completed / cancelled
  manager_id uuid REFERENCES employees(id),
  start_date date,
  end_date date,
  created_by uuid REFERENCES employees(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

Add project_id to existing tasks table:
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id);
  -- nullable — existing tasks without a project remain as standalone tasks

Enable RLS on projects: same tenant_id policy.
Create index: CREATE INDEX IF NOT EXISTS idx_projects_tenant ON projects(tenant_id);

STEP 4 — Create insurance_policies table:
CREATE TABLE IF NOT EXISTS insurance_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  insurer_name text NOT NULL,
  policy_number text NOT NULL,
  policy_type text NOT NULL DEFAULT 'health',
  -- values: health / life / accident / dental / vision / group
  coverage_amount numeric,
  premium_amount numeric,
  premium_frequency text DEFAULT 'monthly',
  -- values: monthly / quarterly / annual
  start_date date,
  expiry_date date,
  status text NOT NULL DEFAULT 'active',
  -- values: active / expired / cancelled
  rm_name text,
  -- relationship manager name
  rm_phone text,
  rm_email text,
  rm_company text,
  notes text,
  policy_document_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

Enable RLS on insurance_policies:
- Employees can SELECT only their own rows (employee_id = auth employee id)
- HR can SELECT/INSERT/UPDATE/DELETE all rows for their tenant

STEP 5 — Create expenses table:
CREATE TABLE IF NOT EXISTS expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  title text NOT NULL,
  amount numeric NOT NULL,
  currency text NOT NULL DEFAULT 'INR',
  category text NOT NULL DEFAULT 'other',
  -- values: travel / food / accommodation / equipment / medical / other
  expense_date date NOT NULL,
  description text,
  receipt_url text,
  receipt_name text,
  status text NOT NULL DEFAULT 'pending',
  -- values: pending / approved / rejected / reimbursed
  reviewed_by uuid REFERENCES employees(id),
  reviewed_at timestamptz,
  rejection_reason text,
  payroll_run_id uuid REFERENCES payroll_runs(id),
  -- set when this expense is included in a payroll run
  reimbursed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

Enable RLS:
- Employees see only their own expense rows
- HR sees all rows for their tenant
Create index: CREATE INDEX IF NOT EXISTS idx_expenses_tenant_status ON expenses(tenant_id, status);

AFTER ALL STEPS:
1. List all new tables created with their column count.
2. List all new columns added to employees table.
3. List all RLS policies created.
4. Confirm all indexes created.
5. Report any errors.

DO NOT change any existing table structure beyond adding new columns.
DO NOT create any frontend code.
DO NOT modify any existing RLS policies.
```

---

# PROMPT S1-B — Plan-Based Feature Gating
# Goal: Features are shown/hidden/blurred based on tenant's plan (starter/growth/pro).
# What changes: New hook, new component, updates to layouts.
# What does NOT change: Existing feature logic, existing pages.
# Risk: Low — purely additive.
# Time: 2-3 hours

```
CONTEXT — READ FULLY BEFORE DOING ANYTHING:

I have a working multi-tenant TalentMesh HRMS. The tenants table has
a 'plan' column with values: trial / starter / growth / pro.

The current app shows all features to all users regardless of plan.
I need plan-based gating so:
- Starter plan: core HRMS only (attendance, leaves, holidays, policies, directory)
  Payroll, tasks, chat, org chart, Connect, expenses are VISIBLE but LOCKED
- Growth plan: everything except Pro-only features
  Geo-fence strict mode, shift management, custom branding are LOCKED
- Pro plan: everything unlocked
- Trial plan: treat as Growth (full access for 14 days)

STEP 1 — Create src/hooks/usePlanGate.ts:

This hook reads the current tenant's plan and returns whether a feature is allowed.

```typescript
// Feature names and which plan unlocks them
const FEATURE_PLANS: Record<string, string[]> = {
  // Starter features (all plans)
  'attendance': ['starter', 'growth', 'pro', 'trial'],
  'leaves': ['starter', 'growth', 'pro', 'trial'],
  'holidays': ['starter', 'growth', 'pro', 'trial'],
  'hr_policies': ['starter', 'growth', 'pro', 'trial'],
  'directory': ['starter', 'growth', 'pro', 'trial'],
  'employee_profiles': ['starter', 'growth', 'pro', 'trial'],
  'id_card': ['starter', 'growth', 'pro', 'trial'],

  // Growth features
  'tasks': ['growth', 'pro', 'trial'],
  'punch_gate': ['growth', 'pro', 'trial'],
  'chat': ['growth', 'pro', 'trial'],
  'payroll': ['growth', 'pro', 'trial'],
  'org_chart': ['growth', 'pro', 'trial'],
  'connect': ['growth', 'pro', 'trial'],
  'leave_accrual': ['growth', 'pro', 'trial'],
  'overtime': ['growth', 'pro', 'trial'],
  'late_marks': ['growth', 'pro', 'trial'],
  'expenses': ['growth', 'pro', 'trial'],
  'insurance': ['growth', 'pro', 'trial'],
  'pms': ['growth', 'pro', 'trial'],
  'audit_log': ['growth', 'pro', 'trial'],

  // Pro-only features
  'shifts': ['pro', 'trial'],
  'geofence_strict': ['pro', 'trial'],
  'custom_branding': ['pro'],  // trial doesn't get branding
  'api_access': ['pro'],
  'compliance_reports': ['pro', 'trial'],
  'priority_support': ['pro'],
};
```

Export:
```typescript
export function usePlanGate(feature: string) {
  const { tenant } = useTenant();  // from existing TenantContext
  const plan = tenant?.plan || 'trial';
  const allowedPlans = FEATURE_PLANS[feature] || [];
  const allowed = allowedPlans.includes(plan);
  const requiredPlan = Object.entries(FEATURE_PLANS)
    .find(([f]) => f === feature)?.[1]?.[0] || 'growth';
  return { allowed, plan, requiredPlan };
}
```

STEP 2 — Create src/shared/components/PlanGate.tsx:

A wrapper component that blurs locked content and shows an upgrade prompt.

Props:
- feature: string (the feature name from FEATURE_PLANS)
- children: ReactNode (the content to show when allowed)
- mode: 'blur' | 'hide' | 'disable' (default: 'blur')
  - blur: show content but blurred with lock overlay
  - hide: show nothing, just the upgrade prompt
  - disable: show content, disable interactions, show lock badge

When feature is LOCKED, show:
A semi-transparent overlay on top of blurred children with:
  - Lock icon (lucide-react Lock)
  - Text: "This feature requires [Growth/Pro] plan"
  - Button: "Upgrade Plan →" (links to /hr/settings/billing or shows upgrade modal)
  - The blurred content is visible but unreadable (CSS filter: blur(4px))

When feature is ALLOWED, just render children normally.

```tsx
// Usage example:
<PlanGate feature="payroll">
  <PayrollPage />
</PlanGate>

// For sidebar items:
<PlanGate feature="tasks" mode="disable">
  <SidebarItem icon={ClipboardList} label="Tasks" href="/hr/tasks" />
</PlanGate>
```

STEP 3 — Update sidebar items in HRLayout.tsx:
Wrap these sidebar items with PlanGate mode="disable":
- Tasks → feature="tasks"
- Chat → feature="chat"
- Calendar (accountability) → feature="tasks" (same gate)

Add a small lock icon badge next to locked sidebar items.
Clicking a locked sidebar item shows a toast:
"Tasks are available on Growth plan. Contact support to upgrade."

STEP 4 — Update EmployeeLayout.tsx:
Same gating for employee sidebar:
- My Tasks → feature="tasks"
- Chat → feature="chat"
- Connect → feature="connect"

STEP 5 — Update ProductSelector.tsx (or wherever the payroll module is launched):
Wrap the Payroll product card with PlanGate:
```tsx
<PlanGate feature="payroll" mode="blur">
  <PayrollCard onClick={() => navigate('/payroll/hr/salaries')} />
</PlanGate>
```

STEP 6 — Add plan indicator to HR header:
In HRLayout.tsx header, next to the company name, show a small plan badge:
- Trial: amber badge "Trial"
- Starter: gray badge "Starter"
- Growth: green badge "Growth"
- Pro: purple badge "Pro"

When HR clicks the badge → navigates to /hr/settings/billing
(The billing page doesn't need to exist yet — just navigate there,
show "Contact support to upgrade your plan: hello@talentmesh.in")

DO NOT change any existing feature logic.
DO NOT remove access to any currently working feature.
Only ADD the gating layer around locked features.
Test: log in as HR on a starter plan (update tenant.plan='starter' in DB),
confirm payroll and tasks show blurred with upgrade prompt.
```

---

# PROMPT S1-C — Unified Sidebar + Directory Upgrade
# Goal: One sidebar for all modules. Directory shows manager, grade, location, filters.
# What changes: HRLayout sidebar, EmployeeLayout sidebar, EmployeeList/Directory page.
# What does NOT change: All existing pages and their logic.
# Risk: Low.
# Time: 3-4 hours

```
CONTEXT — READ FULLY BEFORE DOING ANYTHING:

I have a working TalentMesh HRMS. The HR portal lives at /hr/* and the
Employee portal at /employee/*. Both have separate layouts.

The employees table now has these new columns (added in S1-A):
manager_id (FK to employees), grade, blood_group, work_location,
linkedin_url, employee_bio.

PART A — Reorganise HR sidebar in HRLayout.tsx:

Current sidebar order (keep all existing items, just reorganise):
Current: Dashboard, Employees, Attendance, Leaves, Tasks, Policies,
         Holidays, Calendar, Chat, Settings/Policy Center

New sidebar structure with section labels:
SECTION: "People"
  - Dashboard (home icon)
  - Employees (users icon)
  - Directory (address-book icon) ← NEW item, goes to /hr/directory
  - Organisation Chart (hierarchy icon) ← NEW item, goes to /hr/org-chart

SECTION: "Attendance"
  - Attendance (calendar-check icon)
  - Shifts (clock icon) ← existing, add if not there

SECTION: "HR Management"
  - Leaves (beach icon)
  - Tasks (clipboard icon)
  - Holidays (gift icon)
  - Calendar (calendar icon)

SECTION: "Communication"
  - Chat (messages icon)
  - Connect (users-group icon) ← NEW item, goes to /hr/connect

SECTION: "Admin"
  - Policies (file-text icon)
  - Payroll (wallet icon) — links to payroll module
  - Policy Center (settings icon)

Section labels are small uppercase muted text, not clickable.
Add PlanGate wrappers from S1-B to locked items.

PART B — Create src/hr/Directory.tsx (new page, separate from EmployeeList):

The existing EmployeeList.tsx is an HR management tool (create, edit, terminate).
The new Directory.tsx is a searchable company directory visible to everyone.

Route: /hr/directory (HR view) — /employee/directory (Employee view, same component)

Directory page features:

HEADER:
"Company Directory" | "{count} employees" | Search box (search by name, designation, email)

FILTERS row:
Department dropdown | Grade dropdown | Work Location dropdown | Manager dropdown
"Clear filters" link

VIEW TOGGLE:
Grid view (cards) | List view (table) — store preference in localStorage

TABLE VIEW columns:
ID | Photo + Name | Department | Designation | Grade | Employee Manager | Work Location | Actions

"Employee Manager" column: show manager's name (join employees on manager_id).
If no manager assigned: show "—".

Actions column (HR only): "View Profile" button → /hr/employees/:id

GRID VIEW:
Employee cards in a 3-column grid (2 on mobile).
Each card:
  - Profile photo (circle avatar, initials if no photo)
  - Name (bold)
  - Designation
  - Department badge
  - Work location (small muted text with map pin icon)
  - Manager: "Reports to: [Manager Name]" (small muted text)
  - Email link (envelope icon)

Click any card → opens employee detail modal (not navigate away):
  Modal shows: photo, name, designation, department, grade, manager,
  work location, email, phone, employee code, date of joining, bio.
  Close button.
  HR-only: "Edit Profile" button → navigate to /hr/employees/:id

EMPLOYEE VIEW (/employee/directory):
Same directory but:
  - No "Actions" column with management buttons
  - No sensitive fields (Aadhaar, bank details never shown)
  - Click card → view-only modal (same fields as above minus sensitive)
  - Employees can see everyone in their company

Add to employee sidebar: "Directory" item with same icon.

PART C — Update EmployeeCreate.tsx and EmployeeDetail.tsx:

In the employee creation form (Step 2 — Job Info), add these fields:
  - Grade: text input (optional, examples: L1, L2, Senior, Lead)
  - Work Location: dropdown (options: Head Office, Branch Office, Remote, Work From Home, Other)
  - Manager: searchable dropdown of all active employees in this tenant
    Label: "Reports to (Manager)"
    Search by name, shows photo + name + designation in dropdown options
    Value stored as manager_id UUID

In EmployeeDetail.tsx, show these new fields in the Personal & Job Info tab.
Allow editing them (HR can update grade, work location, manager assignment).

PART D — Update existing EmployeeList.tsx:
Add "Grade" and "Work Location" filter dropdowns to the existing filters row.
Add "Manager" column to the table (show manager name or "—").
Keep all existing functionality.

DO NOT change any logic in Attendance, Leaves, Tasks, Payroll.
DO NOT modify the InsForge queries in any other hook except useEmployee.ts.
In useEmployee.ts: update the employee SELECT query to JOIN employees
on manager_id to get manager's full_name:
  SELECT e.*, m.full_name as manager_name
  FROM employees e
  LEFT JOIN employees m ON e.manager_id = m.id
  WHERE e.tenant_id = {tenantId}
```

---

# PROMPT S1-D — Digital ID Card + Visiting Card
# Goal: Every employee has an auto-generated digital ID card and visiting card.
#       Both downloadable as PDF. No backend changes. Pure frontend.
# What changes: New ID card page added to employee portal and HR view.
# What does NOT change: Everything existing.
# Risk: Very Low.
# Time: 2-3 hours

```
CONTEXT — READ FULLY BEFORE DOING ANYTHING:

I have a working TalentMesh HRMS. The employees table has these fields
that I will use for the card:
profile_photo_url, full_name, designation, department, employee_code,
blood_group (new column from S1-A), tenant.company_name, tenant.logo_url.

No backend changes are needed. This is 100% frontend — render employee
data as a styled card and use browser print for PDF download.

YOUR TASK:
Create src/shared/components/IDCard.tsx and integrate it into both portals.

STEP 1 — Create src/shared/components/IDCard.tsx:

This component renders TWO card types: ID card and Visiting card.
Both are standard credit card size: 85.6mm × 53.98mm (standard CR80).
In pixels at 96 DPI: 326px × 205px.

ID CARD design (front):
Background: company brand color (use a gradient from teal to darker teal
using the tenant's primary color or default to #1D9E75 → #0F6E56)
Top section: Company logo (tenant.logo_url) top-right corner, small
Center: Employee profile photo in a circle (120px diameter, white border)
Bottom section: white background
  - Employee full name (large, bold, dark)
  - Designation — Department (muted, smaller)
  - EMP ID: {employee_code} (small, label + value)
  - BLOOD GROUP: {blood_group || "—"} (small, label + value)
  - Company name at very bottom (small, muted)

ID CARD back:
White background with subtle company logo watermark (low opacity)
QR code (optional — generate QR of employee email using qrcode.react library)
Company address (from tenant_settings if available)
"This card is property of {company_name}. If found, please return."
Emergency contact section if blood_group is filled.

VISITING CARD design (front, dark theme):
Dark background: deep navy (#1a1a2e or similar dark professional color)
Top-left: Company logo (small, white version or original)
Name: large white bold text
Designation + Department: teal/accent color smaller text
Divider line (accent color)
Phone: phone icon + employee.phone
Email: envelope icon + employee.email
Work location: map pin + employee.work_location

VISITING CARD back:
Company logo centered (large)
Company name
Website / social links (from tenant settings)

IMPLEMENTATION:

```tsx
import { forwardRef } from 'react';

interface IDCardProps {
  employee: Employee;
  tenant: Tenant;
  side: 'front' | 'back';
  type: 'id' | 'visiting';
}

export const IDCardFront = forwardRef<HTMLDivElement, IDCardProps>(
  ({ employee, tenant }, ref) => (
    <div
      ref={ref}
      style={{
        width: '326px',
        height: '205px',
        borderRadius: '12px',
        overflow: 'hidden',
        position: 'relative',
        fontFamily: 'inherit',
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
      }}
    >
      {/* Render card content here */}
    </div>
  )
);
```

STEP 2 — Create src/employee/IDCardPage.tsx:

Route: /employee/id-card
Add to Employee sidebar: "My ID Card" with CreditCard icon from lucide-react.
Add to Employee Layout navigation.

Page layout:
Header: "My Digital Cards"
Subtitle: "Download your official identity cards"

Two card containers side by side (stack on mobile):

LEFT: ID Card
  Shows IDCardFront (id type)
  Toggle button below: "Front | Back" (like Kredily's screenshot)
  "Download PDF" button (purple/teal)

RIGHT: Visiting Card
  Shows IDCardFront (visiting type)
  Toggle button: "Front | Back"
  "Download PDF" button

DOWNLOAD PDF implementation:
Do NOT use any PDF library. Use browser print API:

```tsx
const downloadCard = (cardRef: RefObject<HTMLDivElement>, filename: string) => {
  const card = cardRef.current;
  if (!card) return;

  // Open a new window with just the card
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  printWindow.document.write(`
    <html>
      <head>
        <title>${filename}</title>
        <style>
          @page {
            size: 85.6mm 53.98mm;
            margin: 0;
          }
          body {
            margin: 0;
            padding: 0;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .card-wrapper {
            width: 85.6mm;
            height: 53.98mm;
            overflow: hidden;
            border-radius: 3mm;
          }
        </style>
        <link rel="stylesheet" href="${window.location.origin}/index.css">
      </head>
      <body>
        <div class="card-wrapper">
          ${card.outerHTML}
        </div>
        <script>
          window.onload = function() {
            window.print();
            window.onafterprint = function() { window.close(); };
          };
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
};
```

STEP 3 — Add ID Card view to HR employee detail:
In src/hr/EmployeeDetail.tsx, add a new tab: "ID Card"
Shows the employee's ID card and visiting card with Download buttons.
HR can download cards for any employee (useful for printing physical cards).

STEP 4 — Install qrcode.react for QR codes (optional, for ID card back):
Run: npm install qrcode.react
Use: <QRCodeSVG value={employee.email} size={80} />
Only on the ID card back side.

STEP 5 — Add "My ID Card" to employee sidebar:
In EmployeeLayout.tsx sidebar, add:
  <SidebarItem icon={CreditCard} label="My ID Card" href="/employee/id-card" />
Place it after "My Profile".

DO NOT change any existing employee pages.
DO NOT change any HR pages beyond adding the ID Card tab to EmployeeDetail.
Only create the new IDCard component and IDCardPage.
```

---

# PROMPT S1-E — Manager Role + View Toggle
# Goal: Add Manager as a third role. Managers can see their team's data.
#       Header toggle switches between "My View" and "Manager View".
# What changes: Auth role, new hook, Attendance page, header in both layouts.
# What does NOT change: HR admin features, employee features.
# Risk: Medium — touches auth and attendance queries. Test carefully.
# Time: 4-5 hours

```
CONTEXT — READ FULLY BEFORE DOING ANYTHING:

I have a working TalentMesh HRMS with two roles: 'hr' and 'employee'.
The employees table now has manager_id (added in S1-A).

A Manager is an employee who has other employees reporting to them
(other employees have manager_id pointing to this person's id).

Managers can:
  1. See their own employee view (attendance, leaves, tasks, payslips)
  2. Toggle to "Manager View" to see their DIRECT REPORTS only
  3. In Manager View: view attendance, leaves, tasks for their team
  4. Approve/reject leave requests from their direct reports
  5. Assign tasks to their direct reports

Managers CANNOT:
  - See all employees (only their team)
  - Access HR admin functions (payroll run, policy management, etc.)
  - See other teams' data
  - Create new employees

STEP 1 — Update InsForge Auth for manager role:
Managers are identified by checking if any employee has manager_id = their employee_id.
This check happens automatically — no manual role assignment needed.

Update the login flow in AuthContext.tsx:
After getting the user's employee record:
1. Check if any other employee has manager_id = this user's employee id:
   const { count } = await insforge.from('employees')
     .select('*', { count: 'exact', head: true })
     .eq('manager_id', currentEmployee.id)
     .eq('tenant_id', tenantId);
2. If count > 0: this user IS a manager.
   Set isManager = true in the auth context.
3. Store in auth context: { ...existingAuthData, isManager }
4. The user's role in InsForge JWT remains 'employee' — isManager is app-level only.

Export from AuthContext: isManager boolean.

STEP 2 — Create src/hooks/useManagerView.ts:

This hook manages the manager view toggle state.

```typescript
export function useManagerView() {
  const { currentEmployee, isManager } = useAuth();
  const [isManagerMode, setIsManagerMode] = useState(() => {
    // Persist preference
    return localStorage.getItem(`talentmesh_manager_mode_${currentEmployee?.id}`) === 'true';
  });

  const toggleManagerMode = () => {
    if (!isManager) return; // safety check
    const newMode = !isManagerMode;
    setIsManagerMode(newMode);
    localStorage.setItem(
      `talentmesh_manager_mode_${currentEmployee?.id}`,
      String(newMode)
    );
  };

  // Get list of direct report employee IDs
  const [directReportIds, setDirectReportIds] = useState<string[]>([]);
  useEffect(() => {
    if (!isManager || !currentEmployee) return;
    insforge.from('employees')
      .select('id')
      .eq('manager_id', currentEmployee.id)
      .eq('tenant_id', tenantId)
      .then(({ data }) => {
        setDirectReportIds(data?.map(e => e.id) || []);
      });
  }, [currentEmployee?.id]);

  return {
    isManager,
    isManagerMode,
    toggleManagerMode,
    directReportIds,
    // Convenience: IDs to filter by in manager mode
    filterIds: isManagerMode ? directReportIds : [currentEmployee?.id || ''],
  };
}
```

STEP 3 — Add Manager toggle to EmployeeLayout.tsx header:

In the header, add the manager toggle ONLY when isManager is true.
Design: exactly like Kredily's screenshot — a red pill toggle in the top-right.

```tsx
{isManager && (
  <div
    onClick={toggleManagerMode}
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '4px 12px',
      borderRadius: '20px',
      background: isManagerMode ? '#E24B4A' : 'var(--color-background-secondary)',
      color: isManagerMode ? '#fff' : 'var(--color-text-secondary)',
      cursor: 'pointer',
      fontSize: '12px',
      fontWeight: '500',
      transition: 'all 0.2s',
      userSelect: 'none',
    }}
  >
    <span>{isManagerMode ? 'Manager View' : 'My View'}</span>
  </div>
)}
```

When isManagerMode is ON:
- Show a subtle banner below the header:
  "Viewing as manager — showing your team of {directReportIds.length} members"
  Amber background, small text, dismiss button.

STEP 4 — Update src/employee/PunchInOut.tsx for manager mode:
When isManagerMode is true: hide the punch-in/out buttons.
Show instead: "Switch to My View to manage your own attendance."
(Managers access their own punch from "My View")

STEP 5 — Update src/employee/MyLeaves.tsx for manager mode:
When isManagerMode is true:
  Replace "Apply Leave" tab with "Team Leave Requests" tab.
  Show all pending leave requests from direct reports (filter by employee_id IN directReportIds).
  Approve/Reject buttons (same logic as HR leave approval, but scoped to directReportIds only).

STEP 6 — Update src/employee/MyTasks.tsx for manager mode:
When isManagerMode is true:
  Show two tabs: "My Tasks" and "Team Tasks".
  "Team Tasks" tab: shows all tasks where assigned_to IN directReportIds.
  Manager can assign new tasks to their direct reports from this view.
  Same task assignment form as HR, but assigned_to dropdown only shows their team.

STEP 7 — Create src/employee/MyTeam.tsx (new page, manager mode only):
Route: /employee/my-team (only accessible when isManager = true)
Add to employee sidebar: "My Team" (only visible when isManager = true)

Shows:
  Header: "Your Team" | "{count} direct reports"
  Grid of team member cards (same as Directory but filtered to direct reports)
  Each card: photo, name, designation, today's attendance status (present/absent/leave)
  Click card → see their attendance this month (calendar view, read-only)

This gives managers a quick team overview without going to HR admin.

STEP 8 — Update useAttendance.ts hook:
The attendance hook currently only fetches current employee's attendance.
Add support for manager view:

```typescript
// In the hook, add a parameter: viewMode: 'self' | 'team'
// When viewMode = 'team': fetch attendance WHERE employee_id IN (directReportIds)
// When viewMode = 'self': existing behavior unchanged
```

The existing HR attendance page is NOT changed — managers don't access that.

TEST CHECKLIST (run after completing all steps):
1. Employee with no direct reports: manager toggle is NOT visible in header ✓
2. Employee with direct reports: manager toggle IS visible ✓
3. Toggle ON: header shows "Manager View" in red pill ✓
4. Toggle ON: team leave requests show from direct reports ✓
5. Toggle ON: task view shows "Team Tasks" tab ✓
6. Toggle OFF: back to own data, toggle shows "My View" ✓
7. HR admin login: NO manager toggle visible (HR has full access already) ✓

DO NOT change any HR admin pages.
DO NOT change the Attendance.tsx HR page.
DO NOT change payroll, policies, or tasks pages.
Only add manager mode to: EmployeeLayout header, MyLeaves, MyTasks,
and create the new MyTeam page.
```

---

# PROMPT S1-F — Connect / Enterprise Social Feed
# Goal: Enterprise social feed with posts, announcements, birthday celebrations.
# What changes: New Connect page in both portals. Auto birthday posts via edge function.
# What does NOT change: Chat, tasks, HR admin pages.
# Risk: Low — new feature, nothing existing modified.
# Time: 4-5 hours

```
CONTEXT — READ FULLY BEFORE DOING ANYTHING:

I have a working TalentMesh HRMS with InsForge Realtime for chat.
The posts and post_reactions tables were created in S1-A.
The employees table has date_of_birth (existing column).

I need to build a "Connect" section — an enterprise social media feed
similar to Kredily's "Konnect" feature. Employees and HR can post,
HR can post announcements, and the system auto-posts birthday wishes.

STEP 1 — Create src/shared/pages/Connect.tsx:
This is ONE component used in BOTH portals:
  HR: /hr/connect (full access including posting announcements)
  Employee: /employee/connect (can post general posts, read all)

LAYOUT (exactly matching Kredily's Konnect layout from screenshot):

THREE-COLUMN layout on desktop, single column on mobile:

LEFT COLUMN (200px) — Profile mini card:
  Employee photo (circle)
  Name + designation
  Company name
  "Create a post" quick button

CENTER COLUMN (flexible) — Main feed:
  "Create a post" input box (click to expand to full post form)
  Posts in reverse chronological order

RIGHT COLUMN (240px) — Sidebar:
  "Today's Birthdays" section
  "Upcoming Birthdays" section (next 7 days)

CREATE A POST form (appears when user clicks the input):
  Text area: "What's on your mind, {firstName}?"
  Image upload: optional (uploads to InsForge Storage 'post-attachments' bucket)
  Post type (HR only): radio — General Post / Announcement
  POST button → INSERT into posts table
  On success: new post appears at top of feed, form resets

POST CARD design:
  Header row: company logo (for announcements) OR employee photo + name
  Name + designation | timestamp (e.g. "2 hours ago")
  If type='announcement': show amber "Announcements" badge (exact match to Kredily)
  Content text
  Image (if any) — full width below text, rounded corners
  Reaction bar: 👍 Like · 🎉 Celebrate · 👏 Clap + counts
  Clicking a reaction: UPSERT post_reactions, update count in UI

BIRTHDAY POST design:
  Cake emoji + "Happy Birthday" banner
  Employee name tagged with @mention styling
  Birthday image (use a generic celebration image or a simple designed banner
  — generate a colorful SVG banner with the employee name)
  Everyone can react + comment

PINNED ANNOUNCEMENTS:
Posts where is_pinned = true show at the very TOP of the feed,
above all other posts, with a pin icon indicator.
HR can pin/unpin announcements.

RIGHT SIDEBAR — Birthday section:
```tsx
// Fetch employees with birthday today or in next 7 days
const today = new Date();
const todayMMDD = `${today.getMonth()+1}-${today.getDate()}`;

// Query: employees where EXTRACT(MONTH FROM dob) = this month
// AND EXTRACT(DAY FROM dob) = today OR next 7 days
// Show: Today's Birthdays (if any) and Upcoming Birthdays
```

Today's Birthdays section:
  Title: "🎂 Today's Birthdays"
  List: avatar circle + name + "Today" tag
  If no birthdays today: "No birthdays today"

Upcoming Birthdays section:
  Title: "🎂 Upcoming Birthdays"
  List: avatar + name + date (e.g. "31 May")
  Show next 7 employees with upcoming birthdays

REALTIME:
Subscribe to InsForge Realtime on the posts table filtered by tenant_id.
When a new post is inserted, prepend it to the feed immediately.
Show a "New post" notification button at top when a post arrives while
user is scrolled down: "1 new post — click to refresh"

STEP 2 — Create InsForge Edge Function: auto-birthday-posts
Schedule: runs daily at 12:01 AM

Logic:
1. Get today's date: month = EXTRACT(MONTH FROM NOW()), day = EXTRACT(DAY FROM NOW())
2. For each active tenant:
   Find all employees where:
   EXTRACT(MONTH FROM date_of_birth) = month
   AND EXTRACT(DAY FROM date_of_birth) = day
   AND status = 'active'
3. For each birthday employee:
   Check if a birthday post already exists for this employee today
   (posts where type='birthday' AND author_id='system' AND DATE(created_at) = today
   AND content CONTAINS employee_id)
   If not exists: INSERT into posts:
   {
     tenant_id: tenant.id,
     author_id: firstHREmployeeId, // use the first active HR employee as author
     content: `🎂 Happy Birthday @${employee.full_name}! 
               Wishing you a wonderful day filled with joy and celebrations. 
               From the entire ${tenant.company_name} family! 🎉`,
     type: 'birthday',
     is_pinned: false
   }
4. Log: "Created X birthday posts for tenant Y"

Deploy this function and set up the schedule.

STEP 3 — Add Connect to both sidebars:

HR sidebar (HRLayout.tsx) — add under Communication section:
  <SidebarItem icon={Rss} label="Connect" href="/hr/connect" />

Employee sidebar (EmployeeLayout.tsx) — add after Chat:
  <SidebarItem icon={Rss} label="Connect" href="/employee/connect" />

STEP 4 — Add notification dot for new posts:
In both headers, add an unread post count badge to the Connect sidebar item.
Fetch count of posts created since the user's last_connect_visit
(store last visit timestamp in localStorage).
Reset count when user visits the Connect page.

STEP 5 — Work anniversary auto-posts (bonus feature):
Similar to birthday posts. Edge function also checks:
  employees where DATE_PART('month', date_of_joining) = month
  AND DATE_PART('day', date_of_joining) = day
  AND date_of_joining < today (so it's an anniversary, not first day)
  AND status = 'active'
Calculate years: EXTRACT(YEAR FROM AGE(NOW(), date_of_joining))
Create post: "🎊 Congratulations to @{name} on completing {years} year(s) at
{company_name}! Thank you for your dedication and hard work. 💪"

DO NOT change Chat feature (separate from Connect).
DO NOT change any existing task, attendance, or payroll logic.
DO NOT change any HR admin pages.
Only create Connect.tsx, the edge function, and update the two sidebars.
```

---

## SPRINT 1 — GIT COMMIT SEQUENCE

```bash
# After S1-A:
git add . && git commit -m "saas: S1-A — add manager_id, posts, projects, insurance, expenses tables"

# After S1-B:
git add . && git commit -m "saas: S1-B — plan-based feature gating with usePlanGate hook"

# After S1-C:
git add . && git commit -m "saas: S1-C — unified sidebar + directory upgrade with manager/grade columns"

# After S1-D:
git add . && git commit -m "saas: S1-D — digital ID card and visiting card with PDF download"

# After S1-E:
git add . && git commit -m "saas: S1-E — manager role, view toggle, team leave and task views"

# After S1-F:
git add . && git commit -m "saas: S1-F — Connect enterprise social feed with birthday auto-posts"

# Sprint 1 complete:
git tag v3.0.0-sprint1
```

---

## SPRINT 1 FEATURE SUMMARY

| Prompt | Feature | DB changes | Frontend | Hours |
|--------|---------|------------|----------|-------|
| S1-A | DB foundation | 5 new tables, 6 new columns | None | 0.5h |
| S1-B | Plan gating | None | New hook + component | 2-3h |
| S1-C | Sidebar + Directory | None | New page + layout update | 3-4h |
| S1-D | ID Card / Visiting Card | None | New component + page | 2-3h |
| S1-E | Manager role + toggle | None | New hook + sidebar updates | 4-5h |
| S1-F | Connect / social feed | Edge Function | New page + realtime | 4-5h |

Total estimated time with AI agent: 16-21 hours of agent work.
Your review/testing time: 4-6 hours.
Sprint 1 delivers 6 major features that match or exceed Kredily's offering.
