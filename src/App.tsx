// Force reload for IDE diagnostics
import { Navigate, Route, Routes } from "react-router-dom";
import type { ReactElement } from "react";
import EmployeeLayout from "./employee/EmployeeLayout";
import IDCardPage from "./employee/IDCardPage";
import EmployeeChat from "./employee/Chat";
import EmployeeDashboard from "./employee/Dashboard";
import MyLeaves from "./employee/MyLeaves";
import MyProfile from "./employee/MyProfile";
import MyTasks from "./employee/MyTasks";
import Policies from "./employee/Policies";
import PunchInOut from "./employee/PunchInOut";
import MyTeam from "./employee/MyTeam";
import EmployeeExpenses from "./employee/Expenses";
import MyExit from "./employee/MyExit";
import OnboardingWizard from "./employee/OnboardingWizard";
import HRAttendance from "./hr/Attendance";
import HRCalendar from "./hr/Calendar";
import HRChat from "./hr/Chat";
import HRDashboard from "./hr/Dashboard";
import EmployeeCreate from "./hr/EmployeeCreate";
import EmployeeDetail from "./hr/EmployeeDetail";
import EmployeeList from "./hr/EmployeeList";
import Directory from "./hr/Directory";
import OffboardingManagement from "./hr/OffboardingManagement";
import HRExpenses from "./hr/Expenses";
import HolidayList from "./hr/HolidayList";
import HRLayout from "./hr/HRLayout";
import LeaveManagement from "./hr/LeaveManagement";
import PolicyCenter from "./hr/PolicyCenter";
import PolicyUpload from "./hr/PolicyUpload";
import ShiftManagement from "./hr/ShiftManagement";
import AttendanceDevices from "./hr/AttendanceDevices";
import OfficeLocations from "./hr/OfficeLocations";
import OrgStructureManagement from "./hr/OrgStructureManagement";
import TaskManagement from "./hr/TaskManagement";
import ProjectList from "./hr/pms/ProjectList";
import ProjectDetail from "./hr/pms/ProjectDetail";
import EmployeeProjectView from "./employee/pms/EmployeeProjectView";
import HRInsurance from "./hr/Insurance";
import EmployeeInsurance from "./employee/Insurance";
import PayrollLayout from "./payroll/PayrollLayout";
import TaxDeclarationHR from "./payroll/hr/TaxDeclarationHR";
import SalaryStructures from "./payroll/hr/SalaryStructures";
import RunPayroll from "./payroll/hr/RunPayroll";
import Payslips from "./payroll/hr/Payslips";
import EmployeePayrollLayout from "./payroll/employee/EmployeePayrollLayout";
import MyPayslips from "./payroll/employee/MyPayslips";
import { AuthProvider } from "./contexts/AuthContext";
import { TenantProvider } from "./contexts/TenantContext";
import { OrgUnitsProvider } from "./contexts/OrgUnitsContext";
import { useAuth } from "./hooks/useAuth";
import { ManagerViewProvider } from "./hooks/useManagerView";
import Login from "./shared/Login";
import Connect from "./shared/pages/Connect";
import OrgChart from "./shared/pages/OrgChart";
import { ToastProvider } from "./shared/ToastContext";
import AdminLayout from "./admin/AdminLayout";
import AdminDashboard from "./admin/AdminDashboard";
import AllCompanies from "./admin/AllCompanies";
import AddCompany from "./admin/AddCompany";
import Kiosk from "./kiosk/Kiosk";
import type { EmployeeRole } from "./types";

function LoadingScreen() {
  return <div className="grid min-h-screen place-items-center text-slate-500">Loading...</div>;
}

function RequireRole({ role, children }: { role: EmployeeRole; children: ReactElement }) {
  const { user, loading, role: currentRole } = useAuth();

  if (loading) return <LoadingScreen />;

  if (!user || currentRole !== role) {
    return <Navigate to="/" replace />;
  }

  return children;
}

function RequireSuperAdmin({ children }: { children: ReactElement }) {
  const { user, loading, role } = useAuth();

  if (loading) {
    return (
      <div style={{ display: "grid", minHeight: "100vh", placeItems: "center", background: "#0f172a", color: "#64748b" }}>
        Loading...
      </div>
    );
  }

  if (!user || role !== "superadmin") {
    return <Navigate to="/" replace />;
  }

  return children;
}

function RequireAuthTenant({ children }: { children: ReactElement }) {
  const { user, loading, role } = useAuth();

  if (loading) return <LoadingScreen />;

  if (!user || !role) {
    return <Navigate to="/" replace />;
  }

  if (role === "superadmin") {
    return <Navigate to="/admin/dashboard" replace />;
  }

  // OrgUnitsProvider sits INSIDE TenantProvider because it keys its fetch on tenantId. One
  // insertion point covers every tenant screen that renders a department label.
  return (
    <TenantProvider>
      <OrgUnitsProvider>{children}</OrgUnitsProvider>
    </TenantProvider>
  );
}

