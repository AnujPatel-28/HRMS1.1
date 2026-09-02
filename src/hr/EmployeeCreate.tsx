import { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import type { Employee } from "../types";
import { useTenant } from "../contexts/TenantContext";
import { insforge, db } from "../insforge/client";
import { useAuditLog } from "../hooks/useAuditLog";
import { useOrgStructure } from "../hooks/useOrgStructure";
import { validateManagerAssignment } from "../utils/managerCycleValidation";
import { useJobTitleLabel } from "../contexts/OrgUnitsContext";


interface FormState {
  full_name: string;
  email: string;
  phone: string;
  date_of_birth: string;
  gender: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  org_unit_id: string;
  job_title_id: string;
  employee_code: string;
  date_of_joining: string;
  employment_type: string;
  employment_type_id: string;
  aadhaar_number: string;
  pan_number: string;
  bank_name: string;
  account_number: string;
  ifsc_code: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  emergency_contact_relation: string;
  work_mode: "office" | "remote" | "hybrid";
  grade: string;
  work_location: string;
  location_id: string;
  manager_id: string;
  secondary_manager_id?: string;
  probation_period?: string;
}

const initialState: FormState = {
  full_name: "",
  email: "",
  phone: "",
  date_of_birth: "",
  gender: "",
  address: "",
  city: "",
  state: "",
  pincode: "",
  org_unit_id: "",
  job_title_id: "",
  employee_code: "",
  date_of_joining: "",
  employment_type: "full_time",
  employment_type_id: "",
  aadhaar_number: "",
  pan_number: "",
  bank_name: "",
  account_number: "",
  ifsc_code: "",
  emergency_contact_name: "",
  emergency_contact_phone: "",
  emergency_contact_relation: "",
  work_mode: "office",
  grade: "",
  work_location: "",
  location_id: "",
  manager_id: "",
  secondary_manager_id: "",
  probation_period: "90",
};

const stepTitles = [
  "Personal Details",
  "Employment Info",
  "KYC & Banking",
  "Emergency Contact",
  "Review & Create",
];

interface UploadedDoc {
  label: string;
  url: string;
}

interface Credentials {
  email: string;
  password: string;
}

export default function EmployeeCreate() {
  const navigate = useNavigate();
  const { tenantId } = useTenant();
  const { logAction } = useAuditLog();
  const { orgUnits, jobTitles, locations, employmentTypes } = useOrgStructure();
  const titleLabel = useJobTitleLabel();

  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>(initialState);
  const [profilePhoto, setProfilePhoto] = useState<File | null>(null);
  const [aadhaarDoc, setAadhaarDoc] = useState<File | null>(null);
  const [panDoc, setPanDoc] = useState<File | null>(null);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  
  type AuthStep = "idle" | "verifying" | "setting-password" | "done";
  const [authStep, setAuthStep] = useState<AuthStep>("idle");
  const [hasDraft, setHasDraft] = useState(false);
  const [draftData, setDraftData] = useState<any>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [createdUserId, setCreatedUserId] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isCreated, setIsCreated] = useState(false);
  const [otpValue, setOtpValue] = useState("");
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [pwValue, setPwValue] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Prevents double-click: when Next is clicked, the Confirm & Create button
  // appears in the same DOM position — disable it briefly to absorb the extra click.
  const [justNavigated, setJustNavigated] = useState(false);

  const [insertedEmployeeId, setInsertedEmployeeId] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState({ profile: false, aadhaar: false, pan: false });

  const [activeEmployees, setActiveEmployees] = useState<Employee[]>([]);
  const [managerSearch, setManagerSearch] = useState("");
  const [isManagerDropdownOpen, setIsManagerDropdownOpen] = useState(false);
  const managerDropdownRef = useRef<HTMLDivElement>(null);

  const [secondaryManagerSearch, setSecondaryManagerSearch] = useState("");
  const [isSecondaryManagerDropdownOpen, setIsSecondaryManagerDropdownOpen] = useState(false);
  const secondaryManagerDropdownRef = useRef<HTMLDivElement>(null);

  const selectedManager = useMemo(() => {
    return activeEmployees.find((emp) => emp.id === form.manager_id);
  }, [activeEmployees, form.manager_id]);

  const selectedSecondaryManager = useMemo(() => {
    return activeEmployees.find((emp) => emp.id === form.secondary_manager_id);
  }, [activeEmployees, form.secondary_manager_id]);

  // Synchronize managerSearch input with selectedManager name
  useEffect(() => {
    if (selectedManager && !isManagerDropdownOpen) {
      setManagerSearch(selectedManager.full_name);
    } else if (!form.manager_id && !isManagerDropdownOpen) {
      setManagerSearch("");
    }
  }, [selectedManager, form.manager_id, isManagerDropdownOpen]);

  // Synchronize secondaryManagerSearch input
  useEffect(() => {
    if (selectedSecondaryManager && !isSecondaryManagerDropdownOpen) {
      setSecondaryManagerSearch(selectedSecondaryManager.full_name);
    } else if (!form.secondary_manager_id && !isSecondaryManagerDropdownOpen) {
      setSecondaryManagerSearch("");
    }
  }, [selectedSecondaryManager, form.secondary_manager_id, isSecondaryManagerDropdownOpen]);

  // Close dropdown on click outside
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

  const filteredSecondaryManagers = useMemo(() => {
    const q = secondaryManagerSearch.toLowerCase().trim();
    if (!q) return activeEmployees;
    return activeEmployees.filter(emp => emp.full_name.toLowerCase().includes(q));
  }, [activeEmployees, secondaryManagerSearch]);

  useEffect(() => {
    if (tenantId) {
      db.from("employees")
        .select("id, full_name, job_title_id, profile_photo_url")
        .eq("tenant_id", tenantId)
        .eq("status", "active")
        .order("full_name")
        .then(({ data }) => {
          if (data) setActiveEmployees(data as Employee[]);
        });
    }
  }, [tenantId]);

  const validateFile = (file: File | null, type: string, allowedTypes: string[]) => {
    if (!file) return null;
    if (file.size > 5 * 1024 * 1024) return `${type} exceeds 5MB size limit.`;
    if (!allowedTypes.includes(file.type)) return `${type} has unsupported format. Allowed: ${allowedTypes.map(t => t.split('/')[1].toUpperCase()).join(', ')}.`;
    return null;
  };

  const isLastStep = step === 5;

  const canMoveToNext = useMemo(() => {
    if (step === 1) {
      return Boolean(form.full_name.trim() && form.email.trim() && form.phone.trim() && authStep === "done");
    }
    if (step === 2) {
      return Boolean(form.org_unit_id && form.job_title_id && form.employee_code.trim() && form.date_of_joining);
    }
    if (step === 3) {
      return Boolean(form.aadhaar_number.trim() && form.pan_number.trim());
    }
    if (step === 4) {
      return Boolean(form.emergency_contact_name.trim() && form.emergency_contact_phone.trim());
    }
    return true;
  }, [step, form, authStep]);

  /**
   * The human-readable reason `canMoveToNext` is false.
   *
   * Next is disabled with no explanation anywhere, and several required fields sit above the
   * fold — so on a long step the button simply looks broken. Mirrors canMoveToNext exactly; if
   * you add a condition there, add its label here or the two silently disagree.
   */
  const missingFields = useMemo(() => {
    const missing: string[] = [];
    if (step === 1) {
      if (!form.full_name.trim()) missing.push("Full Name");
      if (!form.email.trim()) missing.push("Email");
      if (!form.phone.trim()) missing.push("Phone");
      if (authStep !== "done") missing.push("Email verification and password");
    } else if (step === 2) {
      if (!form.org_unit_id) missing.push("Department");
      if (!form.job_title_id) missing.push("Job Title");
      if (!form.employee_code.trim()) missing.push("Employee ID");
      if (!form.date_of_joining) missing.push("Date of Joining");
    } else if (step === 3) {
      if (!form.aadhaar_number.trim()) missing.push("Aadhaar Number");
      if (!form.pan_number.trim()) missing.push("PAN Number");
    } else if (step === 4) {
      if (!form.emergency_contact_name.trim()) missing.push("Emergency Contact Name");
      if (!form.emergency_contact_phone.trim()) missing.push("Emergency Contact Phone");
    }
    return missing;
  }, [step, form, authStep]);

  useEffect(() => {
    if (justNavigated) {
      const timer = setTimeout(() => setJustNavigated(false), 400);
      return () => clearTimeout(timer);
    }
  }, [justNavigated]);

  useEffect(() => {
    const draft = sessionStorage.getItem(`hrms_employee_draft_${tenantId}`);
    if (draft) {
      try {
        const parsed = JSON.parse(draft);
        if (parsed && !parsed.isCreated) {
          const isEmpty =
            !parsed.form?.full_name?.trim() &&
            !parsed.form?.email?.trim() &&
            !parsed.form?.phone?.trim() &&
            parsed.authStep === "idle" &&
            !parsed.insertedEmployeeId;

          if (!isEmpty) {
            setDraftData(parsed);
            setHasDraft(true);
          } else {
            sessionStorage.removeItem(`hrms_employee_draft_${tenantId}`);
          }
        }
      } catch (e) {
        console.error("Failed to parse employee draft", e);
      }
    }
  }, [tenantId]);

  useEffect(() => {
    if (tenantId) {
      if (isCreated) {
        sessionStorage.removeItem(`hrms_employee_draft_${tenantId}`);
      } else {
        const isEmpty =
          form.full_name.trim() === "" &&
          form.email.trim() === "" &&
          form.phone.trim() === "" &&
          authStep === "idle" &&
          !insertedEmployeeId;

        if (isEmpty) {
          sessionStorage.removeItem(`hrms_employee_draft_${tenantId}`);
        } else if (!hasDraft) {
          // Do not store the actual password in the draft for security reasons
          const safeCredentials = credentials ? { email: credentials.email, password: "" } : null;
          sessionStorage.setItem(`hrms_employee_draft_${tenantId}`, JSON.stringify({
            form, createdUserId, authStep, insertedEmployeeId, uploadStatus, step, credentials: safeCredentials, pendingEmail, isCreated
          }));
        }
      }
    }
  }, [form, createdUserId, authStep, insertedEmployeeId, uploadStatus, step, credentials, pendingEmail, isCreated, tenantId, hasDraft]);

  const handleResumeDraft = () => {
    if (draftData) {
      if (draftData.form) setForm(draftData.form);
      if (draftData.createdUserId) setCreatedUserId(draftData.createdUserId);
      if (draftData.authStep) setAuthStep(draftData.authStep);
      if (draftData.insertedEmployeeId) setInsertedEmployeeId(draftData.insertedEmployeeId);
      if (draftData.uploadStatus) setUploadStatus(draftData.uploadStatus);
      if (draftData.step) setStep(draftData.step);
      if (draftData.credentials) setCredentials(draftData.credentials);
      if (draftData.pendingEmail) setPendingEmail(draftData.pendingEmail);
      if (draftData.isCreated) setIsCreated(draftData.isCreated);
    }
    setHasDraft(false);
  };

  const handleDiscardDraft = () => {
    if (window.confirm("Are you sure you want to discard this draft? This will clear all entered details and start a fresh onboarding.")) {
      sessionStorage.removeItem(`hrms_employee_draft_${tenantId}`);
      setForm(initialState);
      setProfilePhoto(null);
      setAadhaarDoc(null);
      setPanDoc(null);
      setCredentials(null);
      setAuthStep("idle");
      setPendingEmail(null);
      setCreatedUserId(null);
      setInsertedEmployeeId(null);
      setUploadStatus({ profile: false, aadhaar: false, pan: false });
      setStep(1);
      setError(null);
      setHasDraft(false);
      setDraftData(null);
    }
  };

  const legacyDepartmentOptions = useMemo(() => [
    { value: "sales", label: "Sales" },
    { value: "dev", label: "Development" },
    { value: "marketing", label: "Marketing" },
    { value: "operations", label: "Operations" },
    { value: "design", label: "Design" },
    { value: "other", label: "Other" },
  ], []);

  const legacyEmploymentTypeOptions = useMemo(() => [
    { value: "full_time", label: "Full Time" },
    { value: "part_time", label: "Part Time" },
    { value: "contract", label: "Contract" },
    { value: "intern", label: "Intern" },
  ], []);

  const legacyLocationOptions = useMemo(() => [
    { value: "Head Office", label: "Head Office" },
    { value: "Branch Office", label: "Branch Office" },
    { value: "Remote", label: "Remote" },
    { value: "Work From Home", label: "Work From Home" },
    { value: "Other", label: "Other" },
  ], []);

  const departmentOptions = useMemo(() => {
    // Every active unit, at any depth — see the note in Directory.tsx.
    //
    const mappedOrgUnits = orgUnits
      .map((unit) => ({
        value: unit.id,
        label: unit.name,
      }));

    return mappedOrgUnits.length > 0
      ? mappedOrgUnits
      : legacyDepartmentOptions;
  }, [legacyDepartmentOptions, orgUnits]);

  const employmentTypeOptions = useMemo(() => {
    const mappedTypes = employmentTypes.map((type) => ({
      value: type.id,
      label: type.name,
      legacyValue: type.code,
    }));

    return mappedTypes.length > 0
      ? mappedTypes
      : legacyEmploymentTypeOptions.map((option) => ({ ...option, legacyValue: option.value }));
  }, [employmentTypes, legacyEmploymentTypeOptions]);

  const locationOptions = useMemo(() => {
    const mappedLocations = locations.map((location) => ({
      value: location.id,
      label: location.name,
      legacyValue: location.name,
    }));

    return mappedLocations.length > 0
      ? mappedLocations
      : legacyLocationOptions.map((option) => ({ ...option, legacyValue: option.value }));
  }, [legacyLocationOptions, locations]);

  const handleChange = (key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleDepartmentChange = (value: string) => {
    // employees.department was dropped (06 §5 step 6) — org_unit_id is now the only thing written.
    setForm((prev) => ({
      ...prev,
      org_unit_id: orgUnits.some((unit) => unit.id === value) ? value : "",
    }));
  };

  const handleDesignationChange = (value: string) => {
    // The select's value IS the job_title_id now; there is no text column left to mirror it into.
    setForm((prev) => ({
      ...prev,
      job_title_id: jobTitles.some((jobTitle) => jobTitle.id === value) ? value : "",
    }));
  };

  const handleEmploymentTypeChange = (value: string) => {
    const selected = employmentTypeOptions.find((option) => option.value === value);
    setForm((prev) => ({
      ...prev,
      employment_type_id: employmentTypes.some((type) => type.id === value) ? value : "",
      employment_type: selected?.legacyValue ?? value,
    }));
  };

  const handleLocationChange = (value: string) => {
    const selected = locationOptions.find((option) => option.value === value);
    setForm((prev) => ({
      ...prev,
      location_id: locations.some((location) => location.id === value) ? value : "",
      work_location: selected?.legacyValue ?? value,
    }));
  };

  const handleEmployeeCode = (value: string) => {
    handleChange("employee_code", value);
  };

  const goNext = () => {
    if (step < 5) {
      setJustNavigated(true);
      setStep((s) => s + 1);
    }
  };
  const goBack = () => {
    if (step > 1) setStep((s) => s - 1);
  };

  const makePassword = () => {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
    return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  };

  const uploadFileToEmployeeFolder = async (employeeId: string, file: File, label: string, bucket: string = "employee-documents"): Promise<UploadedDoc> => {
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
    const randomUuid = getUuid();
    const fileName = `${tenantId}/${employeeId}/${randomUuid}.${fileExt}`;
    const { data, error: uploadErr } = await insforge.storage.from(bucket).upload(fileName, file);
    if (uploadErr || !data) throw new Error(`Upload failed for ${label}: ${uploadErr?.message ?? "Unknown error"}`);

    if (bucket === "employee-documents") {
      // Insert into employee_documents table!
      const { error: insertError } = await db.from("employee_documents").insert([{
        tenant_id: tenantId,
        employee_id: employeeId,
        file_name: file.name,
        file_url: data.url,
        file_key: data.key,
        size: data.size,
      }]);
      if (insertError) {
        await insforge.storage.from(bucket).remove(data.key);
        throw insertError;
      }
    }

    return { label, url: data.url };
  };

  const handleSendOTP = async () => {
    const normalizedEmail = form.email.trim().toLowerCase();
    if (!normalizedEmail || !form.full_name.trim()) {
      setAuthError("Please enter full name and email first.");
      return;
    }
    setAuthLoading(true);
    setAuthError(null);
    try {
      // 1. Check if there is an existing, resumable onboarding flow
      const { data: resumable, error: resErr } = await db.rpc("check_onboarding_resumable", {
        p_email: normalizedEmail,
        p_tenant_id: tenantId
      });

      if (resErr) {
        throw new Error(resErr.message);
      }

      if (resumable && resumable.length > 0) {
        const flow = resumable[0];
        const confirmResume = window.confirm(
          `An onboarding flow already exists for this email with status "${flow.status.replace('_', ' ')}". Would you like to resume it?`
        );
        if (confirmResume) {
          // Log audit action for resuming onboarding
          void logAction("employee.onboarding_resumed", "employee_onboarding", flow.employee_id || flow.auth_user_id, {
            employee_id: flow.employee_id || null,
            previous_status: flow.status,
            tenant_id: tenantId
          });

          setCreatedUserId(flow.auth_user_id);
          setPendingEmail(normalizedEmail);
          
          if (flow.status === "pending_auth" || flow.status === "expired") {
            setAuthStep("verifying");
          } else if (flow.status === "otp_verified") {
            setAuthStep("setting-password");
          } else if (flow.status === "password_set") {
            setAuthStep("done");
            setCredentials({ email: normalizedEmail, password: "[Existing Password]" });
          }
          
          if (flow.employee_id) {
            setInsertedEmployeeId(flow.employee_id);
            // Fetch the employee details to pre-populate the form
            const { data: empData } = await db.from("employees").select("*").eq("id", flow.employee_id).single();
            if (empData) {
              // Defense-in-depth: verify that the employee belongs to the current tenant
              if (empData.tenant_id !== tenantId) {
                throw new Error("Security check failed: Tenant mismatch.");
              }
              setForm({
                full_name: empData.full_name || "",
                email: empData.email || "",
                phone: empData.phone || "",
                date_of_birth: empData.date_of_birth || "",
                gender: empData.gender || "",
                address: empData.address || "",
                city: empData.city || "",
                state: empData.state || "",
                pincode: empData.pincode || "",
                org_unit_id: empData.org_unit_id || "",
                job_title_id: empData.job_title_id || "",
                employee_code: empData.employee_code || "",
                date_of_joining: empData.date_of_joining || "",
                employment_type: empData.employment_type || "full_time",
                employment_type_id: empData.employment_type_id || "",
                aadhaar_number: empData.aadhaar_number || "",
                pan_number: empData.pan_number || "",
                bank_name: empData.bank_name || "",
                account_number: empData.account_number || "",
                ifsc_code: empData.ifsc_code || "",
                emergency_contact_name: empData.emergency_contact_name || "",
                emergency_contact_phone: empData.emergency_contact_phone || "",
                emergency_contact_relation: empData.emergency_contact_relation || "",
                work_mode: empData.work_mode || "office",
                grade: empData.grade || "",
                work_location: empData.work_location || "",
                location_id: empData.location_id || "",
                manager_id: empData.manager_id || "",
              });
            }
          }
          setAuthLoading(false);
          return;
        } else {
          throw new Error("Please use a different email address or resume the existing flow.");
        }
      }

      // 2. Fall back to checking employees table (to raise an error if email is already active/exists outside resumable flow)
      const emailCheck = await db
        .from("employees")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("email", normalizedEmail)
        .limit(1);
      if (emailCheck.data && emailCheck.data.length > 0) {
        throw new Error(`An employee with the email "${normalizedEmail}" already exists.`);
      }

      const tempPassword = makePassword();
      const fnRes = await insforge.functions.invoke("create-employee-user", {
        body: {
          email: normalizedEmail,
          password: tempPassword,
          name: form.full_name.trim(),
          tenant_id: tenantId,
        },
      });

      if (fnRes.error || !fnRes.data?.userId) {
        console.error("Function Error:", fnRes);
        // Attempt to parse the error if it's a stringified JSON or inside the error object
        let parsedData = fnRes.data;
        if (fnRes.error && !parsedData) {
            try {
               const errObj = fnRes.error as any;
               if (errObj.context && typeof errObj.context.json === 'function') {
                   parsedData = await errObj.context.json();
               }
            } catch(e) {}
        }

        const serverMsg: string =
          parsedData?.error ??
          parsedData?.message ??
          (fnRes.error as { message?: string } | null)?.message ??
          "Failed to create auth account (Unknown Error)";
          
        const isOrphaned = parsedData?.code === "ORPHANED_AUTH_USER";
        const isCrossTenant = parsedData?.code === "CROSS_TENANT_EMAIL_CONFLICT";
        const displayMsg = isCrossTenant
          ? "This email is already being used by another organization. Please use a different email address."
          : isOrphaned
            ? `This email already has an auth account from a previous attempt. Go to InsForge Dashboard → Authentication → Users, delete "${normalizedEmail}", then try again.`
            : serverMsg || "Failed to create auth account. Please try again.";
        throw new Error(displayMsg);
      }

      setCreatedUserId(fnRes.data.userId as string);
      setPendingEmail(normalizedEmail);
      setAuthStep("verifying");
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!createdUserId || authStep !== "done") {
      setError("Please complete email verification first.");
      return;
    }

    setSubmitting(true);
    setError(null);

    const fileErrors = [
      validateFile(profilePhoto, "Profile Photo", ['image/jpeg', 'image/png']),
      validateFile(aadhaarDoc, "Aadhaar Document", ['image/jpeg', 'image/png', 'application/pdf']),
      validateFile(panDoc, "PAN Document", ['image/jpeg', 'image/png', 'application/pdf'])
    ].filter(Boolean);

    const validationErrors = [];
    if (form.aadhaar_number.trim() && !/^\d{12}$/.test(form.aadhaar_number.trim())) {
      validationErrors.push("Aadhaar Number must be exactly 12 digits.");
    }
    if (form.pan_number.trim() && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(form.pan_number.trim().toUpperCase())) {
      validationErrors.push("PAN Number format is invalid (e.g. ABCDE1234F).");
    }

    if (fileErrors.length > 0 || validationErrors.length > 0) {
      setError([...validationErrors, ...fileErrors].join(" "));
      setSubmitting(false);
      return;
    }

    try {
      if (form.manager_id) {
        const mgrValidation = await validateManagerAssignment(null, form.manager_id, tenantId);
        if (!mgrValidation.isValid) {
          throw new Error(mgrValidation.message || "Invalid manager assignment.");
        }
      }

      let currentEmployeeId = insertedEmployeeId;

      if (!currentEmployeeId) {
        // Double check email uniqueness server-side
        const check = await db.from("employees").select("id").eq("tenant_id", tenantId).eq("email", form.email.trim().toLowerCase()).limit(1);
        if (check.data && check.data.length > 0) {
          throw new Error(`Email ${form.email.trim().toLowerCase()} is already registered in the system.`);
        }


        // ── Create employee record atomically via RPC ──
        const { data: newEmpId, error: rpcError } = await db.rpc("create_employee_transaction", {
          p_user_id: createdUserId,
          p_full_name: form.full_name.trim(),
          p_email: form.email.trim().toLowerCase(),
          p_phone: form.phone.trim(),
          p_date_of_birth: form.date_of_birth || null,
          p_gender: form.gender || null,
          p_address: form.address.trim() || null,
          p_city: form.city.trim() || null,
          p_state: form.state.trim() || null,
          p_pincode: form.pincode.trim() || null,
          p_org_unit_id: form.org_unit_id || null,
          p_job_title_id: form.job_title_id || null,
          p_employee_code: form.employee_code.trim(),
          p_date_of_joining: form.date_of_joining || null,
          p_employment_type: form.employment_type,
          p_employment_type_id: form.employment_type_id || null,
          p_aadhaar_number: form.aadhaar_number.trim(),
          p_pan_number: form.pan_number.trim(),
          p_bank_name: form.bank_name.trim() || null,
          p_account_number: form.account_number.trim() || null,
          p_ifsc_code: form.ifsc_code.trim() || null,
          p_emergency_contact_name: form.emergency_contact_name.trim(),
          p_emergency_contact_phone: form.emergency_contact_phone.trim(),
          p_emergency_contact_relation: form.emergency_contact_relation.trim() || null,
          p_work_mode: form.work_mode,
          p_grade: form.grade.trim() || null,
          p_work_location: form.work_location || null,
          p_location_id: form.location_id || null,
          p_manager_id: form.manager_id || null,
          p_secondary_manager_id: form.secondary_manager_id || null,
          p_probation_period: form.probation_period ? parseInt(form.probation_period, 10) : null
        });

        if (rpcError || !newEmpId) {
          throw new Error(
            rpcError?.message ??
            "Employee profile could not be saved via transaction. Please try again."
          );
        }

        currentEmployeeId = newEmpId as string;
        setInsertedEmployeeId(currentEmployeeId);
      } else {
        // Update the existing employee profile to capture any new edits made during the recovery flow
        const updateRes = await db
          .from("employees")
          .update({
            full_name: form.full_name.trim(),
            phone: form.phone.trim(),
            date_of_birth: form.date_of_birth || null,
            gender: form.gender || null,
            address: form.address.trim() || null,
            city: form.city.trim() || null,
            state: form.state.trim() || null,
            pincode: form.pincode.trim() || null,
            org_unit_id: form.org_unit_id || null,
            job_title_id: form.job_title_id || null,
            employee_code: form.employee_code.trim(),
            date_of_joining: form.date_of_joining,
            employment_type: form.employment_type,
            employment_type_id: form.employment_type_id || null,
            aadhaar_number: form.aadhaar_number.trim(),
            pan_number: form.pan_number.trim(),
            bank_name: form.bank_name.trim() || null,
            account_number: form.account_number.trim() || null,
            ifsc_code: form.ifsc_code.trim() || null,
            emergency_contact_name: form.emergency_contact_name.trim(),
            emergency_contact_phone: form.emergency_contact_phone.trim(),
            emergency_contact_relation: form.emergency_contact_relation.trim() || null,
            work_mode: form.work_mode,
            grade: form.grade.trim() || null,
            work_location: form.work_location || null,
            location_id: form.location_id || null,
            manager_id: form.manager_id || null,
            secondary_manager_id: form.secondary_manager_id || null,
          })
          .eq("tenant_id", tenantId)
          .eq("id", currentEmployeeId);
        if (updateRes.error) {
          throw new Error("Failed to update existing employee profile: " + updateRes.error.message);
        }
      }

      // ── Upload documents (optional) ──
      const newUploadStatus = { ...uploadStatus };
      let hasUploadError = false;
      const uploadErrors: string[] = [];

      if (profilePhoto && !newUploadStatus.profile) {
        try {
          const uploaded = await uploadFileToEmployeeFolder(currentEmployeeId, profilePhoto, "Profile Photo", "employee-profile-photos");
          await db.from("employees").update({ profile_photo_url: uploaded.url }).eq("tenant_id", tenantId).eq("id", currentEmployeeId);
          newUploadStatus.profile = true;
        } catch (e) {
          hasUploadError = true;
          uploadErrors.push("Profile Photo: " + (e as Error).message);
        }
      }

      if (aadhaarDoc && !newUploadStatus.aadhaar) {
        try {
          await uploadFileToEmployeeFolder(currentEmployeeId, aadhaarDoc, "Aadhaar");
          newUploadStatus.aadhaar = true;
        } catch(e) {
          hasUploadError = true;
          uploadErrors.push("Aadhaar: " + (e as Error).message);
        }
      }

      if (panDoc && !newUploadStatus.pan) {
        try {
          await uploadFileToEmployeeFolder(currentEmployeeId, panDoc, "PAN");
          newUploadStatus.pan = true;
        } catch(e) {
          hasUploadError = true;
          uploadErrors.push("PAN: " + (e as Error).message);
        }
      }

      setUploadStatus(newUploadStatus);

      if (hasUploadError) {
        throw new Error("Failed to upload some documents:\n" + uploadErrors.join("\n") + "\n\nClick 'Confirm & Create' to retry failed uploads.");
      }

      // ── Finalize Onboarding State ──
      const finalizeRes = await insforge.functions.invoke("finalize-onboarding", {
        body: { email: form.email.trim().toLowerCase(), tenant_id: tenantId },
      });
      if (finalizeRes.error || !finalizeRes.data?.success) {
        throw new Error(
          finalizeRes.data?.error ?? 
          finalizeRes.error?.message ?? 
          "Failed to finalize onboarding status in database. Please click 'Confirm & Create' to retry."
        );
      }

      setIsCreated(true);
      sessionStorage.removeItem(`hrms_employee_draft_${tenantId}`);

    } catch (err) {
      let message = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      if (message.includes("employees_email_key")) {
        message = "This email is already registered to an employee in the system. Please provide a different email, or ask the employee to use an email alias (e.g., name+company@gmail.com).";
      }
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const copyCredentials = async () => {
    if (!credentials) return;
    const payload = `Email: ${credentials.email}\nPassword: ${credentials.password}`;
    await navigator.clipboard.writeText(payload);
  };

  const sendViaEmailHref = credentials
    ? `mailto:${credentials.email}?subject=${encodeURIComponent("Your TalentMesh HRMS Login Credentials")}&body=${encodeURIComponent(`Welcome to TalentMesh HRMS!\n\nYour login credentials:\nEmail: ${credentials.email}\nPassword: ${credentials.password}\n\nPlease sign in and change your password after first login.`)}`
    : "#";

  // ── OTP verification ──
  const handleVerifyOtp = async () => {
    if (!pendingEmail || otpValue.length !== 6) return;
    setOtpLoading(true);
    setOtpError(null);
    try {

      const res = await insforge.functions.invoke("verify-employee-code", {
        body: { email: pendingEmail, otp: otpValue },
      });
      if (res.error || !res.data?.success) {
        const msg: string = res.data?.error ?? res.error?.message ?? "Invalid code. Please try again.";
        setOtpError(msg);
      } else {
        setOtpValue("");
        setOtpError(null);
        setAuthStep("setting-password");
      }
    } catch (err) {
      setOtpError(err instanceof Error ? err.message : "Verification failed. Please try again.");
    } finally {
      setOtpLoading(false);
    }
  };

  // ── Set employee password ──
  const handleSetPassword = async () => {
    if (!pendingEmail || !pwValue.trim()) return;
    setPwLoading(true);
    setPwError(null);
    try {
      const res = await insforge.functions.invoke("set-employee-password", {
        body: { email: pendingEmail, password: pwValue.trim(), tenant_id: tenantId },
      });
      if (res.error || !res.data?.success) {
        const msg: string = res.data?.error ?? (res.error as any)?.error ?? res.error?.message ?? "Failed to set password.";
        setPwError(msg);
      } else {
        setCredentials({ email: pendingEmail, password: pwValue.trim() });
        setAuthStep("done");
        setPwValue("");
      }
    } catch (err) {
      setPwError(err instanceof Error ? err.message : "Failed to set password.");
    } finally {
      setPwLoading(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Create Employee</h2>
          <p className="text-sm text-slate-500">Step {step} of 5 — {stepTitles[step - 1]}</p>
        </div>
        <div className="flex gap-2">
          {authStep !== "idle" && !isCreated && (
            <button
              type="button"
              onClick={handleDiscardDraft}
              className="rounded-lg border border-rose-300 px-3 py-2 text-sm text-rose-700 hover:bg-rose-50 font-medium"
            >
              Discard Draft
            </button>
          )}
          <button
            type="button"
            onClick={() => navigate("/hr/employees")}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
          >
            Back to list
          </button>
        </div>
      </div>

      {hasDraft && draftData && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-sm text-amber-800 animate-fade-in">
          <div>
            <p className="font-semibold">Unsaved onboarding draft detected</p>
            <p className="text-xs text-amber-700 mt-0.5">
              An incomplete onboarding form was found for <strong>{draftData.form?.full_name || "a new employee"}</strong> ({draftData.form?.email || "no email"}).
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={handleResumeDraft}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
            >
              Resume Draft
            </button>
            <button
              type="button"
              onClick={handleDiscardDraft}
              className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-50"
            >
              Discard Draft
            </button>
          </div>
        </div>
      )}

      <div className="hide-scrollbar mb-5 flex gap-2 overflow-x-auto pb-1">
        {stepTitles.map((label, index) => {
          const stepNo = index + 1;
          const completed = stepNo < step;
          const current = stepNo === step;
          return (
            <div
              key={label}
              className={`min-w-[150px] rounded-lg border px-3 py-2 text-center text-xs font-semibold sm:min-w-0 sm:flex-1 ${
                completed
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : current
                    ? "border-brand-200 bg-brand-50 text-brand-700"
                    : "border-slate-200 bg-slate-50 text-slate-500"
              }`}
            >
              {label}
            </div>
          );
        })}
      </div>

      {!isCreated && (
        <form onSubmit={handleSubmit} className="space-y-4">
          {step === 1 ? (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Full Name *</span>
                <input
                  type="text"
                  placeholder="e.g. Jane Doe"
                  maxLength={100}
                  value={form.full_name}
                  onChange={(event) => handleChange("full_name", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring disabled:bg-slate-100 disabled:text-slate-500"
                  required
                  disabled={authStep !== "idle"}
                />
              </label>
              <label className="text-sm md:col-span-2">
                <span className="mb-1 block text-slate-600">Email *</span>
                <div className="flex gap-2">
                  <input
                    type="email"
                    placeholder="e.g. jane.doe@example.com"
                    maxLength={100}
                    value={form.email}
                    onChange={(event) => handleChange("email", event.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring disabled:bg-slate-100 disabled:text-slate-500"
                    required
                    disabled={authStep !== "idle"}
                  />
                  {authStep === "idle" && (
                    <button
                      type="button"
                      onClick={() => { void handleSendOTP(); }}
                      disabled={authLoading || !form.email.trim() || !form.full_name.trim()}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap"
                    >
                      {authLoading ? "Sending..." : "Verify"}
                    </button>
                  )}
                  {authStep === "done" && (
                    <span className="flex items-center gap-1 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-600 border border-emerald-200 whitespace-nowrap">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      Verified
                    </span>
                  )}
                </div>
                {authError && <p className="mt-1 text-xs text-rose-500">{authError}</p>}
                {authStep === "idle" && <p className="mt-1 text-xs text-slate-500">Enter full name and email to verify.</p>}
              </label>

              {/* ── Step A: OTP Verification ── */}
              {authStep === "verifying" && pendingEmail && (
                <div className="md:col-span-2 rounded-xl border border-blue-200 bg-blue-50 p-5 space-y-4 mt-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-blue-600">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white">1</span>
                    <span>Verify Email</span>
                    <span className="mx-1 text-blue-300">/</span>
                    <span className="flex h-5 w-5 items-center justify-center rounded-full border border-blue-300 text-blue-400">2</span>
                    <span className="text-blue-400">Set Password</span>
                  </div>

                  <div>
                    <h3 className="text-base font-semibold text-blue-900">Verify Employee Email</h3>
                    <p className="mt-1 text-sm text-blue-700">
                      A <strong>6-digit verification code</strong> was sent to{" "}
                      <strong>{pendingEmail}</strong>. Ask the employee to check their email and share the code with you.
                    </p>
                  </div>

                  {otpError && (
                    <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{otpError}</p>
                  )}

                  <div className="flex gap-3">
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="Enter 6-digit code"
                      value={otpValue}
                      onChange={(e) => setOtpValue(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      className="w-48 rounded-lg border border-blue-300 bg-white px-3 py-2 text-center text-lg font-mono tracking-widest outline-none ring-blue-400 focus:ring"
                    />
                    <button
                      type="button"
                      disabled={otpLoading || otpValue.length !== 6}
                      onClick={() => { void handleVerifyOtp(); }}
                      className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                    >
                      {otpLoading ? "Verifying…" : "Verify Code"}
                    </button>
                  </div>
                </div>
              )}

              {/* ── Step B: Set Password ── */}
              {authStep === "setting-password" && pendingEmail && (
                <div className="md:col-span-2 rounded-xl border border-violet-200 bg-violet-50 p-5 space-y-4 mt-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-violet-600">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    <span className="text-emerald-600">Email Verified</span>
                    <span className="mx-1 text-violet-300">/</span>
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-600 text-white">2</span>
                    <span>Set Password</span>
                  </div>

                  <div>
                    <h3 className="text-base font-semibold text-violet-900">Set Employee Login Password</h3>
                    <p className="mt-1 text-sm text-violet-700">
                      Email verified ✅ — now create a password for <strong>{pendingEmail}</strong>. Share it with the employee so they can log in.
                    </p>
                  </div>

                  {pwError && (
                    <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{pwError}</p>
                  )}

                  <div className="flex gap-3">
                    <input
                      type="text"
                      placeholder="Create a password"
                      value={pwValue}
                      onChange={(e) => setPwValue(e.target.value)}
                      className="flex-1 rounded-lg border border-violet-300 bg-white px-3 py-2 text-sm outline-none ring-violet-400 focus:ring"
                    />
                    <button
                      type="button"
                      disabled={pwLoading || !pwValue.trim()}
                      onClick={() => { void handleSetPassword(); }}
                      className="rounded-lg bg-violet-600 px-5 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
                    >
                      {pwLoading ? "Saving…" : "Set Password & Finish"}
                    </button>
                  </div>
                </div>
              )}
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Phone *</span>
                <input
                  type="tel"
                  placeholder="e.g. 9876543210"
                  maxLength={15}
                  value={form.phone}
                  onChange={(event) => handleChange("phone", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                  required
                />

              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Date of Birth</span>
                <input
                  type="date"
                  value={form.date_of_birth}
                  onChange={(event) => handleChange("date_of_birth", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                />
              </label>
              <label className="text-sm md:col-span-2">
                <span className="mb-1 block text-slate-600">Gender</span>
                <select
                  value={form.gender}
                  onChange={(event) => handleChange("gender", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                >
                  <option value="">Select gender</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className="text-sm md:col-span-2">
                <span className="mb-1 block text-slate-600">Address</span>
                <textarea
                  placeholder="e.g. 123 Main St, Apt 4B"
                  maxLength={500}
                  value={form.address}
                  onChange={(event) => handleChange("address", event.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">City</span>
                <input
                  type="text"
                  placeholder="e.g. Mumbai"
                  maxLength={50}
                  value={form.city}
                  onChange={(event) => handleChange("city", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">State</span>
                <input
                  type="text"
                  placeholder="e.g. Maharashtra"
                  maxLength={50}
                  value={form.state}
                  onChange={(event) => handleChange("state", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Pincode</span>
                <input
                  type="text"
                  placeholder="e.g. 400001"
                  maxLength={10}
                  value={form.pincode}
                  onChange={(event) => handleChange("pincode", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                />
              </label>
              <label className="text-sm md:col-span-2">
                <span className="mb-1 block text-slate-600">Profile Photo</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => setProfilePhoto(event.target.files?.[0] ?? null)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Department *</span>
                <select
                  value={form.org_unit_id}
                  onChange={(event) => handleDepartmentChange(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                  required
                >
                  {departmentOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Designation *</span>
                {/* A picker, not free text. employees.designation was dropped (06 §5 step 6), so
                    job_titles is the only place a title can live. Free text used to silently produce
                    an employee with NO job_title_id whenever it did not exactly match a row. */}
                <select
                  value={form.job_title_id}
                  onChange={(event) => handleDesignationChange(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                  required
                >
                  <option value="">Select a job title…</option>
                  {jobTitles.map((jobTitle) => (
                    <option key={jobTitle.id} value={jobTitle.id}>{jobTitle.title}</option>
                  ))}
                </select>
                {jobTitles.length === 0 && (
                  <span className="mt-1 block text-[11px] font-normal text-amber-600">
                    No job titles exist yet — add them under Organisation Structure first.
                  </span>
                )}
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Employee Code *</span>
                <input
                  type="text"
                  placeholder="e.g. EMP-1001"
                  maxLength={20}
                  value={form.employee_code}
                  onChange={(event) => handleEmployeeCode(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                  required
                />

              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Date of Joining *</span>
                <input
                  type="date"
                  value={form.date_of_joining}
                  onChange={(event) => handleChange("date_of_joining", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                  required
                />
              </label>
              <label className="text-sm md:col-span-2">
                <span className="mb-1 block text-slate-600">Employment Type</span>
                <select
                  value={form.employment_type_id || form.employment_type}
                  onChange={(event) => handleEmploymentTypeChange(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                >
                  {employmentTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Work Mode</span>
                <select
                  value={form.work_mode}
                  onChange={(event) => handleChange("work_mode", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                >
                  <option value="office">Office</option>
                  <option value="remote">Remote</option>
                  <option value="hybrid">Hybrid</option>
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Grade</span>
                <input
                  type="text"
                  placeholder="e.g. M3, Senior"
                  maxLength={50}
                  value={form.grade}
                  onChange={(event) => handleChange("grade", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                />
              </label>
              <label className="text-sm md:col-span-2">
                <span className="mb-1 block text-slate-600">Work Location</span>
                <select
                  value={form.location_id || form.work_location}
                  onChange={(event) => handleLocationChange(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                >
                  <option value="">Select Work Location</option>
                  {locationOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <div className="relative text-sm md:col-span-2 font-medium text-slate-700" ref={managerDropdownRef}>
                <span className="mb-1 block text-slate-600 font-normal">Reporting Manager</span>
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
                    className="w-full rounded-lg border border-slate-300 pl-3 pr-10 py-2 outline-none ring-brand-600 focus:ring font-normal text-slate-900"
                  />
                  {form.manager_id ? (
                    <button
                      type="button"
                      onClick={() => {
                        handleChange("manager_id", "");
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
                            handleChange("manager_id", emp.id);
                            setManagerSearch(emp.full_name);
                            setIsManagerDropdownOpen(false);
                          }}
                          className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 transition-colors font-normal ${
                            form.manager_id === emp.id ? "bg-slate-50 font-semibold" : ""
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
              </div>

              {/* Secondary Reporting Manager Search Selection */}
              <div className="relative text-sm md:col-span-2 font-medium text-slate-700" ref={secondaryManagerDropdownRef}>
                <span className="mb-1 block text-slate-600 font-normal">Secondary / Functional Manager (Optional)</span>
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
                    className="w-full rounded-lg border border-slate-300 pl-3 pr-10 py-2 outline-none ring-brand-600 focus:ring font-normal text-slate-900"
                  />
                  {form.secondary_manager_id ? (
                    <button
                      type="button"
                      onClick={() => {
                        handleChange("secondary_manager_id", "");
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
                            handleChange("secondary_manager_id", emp.id);
                            setSecondaryManagerSearch(emp.full_name);
                            setIsSecondaryManagerDropdownOpen(false);
                          }}
                          className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 transition-colors font-normal ${
                            form.secondary_manager_id === emp.id ? "bg-slate-50 font-semibold" : ""
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
              </div>

              {/* Probation Period Input */}
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Probation Period (Days)</span>
                <input
                  type="number"
                  min="0"
                  value={form.probation_period}
                  onChange={(event) => handleChange("probation_period", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                />
              </label>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Aadhaar Number *</span>
                <input
                  type="text"
                  placeholder="e.g. 1234 5678 9012"
                  maxLength={14}
                  value={form.aadhaar_number}
                  onChange={(event) => handleChange("aadhaar_number", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                  required
                />

              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">PAN Number *</span>
                <input
                  type="text"
                  placeholder="e.g. ABCDE1234F"
                  maxLength={10}
                  value={form.pan_number}
                  onChange={(event) => handleChange("pan_number", event.target.value.toUpperCase())}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                  required
                />

              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Upload Aadhaar Document</span>
                <input
                  type="file"
                  onChange={(event) => setAadhaarDoc(event.target.files?.[0] ?? null)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Upload PAN Document</span>
                <input
                  type="file"
                  onChange={(event) => setPanDoc(event.target.files?.[0] ?? null)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Bank Name</span>
                <input
                  type="text"
                  placeholder="e.g. HDFC Bank"
                  maxLength={100}
                  value={form.bank_name}
                  onChange={(event) => handleChange("bank_name", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Account Number</span>
                <input
                  type="text"
                  placeholder="e.g. 1234567890"
                  maxLength={30}
                  value={form.account_number}
                  onChange={(event) => handleChange("account_number", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                />
              </label>
              <label className="text-sm md:col-span-2">
                <span className="mb-1 block text-slate-600">IFSC Code</span>
                <input
                  type="text"
                  placeholder="e.g. HDFC0001234"
                  maxLength={11}
                  value={form.ifsc_code}
                  onChange={(event) => handleChange("ifsc_code", event.target.value.toUpperCase())}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                />
              </label>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm md:col-span-2">
                <span className="mb-1 block text-slate-600">Emergency Contact Name *</span>
                <input
                  type="text"
                  placeholder="e.g. John Doe"
                  maxLength={100}
                  value={form.emergency_contact_name}
                  onChange={(event) => handleChange("emergency_contact_name", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                  required
                />

              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Emergency Contact Phone *</span>
                <input
                  type="tel"
                  placeholder="e.g. 9876543210"
                  maxLength={15}
                  value={form.emergency_contact_phone}
                  onChange={(event) => handleChange("emergency_contact_phone", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                  required
                />

              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Relationship</span>
                <input
                  value={form.emergency_contact_relation}
                  onChange={(event) => handleChange("emergency_contact_relation", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                />
              </label>
            </div>
          ) : null}

          {step === 5 ? (
            <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
              {Object.entries(form).map(([key, value]) => (
                <div key={key} className="text-sm">
                  <p className="text-xs uppercase tracking-wide text-slate-500">{key.replace(/_/g, " ")}</p>
                  <p className="font-medium text-slate-900">{value || "—"}</p>
                </div>
              ))}
              <div className="text-sm">
                <p className="text-xs uppercase tracking-wide text-slate-500">Profile Photo</p>
                <p className="font-medium text-slate-900">{profilePhoto?.name ?? "Not uploaded"}</p>
              </div>
              <div className="text-sm">
                <p className="text-xs uppercase tracking-wide text-slate-500">Aadhaar / PAN Docs</p>
                <p className="font-medium text-slate-900">{aadhaarDoc?.name ?? "No Aadhaar doc"} / {panDoc?.name ?? "No PAN doc"}</p>
              </div>
            </div>
          ) : null}

          {error && (
            <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
              <span className="mt-0.5 shrink-0 text-rose-500">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-rose-700">Could not create employee</p>
                <p className="mt-0.5 text-sm text-rose-600">{error}</p>
              </div>
              <button type="button" onClick={() => setError(null)} className="shrink-0 rounded p-0.5 hover:bg-rose-100 text-rose-400 hover:text-rose-600">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          {!canMoveToNext && missingFields.length > 0 && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <span className="font-semibold">Still required on this step:</span>{" "}
              {missingFields.join(", ")}
              {step === 2 && (
                <span className="block mt-1 text-xs text-amber-700">
                  Department and Job Title are near the top of this step — scroll up if you cannot see them.
                </span>
              )}
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={goBack}
              disabled={step === 1 || submitting}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Previous
            </button>

            {isLastStep ? (
              <button
                type="submit"
                disabled={submitting || justNavigated}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? "Creating employee..." : "Confirm & Create"}
              </button>
            ) : (
              <button
                type="button"
                onClick={goNext}
                disabled={!canMoveToNext || submitting}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Next
              </button>
            )}
          </div>
        </form>
      )}



      {/* ── Step C: Done ── */}
      {isCreated && credentials && (
        <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-5">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <h3 className="text-base font-semibold text-emerald-900">Employee account is fully set up 🎉</h3>
          </div>
          <p className="mt-1 text-sm text-emerald-800">Account verified and password set. Share the credentials below.</p>

          <div className="mt-3 rounded-lg bg-white p-3 text-sm border border-emerald-200">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Login credentials</p>
            <p><span className="font-semibold">Email:</span> {credentials.email}</p>
            <p><span className="font-semibold">Password:</span> {credentials.password}</p>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => { void copyCredentials(); }}
              className="rounded-lg border border-emerald-300 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
            >
              Copy credentials
            </button>
            <a
              href={sendViaEmailHref}
              className="rounded-lg border border-emerald-300 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
            >
              Send via mail client
            </a>
            <button
              type="button"
              onClick={() => navigate("/hr/employees")}
              className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
            >
              Go to employee list
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
