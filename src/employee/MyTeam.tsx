import { useEffect, useState } from "react";
import { Users, Calendar as CalendarIcon, Clock, CheckCircle2, AlertTriangle, FileText, ChevronLeft, ChevronRight, X, UserPlus, Trash2 } from "lucide-react";
import type { Employee, Attendance, Leave, Holiday } from "../types";
import { db } from "../insforge/client";
import { useTenant } from "../contexts/TenantContext";
import { useAuth } from "../hooks/useAuth";
import { formatLocalDate } from "../utils/date";
import { Skeleton } from "../shared/Skeleton";
import { EmptyState } from "../shared/EmptyState";
import { useToast } from "../shared/ToastContext";
import AddTeamMemberModal from "./AddTeamMemberModal";
import { ConfirmModal } from "../shared/ConfirmModal";
import { useDepartmentLabel, useJobTitleLabel } from "../contexts/OrgUnitsContext";

const TODAY = formatLocalDate(new Date());

interface TeamMemberWithStatus extends Employee {
  todayAttendance?: Attendance | null;
  todayLeave?: Leave | null;
}

export default function MyTeam() {
  const deptLabel = useDepartmentLabel();
  const titleLabel = useJobTitleLabel();
  const { currentEmployee, isManager } = useAuth();
  const { tenantId } = useTenant();
  const { success, error } = useToast();

  const [loading, setLoading] = useState(true);
  const [team, setTeam] = useState<TeamMemberWithStatus[]>([]);
  const [selectedMember, setSelectedMember] = useState<Employee | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<{ id: string; name: string } | null>(null);
  const [cancellingRequest, setCancellingRequest] = useState(false);

  // Modal calendar states
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());
  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth()); // 0-indexed
  const [memberAttendance, setMemberAttendance] = useState<Attendance[]>([]);
  const [memberLeaves, setMemberLeaves] = useState<Leave[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);

  const fetchTeamData = async () => {
    if (!currentEmployee?.id || !tenantId) return;
    setLoading(true);
    try {
      // 1. Fetch direct reports (active + draft/pending statuses) from public view
      const { data: employeesData, error: empErr } = await db
        .from("employee_directory_public")
        .select("id, user_id, manager_id, full_name, profile_photo_url, job_title_id, org_unit_id, status")
        .eq("manager_id", currentEmployee.id)
        .eq("tenant_id", tenantId)
        .in("status", ["active", "draft", "pending_onboarding", "pending_hr_review", "inactive"])
        .order("full_name");
      if (empErr) throw empErr;

      const teamList = (employeesData ?? []) as Employee[];
      if (teamList.length === 0) {
        setTeam([]);
        setLoading(false);
        return;
      }

      const teamIds = teamList.map(e => e.id);

      // 2. Fetch today's attendance records
      const { data: attendanceData } = await db
        .from("attendance")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("date", TODAY)
        .in("employee_id", teamIds);

      // 3. Fetch today's approved leaves
      const { data: leavesData } = await db
        .from("leaves")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("status", "approved")
        .lte("start_date", TODAY)
        .gte("end_date", TODAY)
        .in("employee_id", teamIds);

      // Map today's status to each team member
      const attMap: Record<string, Attendance> = {};
      (attendanceData ?? []).forEach((a: Attendance) => { attMap[a.employee_id] = a; });

      const leaveMap: Record<string, Leave> = {};
      (leavesData ?? []).forEach((l: Leave) => { leaveMap[l.employee_id] = l; });

      const teamWithStatus = teamList.map(member => ({
        ...member,
        todayAttendance: attMap[member.id] || null,
        todayLeave: leaveMap[member.id] || null
      }));

      setTeam(teamWithStatus);
    } catch (err) {
      console.error("Failed to load team data", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isManager) {
      void fetchTeamData();
    }
  }, [currentEmployee?.id, isManager, tenantId]);

  // Load calendar details for the selected team member
  const loadCalendarData = async (memberId: string, year: number, month: number) => {
    setCalendarLoading(true);
    const startOfMonth = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const endOfMonth = `${year}-${String(month + 1).padStart(2, "0")}-${new Date(year, month + 1, 0).getDate()}`;
    
    try {
      const [attRes, leavesRes, holsRes] = await Promise.all([
        db.from("attendance").select("*").eq("tenant_id", tenantId).eq("employee_id", memberId).gte("date", startOfMonth).lte("date", endOfMonth),
        db.from("leaves").select("*").eq("tenant_id", tenantId).eq("employee_id", memberId).eq("status", "approved").lte("start_date", endOfMonth).gte("end_date", startOfMonth),
        db.from("holidays").select("*").eq("tenant_id", tenantId).gte("date", startOfMonth).lte("date", endOfMonth)
      ]);

      setMemberAttendance((attRes.data ?? []) as Attendance[]);
      setMemberLeaves((leavesRes.data ?? []) as Leave[]);
      setHolidays((holsRes.data ?? []) as Holiday[]);
    } catch (err) {
      console.error("Failed to load calendar data", err);
    } finally {
      setCalendarLoading(false);
    }
  };

  useEffect(() => {
    if (selectedMember) {
      void loadCalendarData(selectedMember.id, calendarYear, calendarMonth);
    }
  }, [selectedMember, calendarYear, calendarMonth]);

  const handlePrevMonth = () => {
    if (calendarMonth === 0) {
      setCalendarMonth(11);
      setCalendarYear(prev => prev - 1);
    } else {
      setCalendarMonth(prev => prev - 1);
    }
  };

  const handleNextMonth = () => {
    if (calendarMonth === 11) {
      setCalendarMonth(0);
      setCalendarYear(prev => prev + 1);
    } else {
      setCalendarMonth(prev => prev + 1);
    }
  };

  const getTodayStatusLabel = (member: TeamMemberWithStatus) => {
    if (member.todayLeave) {
      return {
        label: "On Leave",
        color: "bg-blue-100 text-blue-700 border-blue-200",
        icon: <FileText className="h-3.5 w-3.5" />
      };
    }
    if (member.todayAttendance) {
      const status = member.todayAttendance.status;
      if (status === "half_day") {
        return {
          label: "Half Day",
          color: "bg-amber-100 text-amber-700 border-amber-200",
          icon: <Clock className="h-3.5 w-3.5" />
        };
      }
      return {
        label: "Present",
        color: "bg-emerald-100 text-emerald-700 border-emerald-200",
        icon: <CheckCircle2 className="h-3.5 w-3.5" />
      };
    }
    return {
      label: "Absent",
      color: "bg-slate-100 text-slate-500 border-slate-200",
      icon: <AlertTriangle className="h-3.5 w-3.5" />
    };
  };
  
  const handleCancelRequest = async (employeeId: string, name: string) => {
    setCancellingRequest(true);
    try {
      const { error: deleteErr } = await db
        .from("employees")
        .delete()
        .eq("id", employeeId)
        .eq("tenant_id", tenantId);

      if (deleteErr) throw deleteErr;

      success(`Successfully cancelled draft onboarding request for ${name}.`);
      setCancelTarget(null);
      void fetchTeamData();
    } catch (err: any) {
      error(err.message || "Failed to cancel request.");
      console.error(err);
    } finally {
      setCancellingRequest(false);
    }
  };

  // Generate calendar days
  const renderCalendarDays = () => {
    const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    const firstDayIndex = new Date(calendarYear, calendarMonth, 1).getDay(); // Day of week (0-6)
    
    const dayCells = [];

    // Empty cells for alignment
    for (let i = 0; i < firstDayIndex; i++) {
      dayCells.push(<div key={`empty-${i}`} className="h-10 w-10 sm:h-12 sm:w-12" />);
    }

    // Populate day cells
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${calendarYear}-${String(calendarMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const att = memberAttendance.find(a => a.date === dateStr);
      const isHol = holidays.some(h => h.date === dateStr);
      const onLeave = memberLeaves.some(l => dateStr >= l.start_date && dateStr <= l.end_date);
      
      const isWeekend = new Date(calendarYear, calendarMonth, day).getDay() === 0 || new Date(calendarYear, calendarMonth, day).getDay() === 6;

      let cellStyle = "bg-slate-50 text-slate-700 hover:bg-slate-100";
      let statusTooltip = "No record";

      if (att) {
        if (att.status === "half_day") {
          cellStyle = "bg-amber-100 text-amber-800 border border-amber-300 font-bold shadow-sm";
          statusTooltip = "Half Day";
        } else if (att.status === "present") {
          cellStyle = "bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold shadow-sm";
          statusTooltip = "Present";
        } else if (att.status === "on_leave") {
          cellStyle = "bg-blue-100 text-blue-800 border border-blue-300 font-bold shadow-sm";
          statusTooltip = "On Leave";
        } else {
          cellStyle = "bg-rose-100 text-rose-800 border border-rose-300 font-bold shadow-sm";
          statusTooltip = "Absent";
        }
      } else if (onLeave) {
        cellStyle = "bg-blue-50 text-blue-700 border border-blue-200 font-medium";
        statusTooltip = "Approved Leave";
      } else if (isHol) {
        cellStyle = "bg-purple-50 text-purple-700 border border-purple-200 font-medium";
        statusTooltip = "Holiday";
      } else if (isWeekend) {
        cellStyle = "bg-slate-100 text-slate-400 font-medium";
        statusTooltip = "Weekend";
      } else if (dateStr < TODAY) {
        cellStyle = "bg-rose-50 text-rose-600 border border-rose-100";
        statusTooltip = "Absent";
      }

      dayCells.push(
        <div
          key={day}
          title={`${day} ${new Date(calendarYear, calendarMonth).toLocaleString("default", { month: "long" })}: ${statusTooltip}`}
          className={`grid h-10 w-10 sm:h-12 sm:w-12 place-items-center rounded-xl text-sm font-semibold transition cursor-help ${cellStyle}`}
        >
          {day}
        </div>
      );
    }

    return dayCells;
  };

  const monthName = new Date(calendarYear, calendarMonth).toLocaleString("default", { month: "long" });

  if (!isManager) {
    return (
      <div className="p-6">
        <EmptyState
          icon={Users}
          title="Access Restricted"
          description="Only managers are authorized to view this team dashboard."
        />
      </div>
    );
  }

  return (
    <section className="space-y-6">
      {showAddModal && (
        <AddTeamMemberModal
          onClose={() => setShowAddModal(false)}
          onCreated={() => void fetchTeamData()}
        />
      )}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">My Team</h2>
          <p className="text-sm text-slate-500">Monitor your direct reports and check their monthly attendance.</p>
        </div>
        {isManager && (
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 shadow-sm"
          >
            <UserPlus className="h-4 w-4" />
            Add Team Member
          </button>
        )}
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
              <div className="flex gap-3">
                <Skeleton className="h-12 w-12 rounded-full" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
              <Skeleton className="h-8 w-full rounded-xl" />
            </div>
          ))}
        </div>
      ) : team.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No direct reports found"
          description="You do not have any employees assigned to you as direct reports."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {team.map(member => {
            const badge = getTodayStatusLabel(member);
            return (
              <div key={member.id} className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col justify-between hover:shadow-md transition ${member.status !== 'active' ? 'opacity-70 bg-slate-50/50' : ''}`}>
                <div className="flex gap-3">
                  {member.profile_photo_url ? (
                    <img src={member.profile_photo_url} alt="" className="h-12 w-12 rounded-full object-cover shrink-0 ring-2 ring-brand-100" />
                  ) : (
                    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
                      {member.full_name.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <h3 className="font-semibold text-slate-950 truncate">{member.full_name}</h3>
                      {member.status !== 'active' && (
                        <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700">
                          {!member.user_id ? 'Pending HR' : 'Inactive'}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 truncate">{titleLabel(member, "Employee")}</p>
                    <p className="text-[10px] text-slate-400 uppercase tracking-wide truncate">{deptLabel(member)} department</p>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                  {member.status === 'inactive' && !member.user_id ? (
                    <>
                      <div className="flex items-center gap-1 border px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-50 border-orange-200 text-orange-700">
                        <span>Draft Profile</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setCancelTarget({ id: member.id, name: member.full_name })}
                        className="flex items-center gap-1 text-xs font-semibold text-rose-600 hover:text-rose-700 transition"
                      >
                        <Trash2 className="h-4 w-4" />
                        <span>Cancel Request</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <div className={`flex items-center gap-1 border px-2.5 py-1 rounded-full text-xs font-semibold ${badge.color}`}>
                        {badge.icon}
                        <span>{badge.label}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedMember(member);
                          setCalendarYear(new Date().getFullYear());
                          setCalendarMonth(new Date().getMonth());
                        }}
                        className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700 transition"
                      >
                        <CalendarIcon className="h-4 w-4" />
                        <span>View Calendar</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Attendance Calendar Modal */}
      {selectedMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4">
            
            {/* Modal Header */}
            <div className="flex items-start justify-between">
              <div className="flex gap-3">
                {selectedMember.profile_photo_url ? (
                  <img src={selectedMember.profile_photo_url} alt="" className="h-10 w-10 rounded-full object-cover" />
                ) : (
                  <div className="grid h-10 w-10 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
                    {selectedMember.full_name.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div>
                  <h3 className="font-semibold text-slate-950">{selectedMember.full_name}</h3>
                  <p className="text-xs text-slate-400">{titleLabel(selectedMember, "Employee")}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedMember(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Month Navigator */}
            <div className="flex items-center justify-between border-t border-slate-100 pt-3">
              <h4 className="text-sm font-bold text-slate-800">{monthName} {calendarYear}</h4>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={handlePrevMonth}
                  className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={handleNextMonth}
                  className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Calendar Grid */}
            {calendarLoading ? (
              <div className="grid grid-cols-7 gap-1.5 p-2 place-items-center">
                {[...Array(35)].map((_, i) => (
                  <Skeleton key={i} className="h-10 w-10 sm:h-12 sm:w-12 rounded-xl" />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-7 gap-1.5 place-items-center text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                    <div key={i} className="w-10 sm:w-12 text-center">{d}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1.5 place-items-center">
                  {renderCalendarDays()}
                </div>

                {/* Legends */}
                <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-slate-100 pt-3 text-[10px] text-slate-500 justify-center">
                  <div className="flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                    <span>Present</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                    <span>Half Day</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
                    <span>Leave</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-full bg-purple-500" />
                    <span>Holiday</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
                    <span>Absent</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Cancellation Confirm Modal */}
      <ConfirmModal
        isOpen={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        onConfirm={() => {
          if (cancelTarget) {
            void handleCancelRequest(cancelTarget.id, cancelTarget.name);
          }
        }}
        title="Cancel Onboarding Request"
        message={`Are you sure you want to cancel the onboarding draft request for ${cancelTarget?.name}?`}
        confirmText="Cancel Request"
        confirmColor="red"
        isSubmitting={cancellingRequest}
      />
    </section>
  );
}
