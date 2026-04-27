import { Navigate, Route, Routes } from "react-router-dom";
import type { ReactElement } from "react";
import EmployeeLayout from "./employee/EmployeeLayout";
import EmployeeChat from "./employee/Chat";
import EmployeeDashboard from "./employee/Dashboard";
import MyLeaves from "./employee/MyLeaves";
import MyProfile from "./employee/MyProfile";
import MyTasks from "./employee/MyTasks";
import Policies from "./employee/Policies";
import PunchInOut from "./employee/PunchInOut";
import HRAttendance from "./hr/Attendance";
import HRCalendar from "./hr/Calendar";
import HRChat from "./hr/Chat";
import HRDashboard from "./hr/Dashboard";
import EmployeeCreate from "./hr/EmployeeCreate";
import EmployeeDetail from "./hr/EmployeeDetail";
import EmployeeList from "./hr/EmployeeList";
import HolidayList from "./hr/HolidayList";
import HRLayout from "./hr/HRLayout";
import LeaveManagement from "./hr/LeaveManagement";
import PolicyUpload from "./hr/PolicyUpload";
import TaskManagement from "./hr/TaskManagement";
import { useAuth } from "./hooks/useAuth";
import Login from "./shared/Login";
import type { EmployeeRole } from "./types";

function RequireRole({ role, children }: { role: EmployeeRole; children: ReactElement }) {
  const { user, loading, role: currentRole } = useAuth();

  if (loading) {
    return <div className="grid min-h-screen place-items-center text-slate-500">Loading...</div>;
  }

  if (!user || currentRole !== role) {
    return <Navigate to="/" replace />;
  }

  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Login />} />

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
        <Route path="attendance" element={<HRAttendance />} />
        <Route path="leaves" element={<LeaveManagement />} />
        <Route path="tasks" element={<TaskManagement />} />
        <Route path="policies" element={<PolicyUpload />} />
        <Route path="holidays" element={<HolidayList />} />
        <Route path="calendar" element={<HRCalendar />} />
        <Route path="chat" element={<HRChat />} />
      </Route>

      <Route
        path="/employee"
        element={
          <RequireRole role="employee">
            <EmployeeLayout />
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
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
