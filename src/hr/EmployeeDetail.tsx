import { useEffect, useMemo, useState, useRef } from "react";
import { toLegacyEmploymentType } from "../utils/employmentType";
import { useNavigate, useParams, Link } from "react-router-dom";
import type { Attendance, Employee, EmployeeGrade, EmployeeUnitAssignment, Leave, Task } from "../types";
import { useTenant } from "../contexts/TenantContext";
import { db, storage, insforge } from "../insforge/client";
import { useAuditLog } from "../hooks/useAuditLog";
import { useEmployee } from "../hooks/useEmployee";
import { useOrgStructure } from "../hooks/useOrgStructure";
import { validateManagerAssignment } from "../utils/managerCycleValidation";
import { Skeleton } from "../shared/Skeleton";
import { EmptyState } from "../shared/EmptyState";
import { useToast } from "../shared/ToastContext";
import { File, Calendar, ClipboardList, MoreVertical, Upload, Loader2, Trash2, Camera, Lock, Eye, EyeOff, CheckCircle2, X, ChevronDown, Printer, Network } from "lucide-react";
import { ConfirmModal } from "../shared/ConfirmModal";
import InitiateExitModal from "./components/InitiateExitModal";
import EmployeeTimeline from "./components/EmployeeTimeline";

type TabKey = "personal" | "identity" | "documents" | "attendance" | "leaves" | "tasks" | "id_card" | "history";

type StorageDoc = {
  key: string;
  url: string;
  uploadedAt: string;
  size: number;
  name: string;
};

const tabs: { key: TabKey; label: string }[] = [
  { key: "personal", label: "Personal & Job Info" },
  { key: "identity", label: "Identity & Bank" },
  { key: "documents", label: "Documents" },
  { key: "attendance", label: "Attendance History" },
  { key: "leaves", label: "Leave History" },
  { key: "tasks", label: "Tasks" },
  { key: "id_card", label: "ID Card" },
  { key: "history", label: "History & Timeline" },
];

import { formatLocalDate } from "../utils/date";
import { IDCard } from "../shared/components/IDCard";
import { useJobTitleLabel } from "../contexts/OrgUnitsContext";