function AdminRoutes() {
  return (
    <AuthProvider>
      <Routes>
        <Route
          path="/"
          element={
            <RequireSuperAdmin>
              <AdminLayout />
            </RequireSuperAdmin>
          }
        >
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<AdminDashboard />} />
          <Route path="companies" element={<AllCompanies />} />
          <Route path="add-company" element={<AddCompany />} />
        </Route>
        <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
      </Routes>
    </AuthProvider>
  );
}

function TenantRoutes() {
  return (
    <RequireAuthTenant>
      <Routes>

        <Route
          path="/hr"
          element={
            <RequireRole role="hr">
              <HRLayout />
            </RequireRole>
          }
        >
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<HRDashboard />} />
          <Route path="employees" element={<EmployeeList />} />
          <Route path="employees/create" element={<EmployeeCreate />} />
          <Route path="employees/:employeeId" element={<EmployeeDetail />} />
          <Route path="offboarding" element={<OffboardingManagement />} />
          <Route path="attendance" element={<HRAttendance />} />
          <Route path="shifts" element={<ShiftManagement />} />
          <Route path="devices" element={<AttendanceDevices />} />
          <Route path="leaves" element={<LeaveManagement />} />
          <Route path="tasks" element={<TaskManagement />} />
          <Route path="policies" element={<PolicyUpload />} />
          <Route path="holidays" element={<HolidayList />} />
          <Route path="calendar" element={<HRCalendar />} />
          <Route path="chat" element={<HRChat />} />
          <Route path="policy-center" element={<PolicyCenter />} />
          <Route path="office-locations" element={<OfficeLocations />} />
          <Route path="org-structure" element={<OrgStructureManagement />} />
          <Route path="directory" element={<Directory />} />
          <Route path="org-chart" element={<OrgChart />} />
          <Route path="connect" element={<Connect />} />
          <Route path="pms" element={<ProjectList />} />
          <Route path="pms/:projectId" element={<ProjectDetail />} />
          <Route path="expenses" element={<HRExpenses />} />
          <Route path="insurance" element={<HRInsurance />} />
          <Route path="declarations" element={<TaxDeclarationHR />} />
          <Route path="settings" element={<Navigate to="/hr/policy-center" replace />} />
        </Route>

        <Route
          path="/payroll"
          element={
            <RequireRole role="hr">
              <PayrollLayout />
            </RequireRole>
          }
        >
          <Route index element={<Navigate to="hr/salaries" replace />} />
          <Route path="hr/salaries" element={<SalaryStructures />} />
          <Route path="hr/run" element={<RunPayroll />} />
          <Route path="hr/payslips" element={<Payslips />} />
        </Route>

        <Route
          path="/payroll/employee"
          element={
            <RequireRole role="employee">
              <EmployeePayrollLayout />
            </RequireRole>
          }
        >
          <Route index element={<Navigate to="payslips" replace />} />
          <Route path="payslips" element={<MyPayslips />} />
        </Route>

        <Route
          path="/employee"
          element={
            <RequireRole role="employee">
              <ManagerViewProvider>
                <EmployeeLayout />
              </ManagerViewProvider>
            </RequireRole>
          }
        >
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<EmployeeDashboard />} />
          <Route path="profile" element={<MyProfile />} />
          <Route path="punch" element={<PunchInOut />} />
          <Route path="leaves" element={<MyLeaves />} />
          <Route path="tasks" element={<MyTasks />} />
          <Route path="policies" element={<Policies />} />
          <Route path="chat" element={<EmployeeChat />} />
          <Route path="connect" element={<Connect />} />
          <Route path="directory" element={<Directory />} />
          <Route path="org-chart" element={<OrgChart />} />
          <Route path="id-card" element={<IDCardPage />} />
          <Route path="my-team" element={<MyTeam />} />
          <Route path="onboarding" element={<OnboardingWizard />} />
          <Route path="exit" element={<MyExit />} />
          <Route path="pms/:projectId" element={<EmployeeProjectView />} />
          <Route path="expenses" element={<EmployeeExpenses />} />
          <Route path="insurance" element={<EmployeeInsurance />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </RequireAuthTenant>
  );
}

function MainRoutes() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/*" element={<TenantRoutes />} />
        </Routes>
      </ToastProvider>
    </AuthProvider>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/admin/*" element={<AdminRoutes />} />
      {/* B8 kiosk adapter: a shared-tablet punch screen. Deliberately outside every auth
          provider above -- the device (serial + secret) is the authenticated thing, not an
          employee session, so it must not sit under RequireAuthTenant or any login gate. */}
      <Route path="/kiosk" element={<Kiosk />} />
      <Route path="/*" element={<MainRoutes />} />
    </Routes>
  );
}
// Trigger refresh
