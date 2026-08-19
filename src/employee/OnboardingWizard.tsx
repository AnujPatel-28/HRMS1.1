import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { User, ClipboardList, CheckCircle2, Upload, Loader2, ArrowRight, ArrowLeft } from "lucide-react";
import { db, storage } from "../insforge/client";
import { useAuth } from "../hooks/useAuth";
import { useTenant } from "../contexts/TenantContext";
import { useToast } from "../shared/ToastContext";
import type { OnboardingSelfProgress } from "../types";

export default function OnboardingWizard() {
  const { currentEmployee } = useAuth();
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();

  const [loading, setLoading] = useState(true);
  const [_, setProgress] = useState<OnboardingSelfProgress | null>(null);
  
  // Step State
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);

  // Form Fields
  const [phone, setPhone] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [pincode, setPincode] = useState("");
  const [bloodGroup, setBloodGroup] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [bio, setBio] = useState("");

  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [ifscCode, setIfscCode] = useState("");

  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [emergencyRelation, setEmergencyRelation] = useState("");

  // Document Upload state
  const [aadhaarDoc, setAadhaarDoc] = useState<File | null>(null);
  const [panDoc, setPanDoc] = useState<File | null>(null);
  const [aadhaarUploaded, setAadhaarUploaded] = useState(false);
  const [panUploaded, setPanUploaded] = useState(false);
  const [uploading, setUploading] = useState(false);

  const fetchProgressAndEmployee = async () => {
    if (!currentEmployee?.id || !tenantId) return;
    setLoading(true);
    try {
      // 1. Fetch onboarding progress
      const { data: progData, error: progErr } = await db
        .from("employee_onboarding_self")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("employee_id", currentEmployee.id)
        .maybeSingle();

      if (progErr) throw progErr;
      
      if (!progData) {
        // If row doesn't exist, create it (defensive check)
        const { data: newProg, error: createErr } = await db
          .from("employee_onboarding_self")
          .insert([{
            tenant_id: tenantId,
            employee_id: currentEmployee.id,
            personal_details_completed: false,
            bank_details_completed: false,
            documents_completed: false,
            emergency_contact_completed: false,
          }])
          .select()
          .single();
        if (createErr) throw createErr;
        setProgress(newProg as OnboardingSelfProgress);
      } else {
        setProgress(progData as OnboardingSelfProgress);
      }

      // 2. Fetch current employee values to pre-fill
      const { data: empData, error: empErr } = await db
        .from("employees")
        .select("*")
        .eq("id", currentEmployee.id)
        .single();

      if (empErr) throw empErr;

      if (empData) {
        setPhone(empData.phone || "");
        setDob(empData.date_of_birth || "");
        setGender(empData.gender || "");
        setAddress(empData.address || "");
        setCity(empData.city || "");
        setState(empData.state || "");
        setPincode(empData.pincode || "");
        setBloodGroup(empData.blood_group || "");
        setLinkedinUrl(empData.linkedin_url || "");
        setBio(empData.employee_bio || "");

        setBankName(empData.bank_name || "");
        setAccountNumber(empData.account_number || "");
        setIfscCode(empData.ifsc_code || "");

        setEmergencyName(empData.emergency_contact_name || "");
        setEmergencyPhone(empData.emergency_contact_phone || "");
        setEmergencyRelation(empData.emergency_contact_relation || "");

        setAadhaarUploaded(!!empData.aadhaar_number);
        setPanUploaded(!!empData.pan_number);
      }
    } catch (err) {
      console.error(err);
      toastError("Failed to fetch onboarding data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchProgressAndEmployee();
  }, [currentEmployee?.id, tenantId]);

  const savePersonal = async () => {
    if (!currentEmployee?.id) return;
    setSaving(true);
    try {
      // 1. Update employee
      const { error: empErr } = await db
        .from("employees")
        .update({
          phone,
          date_of_birth: dob || null,
          gender: gender || null,
          address,
          city,
          state,
          pincode,
          blood_group: bloodGroup || null,
          linkedin_url: linkedinUrl || null,
          employee_bio: bio || null,
        })
        .eq("id", currentEmployee.id);
      if (empErr) throw empErr;

      // 2. Update progress flag
      const { error: progErr } = await db
        .from("employee_onboarding_self")
        .update({ personal_details_completed: true })
        .eq("employee_id", currentEmployee.id);
      if (progErr) throw progErr;

      success("Personal details saved.");
      setStep(2);
    } catch (err) {
      console.error(err);
      toastError("Failed to save personal details.");
    } finally {
      setSaving(false);
    }
  };

  const saveBank = async () => {
    if (!currentEmployee?.id) return;
    setSaving(true);
    try {
      const { error: empErr } = await db
        .from("employees")
        .update({
          bank_name: bankName,
          account_number: accountNumber,
          ifsc_code: ifscCode,
        })
        .eq("id", currentEmployee.id);
      if (empErr) throw empErr;

      const { error: progErr } = await db
        .from("employee_onboarding_self")
        .update({ bank_details_completed: true })
        .eq("employee_id", currentEmployee.id);
      if (progErr) throw progErr;

      success("Bank details saved.");
      setStep(3);
    } catch (err) {
      console.error(err);
      toastError("Failed to save bank details.");
    } finally {
      setSaving(false);
    }
  };

  const uploadDoc = async (file: File, label: string) => {
    if (!tenantId || !currentEmployee?.id) return "";
    const fileExt = file.name.split(".").pop() || "bin";
    const randomUuid = crypto.randomUUID();
    const fileName = `${tenantId}/${currentEmployee.id}/${randomUuid}.${fileExt}`;
    
    const { data, error: uploadErr } = await storage.from("employee-documents").upload(fileName, file);
    if (uploadErr || !data) throw new Error(`Upload failed for ${label}: ${uploadErr?.message}`);

    // Insert document record
    const { error: insertError } = await db.from("employee_documents").insert([{
      tenant_id: tenantId,
      employee_id: currentEmployee.id,
      file_name: file.name,
      file_url: data.url,
      file_key: data.key,
      size: data.size,
    }]);

    if (insertError) {
      await storage.from("employee-documents").remove(data.key);
      throw insertError;
    }

    return file.name; // Use file name as doc reference
  };

  const saveDocuments = async () => {
    if (!currentEmployee?.id) return;
    setUploading(true);
    try {
      let aadhaarRef = "";
      let panRef = "";

      if (aadhaarDoc) {
        aadhaarRef = await uploadDoc(aadhaarDoc, "Aadhaar Card");
      }
      if (panDoc) {
        panRef = await uploadDoc(panDoc, "PAN Card");
      }

      // Update employee numbers if reference uploaded
      const updates: any = {};
      if (aadhaarRef) updates.aadhaar_number = "Uploaded: " + aadhaarRef;
      if (panRef) updates.pan_number = "Uploaded: " + panRef;

      if (Object.keys(updates).length > 0) {
        const { error: empErr } = await db.from("employees").update(updates).eq("id", currentEmployee.id);
        if (empErr) throw empErr;
      }

      const { error: progErr } = await db
        .from("employee_onboarding_self")
        .update({ documents_completed: true })
        .eq("employee_id", currentEmployee.id);
      if (progErr) throw progErr;

      success("Documents uploaded successfully.");
      setStep(4);
    } catch (err) {
      console.error(err);
      toastError("Failed to upload documents.");
    } finally {
      setUploading(false);
    }
  };

  const saveEmergencyAndFinish = async () => {
    if (!currentEmployee?.id) return;
    setSaving(true);
    try {
      // 1. Update emergency contact
      const { error: empErr } = await db
        .from("employees")
        .update({
          emergency_contact_name: emergencyName,
          emergency_contact_phone: emergencyPhone,
          emergency_contact_relation: emergencyRelation,
        })
        .eq("id", currentEmployee.id);
      if (empErr) throw empErr;

      // 2. Update progress as completed
      const { error: progErr } = await db
        .from("employee_onboarding_self")
        .update({
          emergency_contact_completed: true,
          completed_at: new Date().toISOString()
        })
        .eq("employee_id", currentEmployee.id);
      if (progErr) throw progErr;

      success("Onboarding onboarding complete! Welcome aboard! 🎉");
      navigate("/employee/dashboard");
    } catch (err) {
      console.error(err);
      toastError("Failed to save emergency contacts.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-slate-500 gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
        <span>Loading onboarding forms...</span>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Welcome to TalentMesh HRMS</h1>
        <p className="text-sm text-slate-500">Please complete the following self-onboarding steps to finalize your profile setup.</p>
      </div>

      {/* Steps Indicator */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        {[
          { num: 1, label: "Personal Info" },
          { num: 2, label: "Banking" },
          { num: 3, label: "Documents" },
          { num: 4, label: "Emergency" }
        ].map((s) => (
          <div key={s.num} className="flex items-center gap-2">
            <span className={`grid h-7 w-7 place-items-center rounded-full text-xs font-bold transition ${
              step === s.num
                ? "bg-brand-600 text-white font-bold"
                : step > s.num
                  ? "bg-emerald-100 text-emerald-700 font-bold"
                  : "bg-slate-100 text-slate-400"
            }`}>
              {step > s.num ? "✓" : s.num}
            </span>
            <span className={`text-xs font-semibold hidden md:inline ${
              step === s.num ? "text-slate-800" : "text-slate-400"
            }`}>
              {s.label}
            </span>
          </div>
        ))}
      </div>

      {/* Step Content */}
      <div className="border border-slate-200 rounded-xl bg-white p-6 shadow-sm">
        {step === 1 && (
          <div className="space-y-4">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <User className="h-5 w-5 text-brand-600" />
              Personal & Profile Details
            </h3>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-bold text-slate-700 uppercase">
                Mobile Phone *
                <input
                  type="text"
                  required
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </label>

              <label className="text-xs font-bold text-slate-700 uppercase">
                Date of Birth *
                <input
                  type="date"
                  required
                  value={dob}
                  onChange={e => setDob(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </label>

              <label className="text-xs font-bold text-slate-700 uppercase">
                Gender *
                <select
                  required
                  value={gender}
                  onChange={e => setGender(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-1 focus:ring-brand-500"
                >
                  <option value="">-- Choose Gender --</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </label>

              <label className="text-xs font-bold text-slate-700 uppercase">
                Blood Group (Optional)
                <input
                  type="text"
                  placeholder="e.g. O+, A-"
                  value={bloodGroup}
                  onChange={e => setBloodGroup(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </label>

              <label className="text-xs font-bold text-slate-700 uppercase sm:col-span-2">
                Residential Address *
                <textarea
                  required
                  rows={2}
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </label>

              <label className="text-xs font-bold text-slate-700 uppercase">
                City *
                <input
                  type="text"
                  required
                  value={city}
                  onChange={e => setCity(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </label>

              <label className="text-xs font-bold text-slate-700 uppercase">
                State *
                <input
                  type="text"
                  required
                  value={state}
                  onChange={e => setState(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </label>

              <label className="text-xs font-bold text-slate-700 uppercase">
                Pincode *
                <input
                  type="text"
                  required
                  value={pincode}
                  onChange={e => setPincode(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </label>

              <label className="text-xs font-bold text-slate-700 uppercase">
                LinkedIn URL (Optional)
                <input
                  type="url"
                  placeholder="https://linkedin.com/in/..."
                  value={linkedinUrl}
                  onChange={e => setLinkedinUrl(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </label>

              <label className="text-xs font-bold text-slate-700 uppercase sm:col-span-2">
                Employee Bio (Optional)
                <textarea
                  rows={2}
                  placeholder="Briefly describe your role, skills, or background..."
                  value={bio}
                  onChange={e => setBio(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </label>
            </div>

            <div className="flex items-center justify-end pt-4 border-t border-slate-100 mt-6">
              <button
                type="button"
                disabled={saving}
                onClick={savePersonal}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 transition"
              >
                {saving ? "Saving..." : "Save & Continue"}
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-brand-600" />
              Banking & Final Settlement Info
            </h3>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-bold text-slate-700 uppercase">
                Bank Name *
                <input
                  type="text"
                  required
                  value={bankName}
                  onChange={e => setBankName(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </label>

              <label className="text-xs font-bold text-slate-700 uppercase">
                Account Number *
                <input
                  type="text"
                  required
                  value={accountNumber}
                  onChange={e => setAccountNumber(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </label>

              <label className="text-xs font-bold text-slate-700 uppercase sm:col-span-2">
                IFSC Code *
                <input
                  type="text"
                  required
                  placeholder="e.g. SBIN0001234"
                  value={ifscCode}
                  onChange={e => setIfscCode(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </label>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-100 mt-6">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={saveBank}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 transition"
              >
                {saving ? "Saving..." : "Save & Continue"}
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <Upload className="h-5 w-5 text-brand-600" />
              KYC & Document Verification
            </h3>
            <p className="text-xs text-slate-400 mb-4">Please upload scanned copies (PDF or Image under 5MB) of your identification documents.</p>

            <div className="space-y-4">
              {/* Aadhaar Card */}
              <div className="p-4 rounded-xl border border-slate-150 bg-slate-50/50 space-y-2">
                <span className="text-xs font-bold text-slate-700 block">Aadhaar Card (PDF / Photo)</span>
                {aadhaarUploaded ? (
                  <div className="text-xs text-emerald-700 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="h-4 w-4" /> Document already uploaded
                  </div>
                ) : (
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={e => setAadhaarDoc(e.target.files?.[0] || null)}
                    className="text-xs text-slate-500"
                  />
                )}
              </div>

              {/* PAN Card */}
              <div className="p-4 rounded-xl border border-slate-150 bg-slate-50/50 space-y-2">
                <span className="text-xs font-bold text-slate-700 block">PAN Card (PDF / Photo)</span>
                {panUploaded ? (
                  <div className="text-xs text-emerald-700 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="h-4 w-4" /> Document already uploaded
                  </div>
                ) : (
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={e => setPanDoc(e.target.files?.[0] || null)}
                    className="text-xs text-slate-500"
                  />
                )}
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-100 mt-6">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
              <button
                type="button"
                disabled={uploading}
                onClick={saveDocuments}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 transition"
              >
                {uploading ? "Uploading..." : "Save & Continue"}
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <User className="h-5 w-5 text-brand-600" />
              Emergency Contact Details
            </h3>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-bold text-slate-700 uppercase">
                Contact Name *
                <input
                  type="text"
                  required
                  value={emergencyName}
                  onChange={e => setEmergencyName(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </label>

              <label className="text-xs font-bold text-slate-700 uppercase">
                Contact Phone *
                <input
                  type="text"
                  required
                  value={emergencyPhone}
                  onChange={e => setEmergencyPhone(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </label>

              <label className="text-xs font-bold text-slate-700 uppercase sm:col-span-2">
                Relation *
                <input
                  type="text"
                  required
                  placeholder="e.g. Spouse, Father, Mother"
                  value={emergencyRelation}
                  onChange={e => setEmergencyRelation(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </label>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-100 mt-6">
              <button
                type="button"
                onClick={() => setStep(3)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={saveEmergencyAndFinish}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition"
              >
                {saving ? "Submitting..." : "Complete Onboarding"}
                <CheckCircle2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