export default function EmployeeDetail() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const navigate = useNavigate();
  const { tenantId, tenant } = useTenant();
  const { logAction } = useAuditLog();
  const { success, error: toastError } = useToast();
  const { employee: currentHrEmployee } = useEmployee();
  const { orgUnits, jobTitles, locations, employmentTypes } = useOrgStructure();
  const titleLabel = useJobTitleLabel();

  const [activeTab, setActiveTab] = useState<TabKey>("personal");
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Employee>>({});
  const [activeEmployees, setActiveEmployees] = useState<Employee[]>([]);
  const [managerSearch, setManagerSearch] = useState("");
  const [isManagerDropdownOpen, setIsManagerDropdownOpen] = useState(false);
  const [directReportsCount, setDirectReportsCount] = useState(0);
  const [activating, setActivating] = useState(false);
  const [deletingDraft, setDeletingDraft] = useState(false);
  const [showDeleteDraftModal, setShowDeleteDraftModal] = useState(false);
  const [initiateExitOpen, setInitiateExitOpen] = useState(false);
  type ActivationStep = null | "verifying" | "setting-password" | "done";
  const [activationStep, setActivationStep] = useState<ActivationStep>(null);

  const [otpValue, setOtpValue] = useState("");
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpLoading, setOtpLoading] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordError, setNewPasswordError] = useState<string | null>(null);
  const [createdUserId, setCreatedUserId] = useState<string | null>(null);
  const managerDropdownRef = useRef<HTMLDivElement>(null);

  const selectedManager = useMemo(() => {
    return activeEmployees.find((emp) => emp.id === editForm.manager_id);
  }, [activeEmployees, editForm.manager_id]);

  const [secondaryManagerSearch, setSecondaryManagerSearch] = useState("");
  const [isSecondaryManagerDropdownOpen, setIsSecondaryManagerDropdownOpen] = useState(false);
  const secondaryManagerDropdownRef = useRef<HTMLDivElement>(null);
  const [onboardingSelf, setOnboardingSelf] = useState<any | null>(null);

  const selectedSecondaryManager = useMemo(() => {
    return activeEmployees.find((emp) => emp.id === editForm.secondary_manager_id);
  }, [activeEmployees, editForm.secondary_manager_id]);

  const profileCompleteness = useMemo(() => {
    if (!employee) return 0;
    const fields = [
      employee.full_name,
      employee.email,
      employee.phone,
      employee.date_of_joining,
      employee.employee_code,
      employee.org_unit_id,
      employee.job_title_id,
      employee.employment_type_id || employee.employment_type,
      employee.aadhaar_number,
      employee.pan_number,
      employee.bank_name,
      employee.account_number,
      employee.ifsc_code,
    ];
    const completed = fields.filter((f) => f && String(f).trim() !== "").length;
    return Math.round((completed / fields.length) * 100);
  }, [employee]);

  const filteredSecondaryManagers = useMemo(() => {
    const q = secondaryManagerSearch.toLowerCase().trim();
    if (!q) return activeEmployees;
    return activeEmployees.filter(emp => emp.full_name.toLowerCase().includes(q));
  }, [activeEmployees, secondaryManagerSearch]);

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
    if (isEditing) {
      if (selectedSecondaryManager && !isSecondaryManagerDropdownOpen) {
        setSecondaryManagerSearch(selectedSecondaryManager.full_name);
      } else if (!editForm.secondary_manager_id && !isSecondaryManagerDropdownOpen) {
        setSecondaryManagerSearch("");
      }
    } else {
      // Find the secondary manager's name from activeEmployees if available
      const secMgr = activeEmployees.find((emp) => emp.id === employee?.secondary_manager_id);
      setSecondaryManagerSearch(secMgr?.full_name || "");
    }
  }, [selectedSecondaryManager, editForm.secondary_manager_id, isSecondaryManagerDropdownOpen, isEditing, employee, activeEmployees]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (managerDropdownRef.current && !managerDropdownRef.current.contains(event.target as Node)) {
        setIsManagerDropdownOpen(false);
      }
      if (secondaryManagerDropdownRef.current && !secondaryManagerDropdownRef.current.contains(event.target as Node)) {
        setIsSecondaryManagerDropdownOpen(false);
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

  const employmentTypeOptions = useMemo(() => {
    const legacy = [
      { value: "full_time", label: "Full Time", legacyValue: "full_time" },
      { value: "part_time", label: "Part Time", legacyValue: "part_time" },
      { value: "contract", label: "Contract", legacyValue: "contract" },
      { value: "intern", label: "Intern", legacyValue: "intern" },
    ];
    const mapped = employmentTypes.map((type) => ({ value: type.id, label: type.name, legacyValue: toLegacyEmploymentType(type.code) }));
    return mapped.length > 0 ? mapped : legacy;
  }, [employmentTypes]);

  const locationOptions = useMemo(() => {
    const legacy = [
      { value: "Head Office", label: "Head Office", legacyValue: "Head Office" },
      { value: "Branch Office", label: "Branch Office", legacyValue: "Branch Office" },
      { value: "Remote", label: "Remote", legacyValue: "Remote" },
      { value: "Work From Home", label: "Work From Home", legacyValue: "Work From Home" },
      { value: "Other", label: "Other", legacyValue: "Other" },
    ];
    const mapped = locations.map((location) => ({ value: location.id, label: location.name, legacyValue: location.name }));
    return mapped.length > 0 ? mapped : legacy;
  }, [locations]);

  // ── Effective-dated org-unit membership (06-organisation-management.md §3.5) ──
  const [unitAssignments, setUnitAssignments] = useState<EmployeeUnitAssignment[]>([]);
  // Every unit of the tenant, active or not: history is largely about units people were moved OUT of,
  // and `useOrgStructure` only carries the active ones.
  const [unitNames, setUnitNames] = useState<Record<string, string>>({});
  const [grades, setGrades] = useState<EmployeeGrade[]>([]);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferUnitId, setTransferUnitId] = useState("");
  const [transferFrom, setTransferFrom] = useState(formatLocalDate(new Date()));
  const [transferReason, setTransferReason] = useState<"transfer" | "restructure">("transfer");
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);

  const currentAssignment = useMemo(
    () => unitAssignments.find((row) => row.effective_to === null) ?? null,
    [unitAssignments],
  );

  // Open row first, then newest start date. Not relying on the query order alone, so the list stays
  // correct even if a row is ever written outside this screen.
  const assignmentHistory = useMemo(() => {
    return [...unitAssignments].sort((a, b) => {
      if (!a.effective_to && b.effective_to) return -1;
      if (a.effective_to && !b.effective_to) return 1;
      return b.effective_from.localeCompare(a.effective_from);
    });
  }, [unitAssignments]);

  const gradeOptions = useMemo(
    () => grades.filter((grade) => grade.is_active || grade.id === employee?.grade_id),
    [grades, employee],
  );

  // Read from the pointer the transfer trigger maintains, falling back to the legacy `department`
  // text for employees who have no unit FK yet.
  const currentUnitName = useMemo(() => {
    if (!employee) return null;
    return employee.org_unit_id ? unitNames[employee.org_unit_id] ?? null : null;
  }, [employee, unitNames]);

  const currentJobTitle = useMemo(() => {
    if (!employee?.job_title_id) return null;
    return jobTitles.find((t) => t.id === employee.job_title_id)?.title ?? null;
  }, [employee, jobTitles]);

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

  const handleViewDocument = async (fileKey: string, fileName: string) => {
    if (!employee) return;
    try {
      const { data, error } = await storage.from("employee-documents").download(fileKey);
      if (error || !data) throw error;
      
      // Log audit action
      void logAction("employee.document_viewed", "employees", employee.id, { document: fileKey });
      
      // Determine MIME type from fileName
      const ext = fileName.split(".").pop()?.toLowerCase();
      let mimeType = data.type;
      if (ext === "pdf") mimeType = "application/pdf";
      else if (ext === "png") mimeType = "image/png";
      else if (ext === "jpg" || ext === "jpeg") mimeType = "image/jpeg";
      else if (ext === "gif") mimeType = "image/gif";
      else if (ext === "svg") mimeType = "image/svg+xml";

      const typedBlob = new Blob([data], { type: mimeType });
      const blobUrl = URL.createObjectURL(typedBlob);
      
      // Open inline if viewable, otherwise download
      if (["pdf", "png", "jpg", "jpeg", "gif", "svg"].includes(ext || "")) {
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
      } else {
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(blobUrl);
      }
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

      void logAction("employee.avatar_updated", "employees", employee.id);

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

  const shiftDate = (isoDate: string, days: number) => {
    const day = new Date(`${isoDate}T00:00:00`);
    day.setDate(day.getDate() + days);
    return formatLocalDate(day);
  };

  const formatDay = (isoDate: string) => new Date(`${isoDate}T00:00:00`).toLocaleDateString();

  const openTransfer = () => {
    setTransferUnitId("");
    setTransferFrom(formatLocalDate(new Date()));
    setTransferReason("transfer");
    setTransferError(null);
    setTransferOpen(true);
  };

  /**
   * Move the employee into another org unit by appending to `employee_unit_assignments`.
   *
   * `employees.org_unit_id` is NOT written here: the `employee_unit_assignment_sync` trigger sets it
   * from whichever row has `effective_to IS NULL`. Client-managed sync of a duplicated fact is the
   * defect this module exists to remove (06-organisation-management.md §2.1).
   *
   * The partial unique index `employee_unit_current_uniq (employee_id) WHERE effective_to IS NULL`
   * permits only one open row, so the current row must be closed BEFORE the new one is inserted.
   * Closing it does not move the pointer — the trigger only writes `employees` when the row it sees
   * has `effective_to IS NULL`.
   */
  const submitTransfer = async () => {
    if (!employee || !tenantId) return;

    const today = formatLocalDate(new Date());

    if (!transferUnitId) {
      setTransferError("Choose the unit to move this employee into.");
      return;
    }
    // Compared against the assignment, not `employees.org_unit_id`: an employee whose pointer was set
    // through the legacy Department select has no assignment row yet, and recording their current unit
    // as an opening assignment is exactly what they need.
    if (currentAssignment && transferUnitId === currentAssignment.org_unit_id) {
      setTransferError("That is already this employee's unit.");
      return;
    }
    if (!transferFrom) {
      setTransferError("Choose the date the move takes effect.");
      return;
    }
    if (transferFrom > today) {
      // The trigger keys on `effective_to IS NULL`, not on the date, so a future-dated row would move
      // the employee immediately. Scheduling a transfer needs a job that does not exist yet.
      setTransferError("Transfers cannot be dated in the future — record the move on or after the day it happens.");
      return;
    }
    if (currentAssignment && transferFrom <= currentAssignment.effective_from) {
      setTransferError(
        `The effective date must be after ${formatDay(currentAssignment.effective_from)}, when the current assignment started.`,
      );
      return;
    }

    setTransferring(true);
    setTransferError(null);

    // Step 1 — close the open assignment the day before the new one starts.
    // .select() matters: RLS refuses a write by matching zero rows, which PostgREST reports as a
    // SUCCESSFUL empty response rather than an error. Without checking the returned rows, a refused
    // transfer would tell HR the employee moved while the database is unchanged.
    let closedAssignmentId: string | null = null;
    if (currentAssignment) {
      const { data: closed, error: closeError } = await db
        .from("employee_unit_assignments")
        .update({ effective_to: shiftDate(transferFrom, -1) })
        .eq("tenant_id", tenantId)
        .eq("id", currentAssignment.id)
        .select();

      if (closeError || !closed || (closed as unknown[]).length === 0) {
        setTransferError(
          closeError?.message ?? "The transfer was rejected. Only HR administrators can move an employee between units.",
        );
        setTransferring(false);
        return;
      }
      closedAssignmentId = currentAssignment.id;
    }

    // Step 2 — append the new assignment. This is the row the trigger reads.
    const { data: inserted, error: insertError } = await db
      .from("employee_unit_assignments")
      .insert({
        tenant_id: tenantId,
        employee_id: employee.id,
        org_unit_id: transferUnitId,
        effective_from: transferFrom,
        reason: transferReason,
        created_by: currentHrEmployee?.id ?? null,
      })
      .select();

    if (insertError || !inserted || (inserted as unknown[]).length === 0) {
      // Reopen what step 1 closed, or the employee is left with no current assignment. The reopen
      // re-fires the trigger with `effective_to IS NULL`, restoring the pointer to the old unit too.
      if (closedAssignmentId) {
        const { data: reopened, error: reopenError } = await db
          .from("employee_unit_assignments")
          .update({ effective_to: null })
          .eq("tenant_id", tenantId)
          .eq("id", closedAssignmentId)
          .select();

        if (reopenError || !reopened || (reopened as unknown[]).length === 0) {
          setTransferError(
            "The transfer failed AND the previous assignment could not be reopened — this employee now has no current unit. Retry the transfer to restore it.",
          );
          toastError("Transfer failed and could not be rolled back.");
          setTransferring(false);
          await loadData();
          return;
        }
      }

      setTransferError(
        insertError?.message ?? "The transfer was rejected. Only HR administrators can move an employee between units.",
      );
      setTransferring(false);
      return;
    }

    void logAction("employee.unit_transferred", "employee_unit_assignments", (inserted as { id: string }[])[0]?.id, {
      employee_id: employee.id,
      from_org_unit_id: currentAssignment?.org_unit_id ?? null,
      to_org_unit_id: transferUnitId,
      effective_from: transferFrom,
      reason: transferReason,
    });

    success("Employee transferred. The previous assignment is kept with its date range.");
    setTransferOpen(false);
    setTransferring(false);
    await loadData();
  };

  const loadData = async () => {
    if (!employeeId) return;

    setLoading(true);
    setError(null);

    // PostgREST resolves the self-referencing FK on `employees` in the REVERSE direction: the
    // embed `manager:employees!manager_id(full_name)` returned an ARRAY of this employee's DIRECT
    // REPORTS, not their manager, so `.full_name` was undefined and "Reports To" rendered blank
    // for everyone who had one. The `!employees_manager_id_fkey` hint does NOT work here.
    const employeeRes = await db
      .from("employees")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", employeeId)
      .maybeSingle();
    if (employeeRes.error || !employeeRes.data) {
      setError(employeeRes.error?.message ?? "Employee not found.");
      setLoading(false);
      return;
    }

    const employeeRow = employeeRes.data as any;
    // One row, so resolve the manager's name from the directory view, which already exposes a
    // working `manager_name`/`full_name` pair.
    let managerName: string | null = null;
    if (employeeRow.manager_id) {
      const { data: mgr } = await db
        .from("employee_directory_public")
        .select("full_name")
        .eq("id", employeeRow.manager_id)
        .maybeSingle();
      managerName = (mgr as { full_name?: string } | null)?.full_name ?? null;
    }

    const currentEmployee = { ...employeeRow, manager_name: managerName } as Employee;
    setEmployee(currentEmployee);
    setEditForm(currentEmployee);

    if (tenantId) {
      db.from("employees")
        .select("id, full_name, job_title_id, profile_photo_url")
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

    const [attendanceRes, leavesRes, tasksRes, docsRes, exceptionsRes, reportsRes, onboardingSelfRes, unitAssignmentsRes, allUnitsRes, gradesRes] = await Promise.all([
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
      db.from("employee_onboarding_self")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("employee_id", currentEmployee.id)
        .maybeSingle(),
      db.from("employee_unit_assignments")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("employee_id", currentEmployee.id)
        .order("effective_from", { ascending: false }),
      // Deliberately unfiltered by is_active — history mostly names units people were moved out of.
      db.from("org_units").select("id, name").eq("tenant_id", tenantId),
      db.from("employee_grades").select("*").eq("tenant_id", tenantId).order("level", { ascending: true }),
    ]);

    setAttendance((attendanceRes.data as Attendance[]) ?? []);
    setLeaves((leavesRes.data as Leave[]) ?? []);
    setTasks((tasksRes.data as Task[]) ?? []);
    setExceptions((exceptionsRes.data ?? []) as any[]);
    setDirectReportsCount(reportsRes.count ?? 0);
    setOnboardingSelf(onboardingSelfRes.data || null);
    setUnitAssignments((unitAssignmentsRes.data as EmployeeUnitAssignment[]) ?? []);
    setUnitNames(
      Object.fromEntries(((allUnitsRes.data ?? []) as { id: string; name: string }[]).map((unit) => [unit.id, unit.name])),
    );
    setGrades((gradesRes.data as EmployeeGrade[]) ?? []);

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
          name: item.file_name || item.file_key.split("/").pop() || "document",
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

  const updateDesignation = (value: string) => {
    // The select's value IS the job_title_id now; there is no text column left to mirror it into.
    setEditForm((current) => ({
      ...current,
      job_title_id: jobTitles.some((jobTitle) => jobTitle.id === value) ? value : null,
    }));
  };

  const updateEmploymentType = (value: string) => {
    const selected = employmentTypeOptions.find((option) => option.value === value);
    setEditForm((current) => ({
      ...current,
      employment_type_id: employmentTypes.some((type) => type.id === value) ? value : null,
      employment_type: selected?.legacyValue ?? toLegacyEmploymentType(value),
    }));
  };

  const updateWorkLocation = (value: string) => {
    const selected = locationOptions.find((option) => option.value === value);
    setEditForm((current) => ({
      ...current,
      location_id: locations.some((location) => location.id === value) ? value : null,
      work_location: selected?.legacyValue ?? value,
    }));
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

    if (editForm.manager_id && editForm.secondary_manager_id && editForm.manager_id === editForm.secondary_manager_id) {
      const message = "Primary and secondary managers cannot be the same person.";
      setError(message);
      toastError(message);
      setSaving(false);
      return;
    }

    if (editForm.manager_id) {
      const mgrValidation = await validateManagerAssignment(employee.id, editForm.manager_id, tenantId);
      if (!mgrValidation.isValid) {
        setError(mgrValidation.message || "Invalid manager assignment.");
        toastError(mgrValidation.message || "Invalid manager assignment.");
        setSaving(false);
        return;
      }
    }

    if (editForm.secondary_manager_id) {
      const secMgrValidation = await validateManagerAssignment(employee.id, editForm.secondary_manager_id, tenantId);
      if (!secMgrValidation.isValid) {
        setError(secMgrValidation.message || "Invalid secondary manager assignment.");
        toastError(secMgrValidation.message || "Invalid secondary manager assignment.");
        setSaving(false);
        return;
      }
    }

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
      // org_unit_id is deliberately NOT written here — the employee_unit_assignment_sync trigger owns
      // it. Writing it from this form is what produced the contradiction described above.
      job_title_id: editForm.job_title_id || null,
      employee_code: editForm.employee_code,
      date_of_joining: editForm.date_of_joining,
      // Normalised at the WRITE, not just the handler: editForm can be seeded straight from a
      // stored row that still holds a raw code (FT/CON/INT) from before normalisation existed.
      employment_type: toLegacyEmploymentType(editForm.employment_type),
      employment_type_id: editForm.employment_type_id || null,
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
      grade_id: editForm.grade_id || null,
      work_location: editForm.work_location || null,
      location_id: editForm.location_id || null,
      probation_status: editForm.probation_status || 'on_probation',
      probation_end_date: editForm.probation_end_date || null,
      employment_confirmed_at: editForm.employment_confirmed_at || null,
    };

    // .select() matters: RLS refuses a write by matching zero rows, which comes back as a SUCCESSFUL
    // empty response rather than an error. Without checking the returned rows a refused save would
    // look like it worked and the form would drift from the database.
    const { data: updated, error: updateError } = await db
      .from("employees")
      .update(payload)
      .eq("tenant_id", tenantId)
      .eq("id", employee.id)
      .select();

    if (updateError || !updated || (updated as unknown[]).length === 0) {
      const message = updateError?.message ?? "The change was rejected — you may not have permission to edit this employee.";
      setError(message);
      toastError(message);
      setSaving(false);
      return;
    }

    if (
      editForm.manager_id !== employee.manager_id ||
      editForm.secondary_manager_id !== employee.secondary_manager_id
    ) {
      const { error: rpcError } = await db.rpc("update_employee_reporting_relationship", {
        p_employee_id: employee.id,
        p_primary_manager_id: editForm.manager_id || null,
        p_secondary_manager_id: editForm.secondary_manager_id || null,
      });

      if (rpcError) {
        setError(rpcError.message);
        toastError(rpcError.message || "Failed to update reporting relationships.");
        setSaving(false);
        return;
      }
    } else {
      void logAction("employee.updated", "employees", employee.id, { fields_changed: Object.keys(payload) });
    }

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

    void logAction("employee.status_changed", "employees", employee.id, {
      from: employee.status,
      to: status,
    });

    if (status === "terminated") {
      void logAction("employee.terminated", "employees", employee.id);
    } else if (status === "active" && employee.status !== "active") {
      void logAction("employee.activated", "employees", employee.id);
    }

    await loadData();
    setSaving(false);
  };

  const makePassword = () => {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
    return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  };

  const handleDeleteDraft = async () => {
    if (!employee || !tenantId) return;

    setDeletingDraft(true);
    try {
      const { error: deleteErr } = await db
        .from("employees")
        .delete()
        .eq("id", employee.id)
        .eq("tenant_id", tenantId);

      if (deleteErr) throw deleteErr;

      success(`Successfully deleted draft employee ${employee.full_name}.`);
      setShowDeleteDraftModal(false);
      navigate("/hr/employees");
    } catch (err: any) {
      toastError(err.message || "Failed to delete draft profile.");
      console.error(err);
    } finally {
      setDeletingDraft(false);
    }
  };

  const handleActivate = async () => {
    if (!employee || !tenantId) return;
    if (!editForm.job_title_id || !editForm.org_unit_id || !editForm.date_of_joining || !editForm.employee_code?.trim()) {
      toastError("Please fill in designation, department, joining date, and employee code before activating.");
      return;
    }
    
    setActivating(true);
    const generatedPassword = makePassword();

    setNewPassword(generatedPassword);

    try {
      const fnRes = await insforge.functions.invoke("create-employee-user", {
        body: {
          email: employee.email,
          password: generatedPassword,
          name: employee.full_name,
          tenant_id: tenantId,
          employee_id: employee.id,
        },
      });

      if (fnRes.error || !fnRes.data?.userId) {
        throw new Error(fnRes.data?.message ?? fnRes.error?.message ?? "Failed to create user credentials.");
      }

      setCreatedUserId(fnRes.data.userId);
      setActivationStep("verifying");
      setOtpValue("");
      setOtpError(null);
    } catch (err: any) {
      toastError(err.message || "Failed to initiate activation.");
      console.error(err);
    } finally {
      setActivating(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!employee?.email || otpValue.length !== 6) return;
    setOtpLoading(true);
    setOtpError(null);
    try {
      const res = await insforge.functions.invoke("verify-employee-code", {
        body: { email: employee.email, otp: otpValue },
      });
      if (res.error || !res.data?.success) {
        throw new Error(res.data?.error ?? res.error?.message ?? "Invalid code. Please try again.");
      }
      setActivationStep("setting-password");
    } catch (err: any) {
      setOtpError(err.message);
    } finally {
      setOtpLoading(false);
    }
  };

  const handleConfirmPassword = async () => {
    if (!employee?.email || !createdUserId || newPassword.trim().length < 8) {
      setNewPasswordError("Password must be at least 8 characters.");
      return;
    }
    setOtpLoading(true);
    setNewPasswordError(null);
    try {
      // 1. Set password in auth service
      const fnRes = await insforge.functions.invoke("set-employee-password", {
        body: { email: employee.email, password: newPassword.trim(), tenant_id: tenantId },
      });
      if (fnRes.error || !fnRes.data?.success) {
        throw new Error(fnRes.data?.error ?? fnRes.error?.message ?? "Failed to update password.");
      }

      // 2. Perform direct update on employees table
      const { error: updateErr } = await db
        .from("employees")
        .update({
          status: "active",
          user_id: createdUserId,
          job_title_id: editForm.job_title_id || null,
          org_unit_id: editForm.org_unit_id || null,
          date_of_joining: editForm.date_of_joining,
          employee_code: editForm.employee_code.trim(),
          employment_type: toLegacyEmploymentType(editForm.employment_type) ?? "full_time",
          employment_type_id: editForm.employment_type_id || null,
          grade: editForm.grade?.trim() || null,
          work_location: editForm.work_location || null,
          location_id: editForm.location_id || null,
          work_mode: editForm.work_mode || "office",
          updated_at: new Date().toISOString()
        })
        .eq("id", employee.id)
        .eq("tenant_id", tenantId);
      if (updateErr) throw updateErr;

      success("Employee activated successfully.");
      setActivationStep("done");
    } catch (err: any) {
      setNewPasswordError(err.message || "Failed to complete password setup.");
      console.error(err);
    } finally {
      setOtpLoading(false);
    }
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
      {(employee.status === "draft" || employee.status === "pending_hr_review" || (employee.status === "inactive" && !employee.user_id)) && (
        <div className="mb-6 rounded-2xl border border-orange-200 bg-orange-50 p-5 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-orange-500 text-xs font-bold text-white leading-none">!</span>
              <div>
                <h4 className="font-semibold text-orange-950">Employee Pending Activation</h4>
                <p className="mt-0.5 text-sm text-orange-700">
                  This employee profile was added by their manager as a draft. Please verify and fill in all mandatory job information (designation, department, code, and joining date), then click Activate below.
                </p>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                type="button"
                disabled={activating || deletingDraft}
                onClick={() => setShowDeleteDraftModal(true)}
                className="rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-60 shadow-sm"
              >
                {deletingDraft ? "Deleting..." : "Delete Draft"}
              </button>
              <button
                type="button"
                disabled={activating || deletingDraft}
                onClick={handleActivate}
                className="rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-700 disabled:opacity-60 shadow-sm"
              >
                {activating ? "Activating..." : "Activate Employee"}
              </button>
            </div>
          </div>
        </div>
      )}
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
            <div className="mt-2.5 flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-500">Profile Completeness:</span>
              <div className="w-24 bg-slate-100 rounded-full h-2 overflow-hidden border border-slate-200/50 shadow-inner">
                <div 
                  className={`h-full rounded-full transition-all duration-500 ${
                    profileCompleteness < 50 ? "bg-amber-500" : profileCompleteness < 80 ? "bg-blue-500" : "bg-emerald-500"
                  }`} 
                  style={{ width: `${profileCompleteness}%` }}
                />
              </div>
              <span className="text-xs font-bold text-slate-700">{profileCompleteness}%</span>
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
            {employee.status === "active" && (
              <button
                type="button"
                onClick={() => {
                  setInitiateExitOpen(true);
                  setShowActionsMenu(false);
                }}
                className="w-full text-left rounded-lg px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 transition"
              >
                Initiate Exit Process
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
            <span className="capitalize font-semibold text-slate-900 block mt-2">{currentUnitName || "No Department"}</span>
            {/* Not editable here. Unit membership is effective-dated (06 §3.5) and `employees.org_unit_id`
                is a trigger-maintained pointer at the open `employee_unit_assignments` row. Editing it
                inline wrote the pointer with no assignment row, so this field and the assignment
                history's "Current" row disagreed after a save. Transfer is the supported path. */}
            {isEditing && (
              <span className="mt-1 block text-[11px] font-normal text-slate-500">
                Use <span className="font-semibold">Transfer</span> to move this employee between units — it records the effective date and keeps the history.
              </span>
            )}
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Designation</span>
            {/* A picker, not free text — employees.designation was dropped (06 §5 step 6), so
                job_titles is the only place a title can live. */}
            {isEditing ? (
              <select
                value={editForm.job_title_id ?? ""}
                onChange={(event) => updateDesignation(event.target.value)}
                className="w-full capitalize rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 bg-white"
              >
                <option value="">No job title</option>
                {jobTitles.map((jobTitle) => (
                  <option key={jobTitle.id} value={jobTitle.id}>{jobTitle.title}</option>
                ))}
              </select>
            ) : (
              <span className="capitalize font-semibold text-slate-900 block mt-2">{currentJobTitle ?? "—"}</span>
            )}
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Employee Code</span>
            <input
              value={editForm.employee_code ?? ""}
              onChange={(event) => updateField("employee_code", event.target.value)}
              disabled={!isEditing}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:border-transparent disabled:bg-transparent disabled:px-0 disabled:font-semibold disabled:opacity-100"
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
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Employment Type</span>
            {isEditing ? (
              <select
                value={editForm.employment_type_id || editForm.employment_type || "full_time"}
                onChange={(event) => updateEmploymentType(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 bg-white"
              >
                {/* Same display-vs-state lie as the create form: the fallback is the LEGACY string
                    "full_time" while the options are employment_type UUIDs, so an employee with no
                    FK rendered as though a real type were selected. */}
                <option value="">Select employment type</option>
                {employmentTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            ) : (
              <span className="capitalize font-semibold text-slate-900 block mt-2">
                {(employee.employment_type ?? "full_time").replace("_", " ")}
              </span>
            )}
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
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Grade Band</span>
            {isEditing ? (
              gradeOptions.length === 0 ? (
                <p className="mt-2 text-xs italic text-slate-500">
                  No grade bands configured yet — add them under Organisation Structure.
                </p>
              ) : (
                <select
                  value={editForm.grade_id ?? ""}
                  onChange={(event) => updateField("grade_id", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 bg-white"
                >
                  <option value="">No grade band</option>
                  {gradeOptions.map((grade) => (
                    <option key={grade.id} value={grade.id}>{grade.name} — Level {grade.level}</option>
                  ))}
                </select>
              )
            ) : (
              <span className="font-semibold text-slate-900 block mt-2">
                {grades.find((grade) => grade.id === employee.grade_id)?.name ?? "—"}
              </span>
            )}
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Work Location</span>
            {isEditing ? (
              <select
                value={editForm.location_id || editForm.work_location || ""}
                onChange={(event) => updateWorkLocation(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 bg-white"
              >
                <option value="">Select Work Location</option>
                {locationOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
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
                      <span className="text-slate-500"> — {titleLabel(selectedManager, "No designation")}</span>
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
                            <p className="text-[10px] text-slate-500 truncate">{titleLabel(emp)}</p>
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

          {/* Secondary Manager Selection */}
          <div className="text-sm md:col-span-2 relative" ref={secondaryManagerDropdownRef}>
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Secondary / Functional Manager</span>
            {isEditing ? (
              <>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search functional manager..."
                    value={secondaryManagerSearch}
                    onFocus={() => {
                      setIsSecondaryManagerDropdownOpen(true);
                      if (selectedSecondaryManager) {
                        setSecondaryManagerSearch("");
                      }
                    }}
                    onChange={(e) => {
                      setSecondaryManagerSearch(e.target.value);
                      setIsSecondaryManagerDropdownOpen(true);
                    }}
                    className="w-full rounded-lg border border-slate-300 pl-3 pr-10 py-2 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 text-slate-900 font-normal"
                  />
                  {editForm.secondary_manager_id ? (
                    <button
                      type="button"
                      onClick={() => {
                        updateField("secondary_manager_id", "");
                        setSecondaryManagerSearch("");
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

                {selectedSecondaryManager && !isSecondaryManagerDropdownOpen && (
                  <div className="mt-1.5 flex items-center gap-2 rounded-lg bg-slate-50 border border-slate-200 px-3 py-1.5 text-xs text-slate-700 font-normal">
                    {selectedSecondaryManager.profile_photo_url ? (
                      <img src={selectedSecondaryManager.profile_photo_url} alt="" className="h-5 w-5 rounded-full object-cover" />
                    ) : (
                      <div className="grid h-5 w-5 place-items-center rounded-full bg-slate-200 font-bold text-slate-600">
                        {selectedSecondaryManager.full_name.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <span className="font-semibold text-slate-900">{selectedSecondaryManager.full_name}</span>
                      <span className="text-slate-500"> — {titleLabel(selectedSecondaryManager, "No designation")}</span>
                    </div>
                  </div>
                )}

                {isSecondaryManagerDropdownOpen && (
                  <div className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg ring-1 ring-black ring-opacity-5">
                    {filteredSecondaryManagers.length === 0 ? (
                      <div className="px-4 py-2 text-slate-500 text-xs font-normal">No active employees found</div>
                    ) : (
                      filteredSecondaryManagers.map((emp) => (
                        <button
                          key={emp.id}
                          type="button"
                          onClick={() => {
                            updateField("secondary_manager_id", emp.id);
                            setSecondaryManagerSearch(emp.full_name);
                            setIsSecondaryManagerDropdownOpen(false);
                          }}
                          className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 transition-colors font-normal ${
                            editForm.secondary_manager_id === emp.id ? "bg-slate-50 font-semibold" : ""
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
                            <p className="text-[10px] text-slate-500 truncate">{titleLabel(emp)}</p>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </>
            ) : (
              <span className="font-semibold text-slate-900 block mt-2">
                {activeEmployees.find(e => e.id === employee.secondary_manager_id)?.full_name || "—"}
              </span>
            )}
          </div>

          {/* Probation Status Selection */}
          <div className="text-sm">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Probation Status</span>
            {isEditing ? (
              <select
                value={editForm.probation_status ?? "on_probation"}
                onChange={(event) => {
                  updateField("probation_status", event.target.value);
                  if (event.target.value === "confirmed") {
                    updateField("employment_confirmed_at", new Date().toISOString());
                  }
                }}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 bg-white"
              >
                <option value="on_probation">On Probation</option>
                <option value="confirmed">Confirmed / Permanent</option>
                <option value="extended">Extended</option>
                <option value="not_applicable">Not Applicable</option>
              </select>
            ) : (
              <span className="capitalize font-semibold text-slate-900 block mt-2">
                {(employee.probation_status ?? "on_probation").replace("_", " ")}
              </span>
            )}
          </div>

          {/* Probation End Date Selection */}
          {(editForm.probation_status === "on_probation" || editForm.probation_status === "extended" || (!isEditing && (employee.probation_status === "on_probation" || employee.probation_status === "extended"))) && (
            <div className="text-sm">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Probation End Date</span>
              {isEditing ? (
                <input
                  type="date"
                  value={editForm.probation_end_date ?? ""}
                  onChange={(event) => updateField("probation_end_date", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                />
              ) : (
                <span className="font-semibold text-slate-900 block mt-2">
                  {employee.probation_end_date ? new Date(employee.probation_end_date).toLocaleDateString() : "—"}
                </span>
              )}
            </div>
          )}

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
                  <span className="capitalize font-semibold text-slate-900">{currentUnitName || "No Department"}</span>
                  <span className="text-slate-400">→</span>
                  <span className="font-semibold text-brand-600">{employee.full_name}</span>
                </div>
              </div>

              {/* Effective-dated unit membership (06-organisation-management.md §3.5) */}
              <div className="sm:col-span-2 space-y-3 border-t border-slate-200/60 pt-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Unit Assignment History</span>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Moves are appended, never overwritten, so past months still report against the unit this
                      employee was actually in at the time.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={openTransfer}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Transfer unit
                  </button>
                </div>

                {assignmentHistory.length === 0 ? (
                  <p className="text-xs italic text-slate-500">
                    No unit assignment recorded yet — a transfer creates the first one.
                  </p>
                ) : (
                  <ol className="space-y-2">
                    {assignmentHistory.map((assignment) => {
                      const isCurrent = assignment.effective_to === null;
                      return (
                        <li
                          key={assignment.id}
                          className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-3 py-2 ${
                            isCurrent ? "border-emerald-200 bg-emerald-50/70" : "border-slate-200 bg-white"
                          }`}
                        >
                          <span className="text-sm font-semibold text-slate-900">
                            {unitNames[assignment.org_unit_id] ?? "Unknown unit"}
                          </span>
                          {isCurrent && (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                              Current
                            </span>
                          )}
                          <span className="text-xs text-slate-600">
                            {isCurrent
                              ? `Since ${formatDay(assignment.effective_from)}`
                              : `${formatDay(assignment.effective_from)} — ${formatDay(assignment.effective_to as string)}`}
                          </span>
                          {assignment.reason && (
                            <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold capitalize text-slate-600">
                              {assignment.reason}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            </div>
          </div>

          {/* Self-Onboarding Progress Section */}
          {onboardingSelf && (
            <div className="md:col-span-2 mt-6 border-t border-slate-100 pt-6">
              <h3 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-2">
                <ClipboardList className="h-5 w-5 text-brand-600" />
                Employee Self-Onboarding Progress
              </h3>
              <div className="grid gap-4 grid-cols-2 sm:grid-cols-4 bg-slate-50/50 rounded-2xl border border-slate-200 p-5">
                {[
                  { checked: onboardingSelf.personal_details_completed, label: "Personal Details" },
                  { checked: onboardingSelf.bank_details_completed, label: "Bank & KYC Details" },
                  { checked: onboardingSelf.documents_completed, label: "Uploaded Documents" },
                  { checked: onboardingSelf.emergency_contact_completed, label: "Emergency Contact" }
                ].map((item, idx) => (
                  <div key={idx} className={`flex flex-col p-3 rounded-xl border text-center transition ${
                    item.checked ? "bg-emerald-50 border-emerald-100 text-emerald-800" : "bg-slate-150/40 border-slate-200 text-slate-450"
                  }`}>
                    <span className="text-xs font-bold">{item.label}</span>
                    <span className={`text-[10px] font-semibold mt-1 px-2 py-0.5 rounded-full inline-block self-center ${
                      item.checked ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-650"
                    }`}>
                      {item.checked ? "Completed" : "Pending"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
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
                <input
                  type={showSensitive || isEditing ? "text" : "password"}
                  value={editForm.aadhaar_number ?? ""}
                  onChange={(event) => updateField("aadhaar_number", event.target.value)}
                  disabled={!isEditing}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:border-transparent disabled:bg-transparent disabled:px-0 disabled:font-semibold disabled:opacity-100"
                />
              </label>
            </div>
            <div>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">PAN Number</span>
                <input
                  type={showSensitive || isEditing ? "text" : "password"}
                  value={editForm.pan_number ?? ""}
                  onChange={(event) => updateField("pan_number", event.target.value)}
                  disabled={!isEditing}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:border-transparent disabled:bg-transparent disabled:px-0 disabled:font-semibold disabled:opacity-100"
                />
              </label>
            </div>
            <div>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Bank Name</span>
                <input
                  value={editForm.bank_name ?? ""}
                  onChange={(event) => updateField("bank_name", event.target.value)}
                  disabled={!isEditing}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:border-transparent disabled:bg-transparent disabled:px-0 disabled:font-semibold disabled:opacity-100"
                />
              </label>
            </div>
            <div>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Account Number</span>
                <input
                  type={showSensitive || isEditing ? "text" : "password"}
                  value={editForm.account_number ?? ""}
                  onChange={(event) => updateField("account_number", event.target.value)}
                  disabled={!isEditing}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:border-transparent disabled:bg-transparent disabled:px-0 disabled:font-semibold disabled:opacity-100"
                />
              </label>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">IFSC Code</span>
                <input
                  type={showSensitive || isEditing ? "text" : "password"}
                  value={editForm.ifsc_code ?? ""}
                  onChange={(event) => updateField("ifsc_code", event.target.value)}
                  disabled={!isEditing}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:border-transparent disabled:bg-transparent disabled:px-0 disabled:font-semibold disabled:opacity-100"
                />
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
                      <p className="text-sm font-semibold text-slate-900">{doc.name}</p>
                      <p className="text-xs font-medium text-slate-500 mt-0.5">{new Date(doc.uploadedAt).toLocaleString()} — {(doc.size / 1024).toFixed(1)} KB</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-3 md:mt-0">
                    <button
                      type="button"
                      onClick={() => handleViewDocument(doc.key, doc.name)}
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

      {activeTab === "history" ? (
        <div className="mt-4">
          <EmployeeTimeline employeeId={employee.id} tenantId={employee.tenant_id} />
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

      <ConfirmModal
        isOpen={showDeleteDraftModal}
        onClose={() => setShowDeleteDraftModal(false)}
        onConfirm={() => { void handleDeleteDraft(); }}
        title="Delete Onboarding Draft"
        message={`Are you sure you want to reject and delete the draft profile for ${employee?.full_name}? This action is permanent and cannot be undone.`}
        confirmText="Delete"
        confirmColor="red"
        isSubmitting={deletingDraft}
      />

      <InitiateExitModal
        isOpen={initiateExitOpen}
        onClose={() => setInitiateExitOpen(false)}
        onSuccess={() => { void loadData(); }}
        preselectedEmployeeId={employee?.id}
      />

      {transferOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
          onClick={() => !transferring && setTransferOpen(false)}
        >
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="border-b border-slate-200 px-5 py-4">
              <h3 className="text-lg font-semibold text-slate-900">Transfer to another unit</h3>
              <p className="mt-1 text-sm text-slate-500">
                {currentAssignment
                  ? `Currently in ${unitNames[currentAssignment.org_unit_id] ?? "an unknown unit"} since ${formatDay(currentAssignment.effective_from)}. That assignment is closed the day before the new one starts — it stays on record.`
                  : "This employee has no recorded assignment yet. This becomes their first one."}
              </p>
            </div>

            <div className="space-y-4 px-5 py-5 text-sm">
              <label className="block space-y-1">
                <span className="font-medium text-slate-700">Move to</span>
                <select
                  value={transferUnitId}
                  onChange={(event) => setTransferUnitId(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none"
                >
                  <option value="">Select a unit</option>
                  {orgUnits
                    .filter((unit) => unit.id !== currentAssignment?.org_unit_id)
                    .map((unit) => (
                      <option key={unit.id} value={unit.id}>{unit.name}</option>
                    ))}
                </select>
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="block space-y-1">
                  <span className="font-medium text-slate-700">Effective from</span>
                  <input
                    type="date"
                    value={transferFrom}
                    min={currentAssignment ? shiftDate(currentAssignment.effective_from, 1) : undefined}
                    max={formatLocalDate(new Date())}
                    onChange={(event) => setTransferFrom(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="font-medium text-slate-700">Reason</span>
                  <select
                    value={transferReason}
                    onChange={(event) => setTransferReason(event.target.value as "transfer" | "restructure")}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none"
                  >
                    <option value="transfer">Transfer — this person moved</option>
                    <option value="restructure">Restructure — the org changed around them</option>
                  </select>
                </label>
              </div>

              {transferError && (
                <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
                  {transferError}
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={() => setTransferOpen(false)}
                disabled={transferring}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitTransfer()}
                disabled={transferring}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
              >
                {transferring ? "Transferring..." : "Record transfer"}
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* Onboarding Activation Modal */}
      {activationStep !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="relative w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-950">Activate Employee Login</h3>
                <p className="text-xs text-slate-500">Completing credential creation for {employee.full_name}</p>
              </div>
              {activationStep !== "done" && (
                <button
                  type="button"
                  onClick={() => setActivationStep(null)}
                  className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
                >
                  <X className="h-5 w-5" />
                </button>
              )}
            </div>

            {activationStep === "verifying" && (
              <div className="space-y-4">
                <p className="text-sm text-slate-600">
                  A 6-digit OTP code has been sent to the email <strong className="text-slate-900">{employee.email}</strong>. Please enter the code below to verify their identity.
                </p>
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide">6-Digit Verification Code</label>
                  <input
                    maxLength={6}
                    value={otpValue}
                    onChange={(e) => setOtpValue(e.target.value.replace(/\D/g, ""))}
                    placeholder="123456"
                    className="w-full text-center tracking-widest text-lg font-bold rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                  />
                  {otpError && <p className="text-xs text-rose-600 font-medium">{otpError}</p>}
                </div>
                <button
                  type="button"
                  disabled={otpLoading || otpValue.length !== 6}
                  onClick={handleVerifyOtp}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
                >
                  {otpLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                  Verify Code
                </button>
              </div>
            )}

            {activationStep === "setting-password" && (
              <div className="space-y-4">
                <p className="text-sm text-slate-600">
                  Email verified successfully! Now configure a password for their account.
                </p>
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide">Login Password</label>
                  <input
                    type="text"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter password (min 8 chars)"
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                  />
                  {newPasswordError && <p className="text-xs text-rose-600 font-medium">{newPasswordError}</p>}
                </div>
                <button
                  type="button"
                  disabled={otpLoading || newPassword.trim().length < 8}
                  onClick={handleConfirmPassword}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
                >
                  {otpLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                  Confirm & Activate Profile
                </button>
              </div>
            )}

            {activationStep === "done" && (
              <div className="space-y-4 text-center">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-100 text-emerald-600">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                <h4 className="font-bold text-slate-900 text-base">Account Activated!</h4>
                <p className="text-sm text-slate-500">
                  {employee.full_name} is now fully active in the system. They can log in using these credentials:
                </p>
                <div className="rounded-2xl bg-slate-50 p-4 text-left border border-slate-100 space-y-2">
                  <p className="text-xs text-slate-500 font-semibold">Email: <span className="text-slate-900 select-all font-mono font-bold">{employee.email}</span></p>
                  <p className="text-xs text-slate-500 font-semibold">Password: <span className="text-slate-900 select-all font-mono font-bold">{newPassword}</span></p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setActivationStep(null);
                    void loadData(); // Reload the whole page data
                  }}
                  className="w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white transition hover:bg-brand-700"
                >
                  Back to profile
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
