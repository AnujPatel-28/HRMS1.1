import { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import type { Attendance, Employee, Leave, Task } from "../types";
import { useTenant } from "../contexts/TenantContext";
import { db, storage, insforge } from "../insforge/client";
import { useAuditLog } from "../hooks/useAuditLog";
import { useEmployee } from "../hooks/useEmployee";
import { Skeleton } from "../shared/Skeleton";
import { EmptyState } from "../shared/EmptyState";
import { useToast } from "../shared/ToastContext";
import { File, Calendar, ClipboardList, MoreVertical, Upload, Loader2, Trash2, Camera, Lock, Eye, EyeOff, CheckCircle2, X, ChevronDown, Printer, Network } from "lucide-react";
import { ConfirmModal } from "../shared/ConfirmModal";

type TabKey = "personal" | "identity" | "documents" | "attendance" | "leaves" | "tasks" | "id_card";

type StorageDoc = {
  key: string;
  url: string;
  uploadedAt: string;
  size: number;
};

const tabs: { key: TabKey; label: string }[] = [
  { key: "personal", label: "Personal & Job Info" },
  { key: "identity", label: "Identity & Bank" },
  { key: "documents", label: "Documents" },
  { key: "attendance", label: "Attendance History" },
  { key: "leaves", label: "Leave History" },
  { key: "tasks", label: "Tasks" },
  { key: "id_card", label: "ID Card" },
];

import { formatLocalDate } from "../utils/date";
import { IDCard } from "../shared/components/IDCard";

const maskValue = (value: string | null, visible: boolean, minVisible = 4) => {
  if (!value) return "—";
  if (visible) return value;
  if (value.length <= minVisible) return "*".repeat(value.length);
  return `${"*".repeat(Math.max(value.length - minVisible, 0))}${value.slice(-minVisible)}`;
};

export default function EmployeeDetail() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const navigate = useNavigate();
  const { tenantId, tenant } = useTenant();
  const { logAction } = useAuditLog();
  const { success, error: toastError } = useToast();
  const { employee: currentHrEmployee } = useEmployee();

  const [activeTab, setActiveTab] = useState<TabKey>("personal");
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Employee>>({});
  const [activeEmployees, setActiveEmployees] = useState<Employee[]>([]);
  const [managerSearch, setManagerSearch] = useState("");
  const [isManagerDropdownOpen, setIsManagerDropdownOpen] = useState(false);
  const [directReportsCount, setDirectReportsCount] = useState(0);
  const managerDropdownRef = useRef<HTMLDivElement>(null);

  const selectedManager = useMemo(() => {
    return activeEmployees.find((emp) => emp.id === editForm.manager_id);
  }, [activeEmployees, editForm.manager_id]);

  useEffect(() => {
    if (isEditing) {
      if (selectedManager && !isManagerDropdownOpen) {
        setManagerSearch(selectedManager.full_name);
      } else if (!editForm.manager_id && !isManagerDropdownOpen) {
        setManagerSearch("");
      }
    } else {
      setManagerSearch(employee?.manager_name || "");
    }
  }, [selectedManager, editForm.manager_id, isManagerDropdownOpen, isEditing, employee]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (managerDropdownRef.current && !managerDropdownRef.current.contains(event.target as Node)) {
        setIsManagerDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredManagers = useMemo(() => {
    const q = managerSearch.toLowerCase().trim();
    if (!q) return activeEmployees;
    return activeEmployees.filter(emp => emp.full_name.toLowerCase().includes(q));
  }, [activeEmployees, managerSearch]);

  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [documents, setDocuments] = useState<StorageDoc[]>([]);
  const [uploadingDoc, setUploadingDoc] = useState(false);

  // ID Card and Visiting Card states
  const [idSide, setIdSide] = useState<"front" | "back">("front");
  const [visitingSide, setVisitingSide] = useState<"front" | "back">("front");
  const idCardRef = useRef<HTMLDivElement>(null);
  const visitingCardRef = useRef<HTMLDivElement>(null);

  const printCard = (cardRef: React.RefObject<HTMLDivElement | null>, filename: string) => {
    const card = cardRef.current;
    if (!card) return;

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("Please allow popups to print/download your card.");
      return;
    }

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
              background: white;
            }
            .card-wrapper {
              width: 85.6mm;
              height: 53.98mm;
              overflow: hidden;
              border-radius: 3mm;
            }
            * {
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
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

  // Remote Exceptions states
  const [exceptions, setExceptions] = useState<any[]>([]);
  const [exceptionModalOpen, setExceptionModalOpen] = useState(false);
  const [exceptionStartDate, setExceptionStartDate] = useState(formatLocalDate(new Date()));
  const [exceptionEndDate, setExceptionEndDate] = useState(formatLocalDate(new Date()));
  const [exceptionType, setExceptionType] = useState<"work_from_home" | "client_visit" | "business_travel" | "field_work" | "other">("work_from_home");
  const [exceptionReason, setExceptionReason] = useState("");
  const [submittingException, setSubmittingException] = useState(false);

  const handleUploadDocument = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !employee || !tenantId) return;

    setUploadingDoc(true);
    try {
      const getUuid = () => {
        if (typeof window !== "undefined" && window.crypto && window.crypto.randomUUID) {
          return window.crypto.randomUUID();
        }
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === "x" ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
      };
      const fileExt = file.name.split('.').pop() || "bin";
      const path = `${tenantId}/${employee.id}/${getUuid()}.${fileExt}`;
      const { data: uploadData, error: uploadError } = await storage.from("employee-documents").upload(path, file);
      if (uploadError || !uploadData) throw uploadError || new Error("Upload failed");

      const { error: insertError } = await db.from("employee_documents").insert([{
        tenant_id: tenantId,
        employee_id: employee.id,
        file_name: file.name,
        file_url: uploadData.url,
        file_key: uploadData.key,
        size: uploadData.size,
      }]);
      if (insertError) {
        await storage.from("employee-documents").remove(uploadData.key);
        throw insertError;
      }

      await loadData();
      success("Document uploaded successfully.");
    } catch (err) {
      console.error(err);
      toastError("Failed to upload document.");
    } finally {
      setUploadingDoc(false);
    }
  };
  const [deleteConfirmDocKey, setDeleteConfirmDocKey] = useState<string | null>(null);
  const [deletingDoc, setDeletingDoc] = useState(false);

  const handleDeleteDocument = async () => {
    if (!deleteConfirmDocKey || !employee || !tenantId) return;

    setDeletingDoc(true);
    try {
      const { error: dbError } = await db
        .from("employee_documents")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("employee_id", employee.id)
        .eq("file_key", deleteConfirmDocKey);
      if (dbError) throw dbError;

      const { error: storageError } = await storage.from("employee-documents").remove(deleteConfirmDocKey);
      if (storageError) throw storageError;

      await loadData();
      success("Document deleted successfully.");
      setDeleteConfirmDocKey(null);
    } catch (err) {
      console.error(err);
      toastError("Failed to delete document.");
    } finally {
      setDeletingDoc(false);
    }
  };

  const handleViewDocument = async (fileKey: string) => {
    if (!employee) return;
    try {
      const { data, error } = await storage.from("employee-documents").download(fileKey);
      if (error || !data) throw error;
      
      // Log audit action
      void logAction("employee.document_viewed", "employee", employee.id, { document: fileKey });
      
      const blobUrl = URL.createObjectURL(data);
      const win = window.open(blobUrl, "_blank");
      if (!win) {
        URL.revokeObjectURL(blobUrl);
        toastError("Please allow popups to view this document.");
        return;
      }
      const interval = setInterval(() => {
        if (win.closed) {
          URL.revokeObjectURL(blobUrl);
          clearInterval(interval);
        }
      }, 1000);
    } catch (e) {
      toastError("Failed to fetch secure document.");
      console.error(e);
    }
  };
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showSensitive, setShowSensitive] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Reset Password states (isolated from all other logic) ──
  type ResetStep = null | "sending" | "sent" | "confirming" | "done";
  const [resetStep, setResetStep] = useState<ResetStep>(null);
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  // ── Profile Photo Upload states & handlers ──
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !employee || !tenantId) return;

    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      toastError("Please upload a JPEG or PNG image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toastError("Image size must be less than 5MB.");
      return;
    }

    setUploadingAvatar(true);
    try {
      const getUuid = () => {
        if (typeof window !== "undefined" && window.crypto && window.crypto.randomUUID) {
          return window.crypto.randomUUID();
        }
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === "x" ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
      };
      const fileExt = file.name.split('.').pop() || "jpg";
      const path = `${tenantId}/${employee.id}/${getUuid()}.${fileExt}`;
      
      const { data: uploadData, error: uploadError } = await storage.from("employee-profile-photos").upload(path, file);
      if (uploadError || !uploadData) throw uploadError || new Error("Upload failed");

      const { error: updateError } = await db
        .from("employees")
        .update({ profile_photo_url: uploadData.url })
        .eq("tenant_id", tenantId)
        .eq("id", employee.id);

      if (updateError) throw updateError;

      void logAction("employee.avatar_updated", "employee", employee.id);

      success("Profile picture updated successfully.");
      await loadData();
    } catch (err) {
      console.error(err);
      toastError("Failed to update profile picture.");
    } finally {
      setUploadingAvatar(false);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  };

  const saveException = async () => {
    if (!employee) return;
    if (!exceptionReason.trim()) {
      toastError("Please enter a reason.");
      return;
    }
    if (exceptionEndDate < exceptionStartDate) {
      toastError("End date cannot be before start date.");
      return;
    }

    setSubmittingException(true);
    try {
      // Overlap check
      const { data: overlaps, error: overlapErr } = await db
        .from("attendance_location_exceptions")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("employee_id", employee.id)
        .eq("status", "approved")
        .lte("start_date", exceptionEndDate)
        .gte("end_date", exceptionStartDate);

      if (overlapErr) throw overlapErr;

      if (overlaps && overlaps.length > 0) {
        toastError("An approved remote exception already exists for this employee within the selected date range.");
        setSubmittingException(false);
        return;
      }

      const payload = {
        tenant_id: tenantId,
        employee_id: employee.id,
        exception_type: exceptionType,
        start_date: exceptionStartDate,
        end_date: exceptionEndDate,
        reason: exceptionReason.trim(),
        status: "approved" as const,
        requested_by: currentHrEmployee?.id ?? null,
        approved_by: currentHrEmployee?.id ?? null,
        approved_at: new Date().toISOString(),
      };

      const { error: insErr } = await db
        .from("attendance_location_exceptions")
        .insert([payload]);

      if (insErr) throw insErr;

      void logAction("attendance.remote_exception_created", "attendance_location_exceptions", null, {
        employee_id: employee.id,
        start_date: exceptionStartDate,
        end_date: exceptionEndDate,
        type: exceptionType,
      });

      success("Remote exception created successfully.");
      setExceptionModalOpen(false);
      setExceptionReason("");
      await loadData();
    } catch (err) {
      console.error(err);
      toastError("Failed to create remote exception.");
    } finally {
      setSubmittingException(false);
    }
  };

  const cancelException = async (id: string) => {
    if (!employee) return;
    if (!window.confirm("Are you sure you want to cancel this remote work exception?")) return;

    try {
      const { error: updErr } = await db
        .from("attendance_location_exceptions")
        .update({
          status: "cancelled" as const,
          cancelled_by: currentHrEmployee?.id ?? null,
          cancelled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId)
        .eq("id", id);

      if (updErr) throw updErr;

      void logAction("attendance.remote_exception_cancelled", "attendance_location_exceptions", id, {
        employee_id: employee.id,
      });

      success("Remote exception cancelled successfully.");
      await loadData();
    } catch (err) {
      console.error(err);
      toastError("Failed to cancel remote exception.");
    }
  };

  const loadData = async () => {
    if (!employeeId) return;

    setLoading(true);
    setError(null);

    const employeeRes = await db
      .from("employees")
      .select("*, manager:employees!manager_id(full_name)")
      .eq("tenant_id", tenantId)
      .eq("id", employeeId)
      .maybeSingle();
    if (employeeRes.error || !employeeRes.data) {
      setError(employeeRes.error?.message ?? "Employee not found.");
      setLoading(false);
      return;
    }

    const currentEmployee = {
      ...(employeeRes.data as any),
      manager_name: (employeeRes.data as any).manager?.full_name || null,
    } as Employee;
    setEmployee(currentEmployee);
    setEditForm(currentEmployee);

    if (tenantId) {
      db.from("employees")
        .select("id, full_name, designation, profile_photo_url")
        .eq("tenant_id", tenantId)
        .eq("status", "active")
        .neq("id", employeeId)
        .order("full_name")
        .then(({ data }) => {
          if (data) setActiveEmployees(data as Employee[]);
        });
    }

    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 29);

    const [attendanceRes, leavesRes, tasksRes, docsRes, exceptionsRes, reportsRes] = await Promise.all([
      db
        .from("attendance")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("employee_id", currentEmployee.id)
        .gte("date", formatLocalDate(fromDate))
        .order("date", { ascending: true }),
      db.from("leaves").select("*").eq("tenant_id", tenantId).eq("employee_id", currentEmployee.id).order("applied_at", { ascending: false }),
      db.from("tasks").select("*").eq("tenant_id", tenantId).eq("assigned_to", currentEmployee.id).order("created_at", { ascending: false }),
      db.from("employee_documents").select("*").eq("tenant_id", tenantId).eq("employee_id", currentEmployee.id).order("uploaded_at", { ascending: false }),
      db.from("attendance_location_exceptions")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("employee_id", currentEmployee.id)
        .order("start_date", { ascending: false }),
      db.from("employees")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("manager_id", currentEmployee.id),
    ]);

    setAttendance((attendanceRes.data as Attendance[]) ?? []);
    setLeaves((leavesRes.data as Leave[]) ?? []);
    setTasks((tasksRes.data as Task[]) ?? []);
    setExceptions((exceptionsRes.data ?? []) as any[]);
    setDirectReportsCount(reportsRes.count ?? 0);

    if (docsRes.error) {
      console.error("Database query error for employee documents:", docsRes.error);
      toastError(`Failed to load employee documents: ${docsRes.error.message}`);
    } else if (docsRes.data) {
      setDocuments(
        (docsRes.data as any[]).map((item) => ({
          key: item.file_key,
          url: item.file_url,
          uploadedAt: item.uploaded_at,
          size: item.size,
        })),
      );
    }

    setLoading(false);
  };

  useEffect(() => {
    void loadData();
  }, [employeeId, tenantId]);

  const attendanceMap = useMemo(() => {
    return attendance.reduce<Record<string, Attendance["status"]>>((acc, item) => {
      acc[item.date] = item.status;
      return acc;
    }, {});
  }, [attendance]);

  const lastThirtyDays = useMemo(() => {
    return Array.from({ length: 30 }).map((_, index) => {
      const day = new Date();
      day.setDate(day.getDate() - (29 - index));
      return day;
    });
  }, []);

  const updateField = (field: keyof Employee, value: string) => {
    setEditForm((current) => ({ ...current, [field]: value }));
  };

  const statusBadgeClass = (status: string) => {
    if (["active", "approved", "present", "in_progress"].includes(status)) return "bg-emerald-100 text-emerald-700";
    if (["inactive", "pending", "assigned", "submitted", "half_day", "on_leave"].includes(status)) return "bg-amber-100 text-amber-700";
    return "bg-rose-100 text-rose-700";
  };

  const saveChanges = async () => {
    if (!employee) return;

    setSaving(true);
    setError(null);

    const payload = {
      full_name: editForm.full_name,
      email: editForm.email,
      phone: editForm.phone,
      date_of_birth: editForm.date_of_birth,
      gender: editForm.gender,
      address: editForm.address,
      city: editForm.city,
      state: editForm.state,
      pincode: editForm.pincode,
      department: editForm.department,
      designation: editForm.designation,
      employee_code: editForm.employee_code,
      date_of_joining: editForm.date_of_joining,
      employment_type: editForm.employment_type,
      aadhaar_number: editForm.aadhaar_number,
      pan_number: editForm.pan_number,
      bank_name: editForm.bank_name,
      account_number: editForm.account_number,
      ifsc_code: editForm.ifsc_code,
      emergency_contact_name: editForm.emergency_contact_name,
      emergency_contact_phone: editForm.emergency_contact_phone,
      emergency_contact_relation: editForm.emergency_contact_relation,
      work_mode: editForm.work_mode || "office",
      grade: editForm.grade?.trim() || null,
      work_location: editForm.work_location || null,
      manager_id: editForm.manager_id || null,
    };

    const { error: updateError } = await db.from("employees").update(payload).eq("tenant_id", tenantId).eq("id", employee.id);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    void logAction("employee.updated", "employee", employee.id, { fields_changed: Object.keys(payload) });

    await loadData();
    setIsEditing(false);
    setSaving(false);
  };

  const updateStatus = async (status: Employee["status"]) => {
    if (!employee) return;
    setSaving(true);
    const { error: updateError } = await db.from("employees").update({ status }).eq("tenant_id", tenantId).eq("id", employee.id);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    if (status === "terminated") {
      void logAction("employee.terminated", "employee", employee.id);
    }

    await loadData();
    setSaving(false);
  };

  // ── Reset Password handlers ──
  const openPasswordReset = () => {
    if (!employee?.email) return;
    setResetError(null);
    setResetNewPassword("");
    setShowResetPassword(false);
    setResetStep("sent");
  };

  const confirmPasswordReset = async () => {
    if (!employee?.email || resetNewPassword.trim().length < 8) return;
    setResetLoading(true);
    setResetError(null);
    setResetStep("confirming");
    try {
      const fnRes = await insforge.functions.invoke("set-employee-password", {
        body: { email: employee.email, password: resetNewPassword.trim(), tenant_id: tenantId },
      });
      if (fnRes.error || !fnRes.data?.success) {
        const msg: string = fnRes.data?.error ?? fnRes.error?.message ?? "Failed to update password.";
        setResetError(msg);
        setResetStep("sent");
      } else {
        setResetStep("done");
        setResetNewPassword("");
        setShowResetPassword(false);
      }
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "Failed to update password.");
      setResetStep("sent");
    } finally {
      setResetLoading(false);
    }
  };

  const cancelReset = () => {
    setResetStep(null);
    setResetNewPassword("");
    setShowResetPassword(false);
    setResetError(null);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-48 w-full rounded-2xl" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="text-sm text-rose-600">{error ?? "Employee not found."}</p>
        <button
          type="button"
          onClick={() => navigate("/hr/employees")}
          className="mt-3 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
        >
          Back to list
        </button>
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div 
            onClick={isEditing ? () => avatarInputRef.current?.click() : undefined}
            className={`relative group rounded-full overflow-hidden shrink-0 h-14 w-14 shadow-sm ${isEditing ? "cursor-pointer" : "cursor-default"}`}
            title={isEditing ? "Change profile picture" : undefined}
          >
            {employee.profile_photo_url ? (
              <img src={employee.profile_photo_url} alt={employee.full_name} className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full w-full place-items-center bg-slate-200 text-sm font-semibold text-slate-700">
                {employee.full_name.slice(0, 2).toUpperCase()}
              </div>
            )}
            
            {/* Hover Camera Overlay (only visible in edit mode) */}
            {isEditing && (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                <Camera className="h-4 w-4 text-white" />
              </div>
            )}

            {/* Uploading overlay */}
            {uploadingAvatar && (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                <Loader2 className="h-4 w-4 text-white animate-spin" />
              </div>
            )}

            <input
              type="file"
              ref={avatarInputRef}
              onChange={handleAvatarChange}
              accept="image/jpeg,image/png"
              className="hidden"
            />
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-slate-900 truncate">{employee.full_name}</h2>
            <div className="mt-1 flex items-center gap-2 text-sm text-slate-500 min-w-0">
              <span className="truncate">{employee.employee_code ?? "No employee code"}</span>
              <span className="text-slate-300 shrink-0">&bull;</span>
              <span className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${statusBadgeClass(employee.status)}`}>
                <span className={`h-1 w-1 rounded-full ${employee.status === 'active' ? 'bg-emerald-500' : employee.status === 'inactive' ? 'bg-amber-500' : 'bg-rose-500'}`}></span>
                {employee.status}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 relative shrink-0">
          {isEditing ? (
            <button
              type="button"
              onClick={() => {
                setIsEditing(false);
                setEditForm(employee);
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 transition"
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 transition"
            >
              Edit
            </button>
          )}
          {isEditing ? (
            <button
              type="button"
              onClick={() => {
                void saveChanges();
              }}
              disabled={saving}
              className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60 transition"
            >
              Save
            </button>
          ) : null}
          
          {/* Action Menu Toggle */}
          <button
            type="button"
            onClick={() => setShowActionsMenu(!showActionsMenu)}
            className="rounded-lg border border-slate-300 p-2 text-slate-700 hover:bg-slate-100 transition shadow-sm"
            title="More Actions"
          >
            <MoreVertical className="h-5 w-5" />
          </button>

          {/* Action Menu Dropdown */}
          {showActionsMenu && (
            <div 
              className="fixed inset-0 z-40 cursor-default" 
              onClick={() => setShowActionsMenu(false)} 
              onTouchEnd={(e) => {
                e.preventDefault();
                setShowActionsMenu(false);
              }}
              aria-hidden="true"
            />
          )}
          <div className={`absolute right-0 top-full mt-2 w-48 flex-col gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-xl z-50 ${showActionsMenu ? "flex" : "hidden"}`}>
            <button
              type="button"
              disabled={saving || resetLoading || resetStep !== null}
              onClick={() => {
                openPasswordReset();
                setShowActionsMenu(false);
              }}
              className="w-full text-left rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 transition"
            >
              Reset Password
            </button>
            {employee.status !== "active" && (
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  void updateStatus("active");
                  setShowActionsMenu(false);
                }}
                className="w-full text-left rounded-lg px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-60 transition"
              >
                Reactivate
              </button>
            )}
            <button
              type="button"
              disabled={saving || employee.status === "inactive"}
              onClick={() => {
                void updateStatus("inactive");
                setShowActionsMenu(false);
              }}
              className="w-full text-left rounded-lg px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-60 transition"
            >
              Deactivate
            </button>
            <button
              type="button"
              disabled={saving || employee.status === "terminated"}
              onClick={() => {
                void updateStatus("terminated");
                setShowActionsMenu(false);
              }}
              className="w-full text-left rounded-lg px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60 transition"
            >
              Terminate
            </button>
          </div>
        </div>
      </div>

      {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}

      {/* ── Inline Reset Password panel ── */}
      {(resetStep === "sent" || resetStep === "confirming" || resetStep === "done") && (
        <div className="mt-4 rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50 to-indigo-50/40 p-5 shadow-sm relative overflow-hidden animate-fade-in">
          {/* Subtle background decoration */}
          <div className="absolute top-0 right-0 -mt-6 -mr-6 h-24 w-24 rounded-full bg-violet-100/30 blur-xl pointer-events-none" />
          
          {resetStep === "done" ? (
            <div className="flex items-start gap-4">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-600 ring-4 ring-emerald-50">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-slate-900">Password updated successfully!</p>
                <p className="text-xs text-slate-500 mt-1">The employee can now log in with their new password.</p>
              </div>
              <button 
                type="button" 
                onClick={cancelReset} 
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition shadow-sm"
              >
                Dismiss
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-600 ring-1 ring-violet-500/20">
                    <Lock className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Reset Employee Password</h3>
                    <p className="text-xs text-slate-500 mt-1">
                      Set a new login password for <strong className="text-violet-700 font-semibold">{employee.email}</strong>. 
                      The employee will use it immediately.
                    </p>
                  </div>
                </div>
                <button 
                  type="button" 
                  onClick={cancelReset} 
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
                  title="Cancel"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {resetError && (
                <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700 flex items-start gap-2">
                  <span className="mt-0.5 shrink-0 block h-1.5 w-1.5 rounded-full bg-rose-500" />
                  <span>{resetError}</span>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Lock className="h-4 w-4" />
                  </div>
                  <input
                    type={showResetPassword ? "text" : "password"}
                    placeholder="New password, minimum 8 characters"
                    value={resetNewPassword}
                    onChange={(e) => setResetNewPassword(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-10 py-2.5 text-sm placeholder-slate-400 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20 shadow-sm"
                  />
                  {resetNewPassword.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowResetPassword(!showResetPassword)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 transition"
                    >
                      {showResetPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  disabled={resetLoading || resetNewPassword.trim().length < 8}
                  onClick={() => { void confirmPasswordReset(); }}
                  className="rounded-xl bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300 disabled:cursor-not-allowed px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors whitespace-nowrap flex items-center justify-center gap-2 animate-pulse-once"
                >
                  {resetLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    "Set Password"
                  )}
                </button>
              </div>
              {resetNewPassword.length > 0 && resetNewPassword.length < 8 && (
                <p className="text-[11px] font-medium text-amber-600 mt-1">
                  ⚠️ Password must be at least 8 characters.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex gap-2 border-b border-slate-200 pb-3 overflow-x-auto hide-scrollbar snap-x">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors snap-start ${
              activeTab === tab.key ? "bg-brand-50 text-brand-700 shadow-sm" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "personal" ? (
        <div className="mt-4 grid gap-5 md:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Full Name</span>
            <input
              value={editForm.full_name ?? ""}
              onChange={(event) => updateField("full_name", event.target.value)}
              disabled={!isEditing}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:border-transparent disabled:bg-transparent disabled:px-0 disabled:font-semibold disabled:opacity-100"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Email</span>
            <input
              value={editForm.email ?? ""}
              onChange={(event) => updateField("email", event.target.value)}
              disabled={true} // Hard-disabled to prevent Auth desync
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-500 outline-none transition-all disabled:border-transparent disabled:bg-transparent disabled:px-0 disabled:font-semibold disabled:opacity-100 cursor-not-allowed"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Phone</span>
            <input
              value={editForm.phone ?? ""}
              onChange={(event) => updateField("phone", event.target.value)}
              disabled={!isEditing}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:border-transparent disabled:bg-transparent disabled:px-0 disabled:font-semibold disabled:opacity-100"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Date of Joining</span>
            <input
              type="date"
              value={editForm.date_of_joining ?? ""}
              onChange={(event) => updateField("date_of_joining", event.target.value)}
              disabled={!isEditing}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:border-transparent disabled:bg-transparent disabled:px-0 disabled:font-semibold disabled:opacity-100"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Department</span>
            <input
              value={editForm.department ?? ""}
              onChange={(event) => updateField("department", event.target.value)}
              disabled={!isEditing}
              className="w-full capitalize rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:border-transparent disabled:bg-transparent disabled:px-0 disabled:font-semibold disabled:opacity-100"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Designation</span>
            <input
              value={editForm.designation ?? ""}
              onChange={(event) => updateField("designation", event.target.value)}
              disabled={!isEditing}
              className="w-full capitalize rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:border-transparent disabled:bg-transparent disabled:px-0 disabled:font-semibold disabled:opacity-100"
            />
          </label>
          <label className="text-sm md:col-span-2">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Address</span>
            <textarea
              value={editForm.address ?? ""}
              onChange={(event) => updateField("address", event.target.value)}
              disabled={!isEditing}
              rows={2}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:resize-none disabled:border-transparent disabled:bg-transparent disabled:px-0 disabled:font-semibold disabled:opacity-100"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Emergency Contact Name</span>
            <input
              value={editForm.emergency_contact_name ?? ""}
              onChange={(event) => updateField("emergency_contact_name", event.target.value)}
              disabled={!isEditing}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:border-transparent disabled:bg-transparent disabled:px-0 disabled:font-semibold disabled:opacity-100"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Emergency Contact Phone</span>
            <input
              value={editForm.emergency_contact_phone ?? ""}
              onChange={(event) => updateField("emergency_contact_phone", event.target.value)}
              disabled={!isEditing}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:border-transparent disabled:bg-transparent disabled:px-0 disabled:font-semibold disabled:opacity-100"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Work Mode</span>
            {isEditing ? (
              <select
                value={editForm.work_mode ?? "office"}
                onChange={(event) => updateField("work_mode", event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 bg-white"
              >
                <option value="office">Office</option>
                <option value="remote">Remote</option>
                <option value="hybrid">Hybrid</option>
              </select>
            ) : (
              <span className="capitalize font-semibold text-slate-900 block mt-2">
                {employee.work_mode ?? "office"}
              </span>
            )}
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Grade</span>
            {isEditing ? (
              <input
                value={editForm.grade ?? ""}
                onChange={(event) => updateField("grade", event.target.value)}
                placeholder="e.g. M3, Senior"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
            ) : (
              <span className="font-semibold text-slate-900 block mt-2">
                {employee.grade || "—"}
              </span>
            )}
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Work Location</span>
            {isEditing ? (
              <select
                value={editForm.work_location ?? ""}
                onChange={(event) => updateField("work_location", event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 bg-white"
              >
                <option value="">Select Work Location</option>
                <option value="Head Office">Head Office</option>
                <option value="Branch Office">Branch Office</option>
                <option value="Remote">Remote</option>
                <option value="Work From Home">Work From Home</option>
                <option value="Other">Other</option>
              </select>
            ) : (
              <span className="font-semibold text-slate-900 block mt-2">
                {employee.work_location || "—"}
              </span>
            )}
          </label>
          <div className="text-sm md:col-span-2 relative" ref={managerDropdownRef}>
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Reporting Manager</span>
            {isEditing ? (
              <>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search reporting manager..."
                    value={managerSearch}
                    onFocus={() => {
                      setIsManagerDropdownOpen(true);
                      if (selectedManager) {
                        setManagerSearch("");
                      }
                    }}
                    onChange={(e) => {
                      setManagerSearch(e.target.value);
                      setIsManagerDropdownOpen(true);
                    }}
                    className="w-full rounded-lg border border-slate-300 pl-3 pr-10 py-2 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 text-slate-900 font-normal"
                  />
                  {editForm.manager_id ? (
                    <button
                      type="button"
                      onClick={() => {
                        updateField("manager_id", "");
                        setManagerSearch("");
                      }}
                      className="absolute right-8 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-semibold"
                    >
                      Clear
                    </button>
                  ) : null}
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                    <ChevronDown className="h-4 w-4" />
                  </div>
                </div>

                {selectedManager && !isManagerDropdownOpen && (
                  <div className="mt-1.5 flex items-center gap-2 rounded-lg bg-slate-50 border border-slate-200 px-3 py-1.5 text-xs text-slate-700 font-normal">
                    {selectedManager.profile_photo_url ? (
                      <img src={selectedManager.profile_photo_url} alt="" className="h-5 w-5 rounded-full object-cover" />
                    ) : (
                      <div className="grid h-5 w-5 place-items-center rounded-full bg-slate-200 font-bold text-slate-600">
                        {selectedManager.full_name.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <span className="font-semibold text-slate-900">{selectedManager.full_name}</span>
                      <span className="text-slate-500"> — {selectedManager.designation || "No designation"}</span>
                    </div>
                  </div>
                )}

                {isManagerDropdownOpen && (
                  <div className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg ring-1 ring-black ring-opacity-5">
                    {filteredManagers.length === 0 ? (
                      <div className="px-4 py-2 text-slate-500 text-xs font-normal">No active employees found</div>
                    ) : (
                      filteredManagers.map((emp) => (
                        <button
                          key={emp.id}
                          type="button"
                          onClick={() => {
                            updateField("manager_id", emp.id);
                            setManagerSearch(emp.full_name);
                            setIsManagerDropdownOpen(false);
                          }}
                          className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 transition-colors font-normal ${
                            editForm.manager_id === emp.id ? "bg-slate-50 font-semibold" : ""
                          }`}
                        >
                          {emp.profile_photo_url ? (
                            <img src={emp.profile_photo_url} alt="" className="h-6 w-6 rounded-full object-cover" />
                          ) : (
                            <div className="grid h-6 w-6 place-items-center rounded-full bg-slate-100 font-bold text-slate-600 text-[10px]">
                              {emp.full_name.slice(0, 2).toUpperCase()}
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="text-xs text-slate-900 truncate font-semibold">{emp.full_name}</p>
                            <p className="text-[10px] text-slate-500 truncate">{emp.designation || "—"}</p>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </>
            ) : (
              <span className="font-semibold text-slate-900 block mt-2">
                {employee.manager_name || "—"}
              </span>
            )}
          </div>

          {/* Organisational Position Section */}
          <div className="md:col-span-2 mt-6 border-t border-slate-100 pt-6">
            <h3 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-2">
              <Network className="h-5 w-5 text-brand-600" />
              Organisational Position
            </h3>
            <div className="grid gap-4 sm:grid-cols-2 bg-slate-50/50 rounded-2xl border border-slate-200 p-5">
              <div className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Reports To</span>
                <p className="text-sm font-semibold mt-1">
                  {employee.manager_id ? (
                    <Link
                      to={`/hr/org-chart?focus=${employee.manager_id}`}
                      className="inline-flex items-center gap-1 text-brand-600 hover:text-brand-700 hover:underline font-semibold"
                    >
                      {employee.manager_name}
                    </Link>
                  ) : (
                    <span className="text-slate-500 italic">None (Top Level)</span>
                  )}
                </p>
              </div>

              <div className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Direct Reports</span>
                <p className="text-sm text-slate-900 font-semibold mt-1">
                  {directReportsCount} {directReportsCount === 1 ? "person reports" : "people report"} to this employee
                </p>
              </div>

              <div className="sm:col-span-2 space-y-1 border-t border-slate-200/60 pt-4">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Department Hierarchy</span>
                <div className="flex flex-wrap items-center gap-1.5 mt-2 text-sm text-slate-700 font-medium">
                  <span className="font-semibold text-slate-900">{tenant?.company_name || "Company"}</span>
                  <span className="text-slate-400">→</span>
                  <span className="capitalize font-semibold text-slate-900">{employee.department || "No Department"}</span>
                  <span className="text-slate-400">→</span>
                  <span className="font-semibold text-brand-600">{employee.full_name}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "identity" ? (
        <div className="mt-4">
          {!isEditing && (
            <button
              type="button"
              onClick={() => setShowSensitive((value) => !value)}
              className="mb-5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors shadow-sm"
            >
              {showSensitive ? "Hide" : "Show"} sensitive fields
            </button>
          )}

          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Aadhaar Number</span>
                {isEditing ? (
                  <input
                    value={editForm.aadhaar_number ?? ""}
                    onChange={(event) => updateField("aadhaar_number", event.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                  />
                ) : (
                  <p className="font-semibold text-slate-900">{maskValue(employee.aadhaar_number, showSensitive)}</p>
                )}
              </label>
            </div>
            <div>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">PAN Number</span>
                {isEditing ? (
                  <input
                    value={editForm.pan_number ?? ""}
                    onChange={(event) => updateField("pan_number", event.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                  />
                ) : (
                  <p className="font-semibold text-slate-900">{maskValue(employee.pan_number, showSensitive)}</p>
                )}
              </label>
            </div>
            <div>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Bank Name</span>
                {isEditing ? (
                  <input
                    value={editForm.bank_name ?? ""}
                    onChange={(event) => updateField("bank_name", event.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                  />
                ) : (
                  <p className="font-semibold text-slate-900">{employee.bank_name ?? "—"}</p>
                )}
              </label>
            </div>
            <div>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Account Number</span>
                {isEditing ? (
                  <input
                    value={editForm.account_number ?? ""}
                    onChange={(event) => updateField("account_number", event.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                  />
                ) : (
                  <p className="font-semibold text-slate-900">{maskValue(employee.account_number, showSensitive)}</p>
                )}
              </label>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">IFSC Code</span>
                {isEditing ? (
                  <input
                    value={editForm.ifsc_code ?? ""}
                    onChange={(event) => updateField("ifsc_code", event.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                  />
                ) : (
                  <p className="font-semibold text-slate-900">{maskValue(employee.ifsc_code, showSensitive, 2)}</p>
                )}
              </label>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "documents" ? (
        <div className="mt-4 space-y-4">
          {documents.length > 0 && (
            <div className="space-y-3">
              {documents.map((doc) => (
                <div key={doc.key} className="flex flex-wrap items-center justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600 ring-1 ring-brand-500/20">
                       <File className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{doc.key.split("/").pop()}</p>
                      <p className="text-xs font-medium text-slate-500 mt-0.5">{new Date(doc.uploadedAt).toLocaleString()} — {(doc.size / 1024).toFixed(1)} KB</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-3 md:mt-0">
                    <button
                      type="button"
                      onClick={() => handleViewDocument(doc.key)}
                      className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-brand-600 transition-colors shadow-sm"
                    >
                      View / Download
                    </button>
                    {isEditing && (
                      <button
                        type="button"
                        onClick={() => setDeleteConfirmDocKey(doc.key)}
                        className="rounded-lg border border-rose-200 bg-white p-2 text-rose-600 hover:bg-rose-50 hover:text-rose-700 transition-colors shadow-sm"
                        title="Delete Document"
                      >
                        <Trash2 className="h-5 w-5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {isEditing && (
            <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-8 text-center transition-colors hover:bg-slate-100/50">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-brand-500/20 mb-3">
                <Upload className="h-6 w-6" />
              </div>
              <p className="text-sm font-semibold text-slate-800">Upload employee document</p>
              <p className="text-xs text-slate-500 mt-1 mb-4">Supported files: PDF, DOCX, images (Max 10MB)</p>
              <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-brand-700 transition disabled:opacity-60">
                {uploadingDoc ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Select File
                  </>
                )}
                <input
                  type="file"
                  className="hidden"
                  disabled={uploadingDoc}
                  onChange={handleUploadDocument}
                />
              </label>
            </div>
          )}

          {!isEditing && documents.length === 0 && (
            <div className="py-4">
              <EmptyState icon={File} title="No documents" description="No uploaded documents found in storage." />
            </div>
          )}
        </div>
      ) : null}

      {activeTab === "attendance" ? (
        <div className="mt-4 space-y-6">
          <div>
            <p className="mb-4 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Last 30 days mini calendar</p>
            <div className="grid grid-cols-5 gap-2 sm:grid-cols-7 md:grid-cols-10">
              {lastThirtyDays.map((day) => {
                const dateKey = formatLocalDate(day);
                const status = attendanceMap[dateKey];
                const isFuture = day > new Date();

                const colorClass = isFuture
                  ? "bg-slate-50 text-slate-400 border border-slate-100 opacity-60"
                  : status === "present"
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-100 ring-1 ring-emerald-500/20 shadow-sm"
                    : status === "half_day"
                      ? "bg-amber-50 text-amber-700 border border-amber-100 ring-1 ring-amber-500/20 shadow-sm"
                      : status === "on_leave"
                        ? "bg-cyan-50 text-cyan-700 border border-cyan-100 ring-1 ring-cyan-500/20 shadow-sm"
                        : status === "absent"
                          ? "bg-rose-50 text-rose-700 border border-rose-100 ring-1 ring-rose-500/20 shadow-sm"
                          : "bg-white text-slate-500 border border-slate-200 shadow-sm";

                return (
                  <div key={dateKey} className={`rounded-xl p-2 text-center transition-transform hover:scale-105 cursor-default ${colorClass}`} title={`${dateKey} - ${isFuture ? "Future" : status || "No Record"}`}>
                    <div className="text-[10px] font-bold opacity-70">{day.getDate()}</div>
                    <div className="mt-1 text-sm font-bold uppercase">
                      {isFuture ? "—" : status === "on_leave" ? "L" : status === "present" ? "P" : status === "half_day" ? "H" : status === "absent" ? "A" : "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="border-t border-slate-100 pt-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="text-sm font-bold text-slate-900">Remote Work Exceptions</h4>
                <p className="text-xs text-slate-500">Approved temporary location verification bypasses.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setExceptionStartDate(formatLocalDate(new Date()));
                  setExceptionEndDate(formatLocalDate(new Date()));
                  setExceptionType("work_from_home");
                  setExceptionReason("");
                  setExceptionModalOpen(true);
                }}
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 transition"
              >
                + Add Exception
              </button>
            </div>

            {exceptions.length === 0 ? (
              <div className="rounded-xl border border-slate-200 border-dashed py-8 text-center text-xs text-slate-400">
                No active or historical remote exceptions found for this employee.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="min-w-full divide-y divide-slate-200 text-xs">
                  <thead className="bg-slate-50 text-left font-semibold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-4 py-2">Date Range</th>
                      <th className="px-4 py-2">Type</th>
                      <th className="px-4 py-2">Reason</th>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {exceptions.map((exc) => (
                      <tr key={exc.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 font-medium text-slate-900">
                          {formatLocalDate(new Date(exc.start_date))} to {formatLocalDate(new Date(exc.end_date))}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium capitalize text-slate-700">
                            {exc.exception_type.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-slate-600 max-w-xs truncate" title={exc.reason}>
                          {exc.reason}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${
                            exc.status === "approved"
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : exc.status === "cancelled"
                                ? "bg-slate-50 text-slate-500 border border-slate-200"
                                : "bg-amber-50 text-amber-700 border border-amber-200"
                          }`}>
                            {exc.status}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {exc.status === "approved" && (
                            <button
                              type="button"
                              onClick={() => void cancelException(exc.id)}
                              className="text-xs font-semibold text-rose-600 hover:text-rose-700"
                            >
                              Cancel
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {activeTab === "leaves" ? (
        <div className="mt-4 space-y-2">
          {leaves.length === 0 ? (
            <div className="py-4"><EmptyState icon={Calendar} title="No leaves" description="No leave records found." /></div>
          ) : (
            leaves.map((leave) => (
              <div key={leave.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">{leave.leave_type ?? "leave"} ({leave.start_date} — {leave.end_date})</p>
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadgeClass(leave.status)}`}>
                    {leave.status}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-600">{leave.reason}</p>
              </div>
            ))
          )}
        </div>
      ) : null}

      {activeTab === "tasks" ? (
        <div className="mt-4 space-y-2">
          {tasks.length === 0 ? (
            <div className="py-4"><EmptyState icon={ClipboardList} title="No tasks" description="No assigned tasks found." /></div>
          ) : (
            tasks.map((task) => (
              <div key={task.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">{task.title}</p>
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadgeClass(task.status)}`}>
                    {task.status}
                  </span>
                </div>
                {task.description ? <p className="mt-1 text-sm text-slate-600">{task.description}</p> : null}
              </div>
            ))
          )}
        </div>
      ) : null}

      {activeTab === "id_card" ? (
        <div className="mt-4 space-y-6">
          {!tenant ? (
            <div className="text-sm text-slate-500">Loading tenant details...</div>
          ) : (
            <div className="grid gap-8 md:grid-cols-2">
              {/* ID Card */}
              <div className="flex flex-col items-center p-5 rounded-2xl border border-slate-100 bg-slate-50/50 shadow-sm">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-4">Identity Card</h3>
                <div className="h-[215px] flex items-center justify-center">
                  <IDCard
                    ref={idCardRef}
                    employee={employee}
                    tenant={tenant}
                    side={idSide}
                    type="id"
                  />
                </div>
                <div className="mt-5 flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setIdSide("front")}
                    className={`rounded-md px-3.5 py-1 text-xs font-semibold transition ${
                      idSide === "front" ? "bg-brand-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Front Side
                  </button>
                  <button
                    type="button"
                    onClick={() => setIdSide("back")}
                    className={`rounded-md px-3.5 py-1 text-xs font-semibold transition ${
                      idSide === "back" ? "bg-brand-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Back Side
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => printCard(idCardRef, `${employee.full_name}_ID_Card_${idSide}`)}
                  className="mt-5 w-full max-w-[200px] flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-xs font-bold text-white shadow hover:bg-brand-700 active:scale-[0.98] transition"
                >
                  <Printer className="h-4 w-4" />
                  Print / PDF ({idSide === "front" ? "Front" : "Back"})
                </button>
              </div>

              {/* Visiting Card */}
              <div className="flex flex-col items-center p-5 rounded-2xl border border-slate-100 bg-slate-50/50 shadow-sm">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-4">Visiting Card</h3>
                <div className="h-[215px] flex items-center justify-center">
                  <IDCard
                    ref={visitingCardRef}
                    employee={employee}
                    tenant={tenant}
                    side={visitingSide}
                    type="visiting"
                  />
                </div>
                <div className="mt-5 flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setVisitingSide("front")}
                    className={`rounded-md px-3.5 py-1 text-xs font-semibold transition ${
                      visitingSide === "front" ? "bg-brand-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Front Side
                  </button>
                  <button
                    type="button"
                    onClick={() => setVisitingSide("back")}
                    className={`rounded-md px-3.5 py-1 text-xs font-semibold transition ${
                      visitingSide === "back" ? "bg-brand-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Back Side
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => printCard(visitingCardRef, `${employee.full_name}_Visiting_Card_${visitingSide}`)}
                  className="mt-5 w-full max-w-[200px] flex items-center justify-center gap-2 rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-bold text-white shadow hover:bg-slate-900 active:scale-[0.98] transition"
                >
                  <Printer className="h-4 w-4" />
                  Print / PDF ({visitingSide === "front" ? "Front" : "Back"})
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      <ConfirmModal
        isOpen={deleteConfirmDocKey !== null}
        onClose={() => setDeleteConfirmDocKey(null)}
        onConfirm={() => { void handleDeleteDocument(); }}
        title="Delete Document"
        message="Are you sure you want to delete this document? This action cannot be undone."
        confirmText="Delete"
        confirmColor="red"
        isSubmitting={deletingDoc}
      />

      {exceptionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" onClick={() => setExceptionModalOpen(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="border-b border-slate-200 px-5 py-4">
              <h3 className="text-lg font-semibold text-slate-900">Add Remote Exception</h3>
              <p className="mt-1 text-sm text-slate-500">Allow employee to bypass office geofencing constraints for a date range.</p>
            </div>
            
            <div className="space-y-4 px-5 py-5 text-sm">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block space-y-1">
                  <span className="font-medium text-slate-700">Start Date</span>
                  <input
                    type="date"
                    value={exceptionStartDate}
                    onChange={(e) => setExceptionStartDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="font-medium text-slate-700">End Date</span>
                  <input
                    type="date"
                    value={exceptionEndDate}
                    onChange={(e) => setExceptionEndDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none"
                  />
                </label>
              </div>
              
              <label className="block space-y-1">
                <span className="font-medium text-slate-700">Exception Type</span>
                <select
                  value={exceptionType}
                  onChange={(e) => setExceptionType(e.target.value as any)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none bg-white"
                >
                  <option value="work_from_home">Work From Home (WFH)</option>
                  <option value="client_visit">Client Visit</option>
                  <option value="business_travel">Business Travel</option>
                  <option value="field_work">Field Work</option>
                  <option value="other">Other Exception</option>
                </select>
              </label>
              
              <label className="block space-y-1">
                <span className="font-medium text-slate-700">Reason</span>
                <textarea
                  value={exceptionReason}
                  onChange={(e) => setExceptionReason(e.target.value)}
                  placeholder="Provide details about the exception location/need"
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none"
                />
              </label>
            </div>
            
            <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={() => setExceptionModalOpen(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveException()}
                disabled={submittingException}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
              >
                {submittingException ? "Saving..." : "Allow Remote Work"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
