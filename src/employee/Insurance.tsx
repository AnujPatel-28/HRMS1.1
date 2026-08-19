import { useEffect, useState } from "react";
import { 
  Shield, Heart, AlertTriangle, Smile, Eye, Users, Copy, Check, 
  ExternalLink, Mail, Phone, Building2
} from "lucide-react";
import { db, storage } from "../insforge/client";
import { useAuth } from "../hooks/useAuth";
import { useEmployee } from "../hooks/useEmployee";
import { useToast } from "../shared/ToastContext";
import { Skeleton } from "../shared/Skeleton";
import { EmptyState } from "../shared/EmptyState";

interface InsurancePolicy {
  id: string;
  tenant_id: string;
  employee_id: string;
  insurer_name: string;
  policy_number: string;
  policy_type: "Health" | "Life" | "Accident" | "Dental" | "Vision" | "Group";
  coverage_amount: number;
  premium_amount: number;
  premium_frequency: "Monthly" | "Quarterly" | "Annual";
  start_date: string;
  expiry_date: string;
  status: "Active" | "Expired" | "Cancelled";
  rm_name: string | null;
  rm_phone: string | null;
  rm_email: string | null;
  rm_company: string | null;
  notes: string | null;
  policy_document_url: string | null;
  created_at: string;
}

// Icon helper by type
const getPolicyIcon = (type: InsurancePolicy["policy_type"]) => {
  switch (type) {
    case "Health":
      return <Heart className="h-6 w-6 text-emerald-600" />;
    case "Life":
      return <Shield className="h-6 w-6 text-blue-600" />;
    case "Accident":
      return <AlertTriangle className="h-6 w-6 text-amber-600" />;
    case "Dental":
      return <Smile className="h-6 w-6 text-pink-600" />;
    case "Vision":
      return <Eye className="h-6 w-6 text-purple-600" />;
    case "Group":
      return <Users className="h-6 w-6 text-indigo-600" />;
    default:
      return <Shield className="h-6 w-6 text-slate-600" />;
  }
};

const getPolicyColorClass = (type: InsurancePolicy["policy_type"]) => {
  switch (type) {
    case "Health":
      return "border-emerald-100 bg-emerald-50/50 text-emerald-800";
    case "Life":
      return "border-blue-100 bg-blue-50/50 text-blue-800";
    case "Accident":
      return "border-amber-100 bg-amber-50/50 text-amber-800";
    case "Dental":
      return "border-pink-100 bg-pink-50/50 text-pink-800";
    case "Vision":
      return "border-purple-100 bg-purple-50/50 text-purple-800";
    case "Group":
      return "border-indigo-100 bg-indigo-50/50 text-indigo-800";
    default:
      return "border-slate-100 bg-slate-50/50 text-slate-800";
  }
};

export default function EmployeeInsurance() {
  const { tenantId } = useAuth();
  const { employee } = useEmployee();
  const { success, error: toastError } = useToast();

  const [policies, setPolicies] = useState<InsurancePolicy[]>([]);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId || !employee?.id) return;
    
    const fetchEmployeePolicies = async () => {
      setLoading(true);
      try {
        const { data, error } = await db
          .from("insurance_policies")
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("employee_id", employee.id)
          .order("expiry_date", { ascending: true });

        if (error) throw error;
        if (data) {
          setPolicies(data as InsurancePolicy[]);
        }
      } catch (err) {
        console.error(err);
        toastError("Failed to fetch your insurance details.");
      } finally {
        setLoading(false);
      }
    };

    void fetchEmployeePolicies();
  }, [tenantId, employee?.id, toastError]);

  // Click to copy policy number
  const handleCopyNumber = (id: string, num: string) => {
    void navigator.clipboard.writeText(num);
    setCopiedId(id);
    success("Policy number copied to clipboard!");
    setTimeout(() => setCopiedId(null), 2500);
  };

  // View PDF policy doc
  const handleViewDocument = async (policy: InsurancePolicy) => {
    if (!policy.policy_document_url) return;
    setDownloadingId(policy.id);
    try {
      const pathParts = policy.policy_document_url.split("/insurance-documents/");
      const filePath = pathParts.length > 1 ? decodeURIComponent(pathParts[1]) : policy.policy_document_url;

      const { data: blob, error } = await storage
        .from("insurance-documents")
        .download(filePath);

      if (error || !blob) throw error || new Error("Document not found");

      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    } catch (err) {
      console.error(err);
      toastError("Failed to view policy document. Please contact HR.");
    } finally {
      setDownloadingId(null);
    }
  };

  // Check if expiry is within 30 days
  const checkExpiryStatus = (expiryDateStr: string, status: string) => {
    if (status.toLowerCase() === "cancelled" || status.toLowerCase() === "expired") {
      return "expired";
    }
    const expiry = new Date(expiryDateStr);
    const today = new Date();
    expiry.setHours(0,0,0,0);
    today.setHours(0,0,0,0);

    const diffTime = expiry.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return "expired";
    if (diffDays <= 30) return "expiring_soon";
    return "active";
  };

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
          <Shield className="h-7 w-7 text-brand-600" />
          My Insurance Policies
        </h2>
        <p className="text-sm text-slate-500">View coverage details, download policy documents, and reach out to your relationship manager.</p>
      </div>

      {loading ? (
        <div className="grid gap-6 md:grid-cols-2">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
              <div className="flex justify-between">
                <Skeleton className="h-10 w-28 rounded-lg" />
                <Skeleton className="h-6 w-16 rounded-full" />
              </div>
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-12 w-full rounded-xl" />
              <Skeleton className="h-10 w-full rounded-lg" />
            </div>
          ))}
        </div>
      ) : policies.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center shadow-sm">
          <EmptyState 
            icon={Shield} 
            title="No Insurance Policies Registered" 
            description="You currently do not have any active insurance policies registered on file." 
          />
          <p className="mt-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Contact HR for insurance enrollment & queries
          </p>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {policies.map(policy => {
            const expiryStatus = checkExpiryStatus(policy.expiry_date, policy.status);
            const isExpiring = expiryStatus === "expiring_soon";
            const isExpired = expiryStatus === "expired";
            
            return (
              <div 
                key={policy.id} 
                className={`rounded-2xl border bg-white shadow-sm overflow-hidden flex flex-col transition hover:shadow-md hover:scale-[1.005] duration-200 ${
                  isExpired 
                    ? "border-rose-200 ring-1 ring-rose-50" 
                    : isExpiring 
                      ? "border-amber-200 ring-1 ring-amber-50" 
                      : "border-slate-200"
                }`}
              >
                {/* Expiry Alert Banners */}
                {isExpiring && (
                  <div className="bg-amber-50 border-b border-amber-100 px-4 py-2 text-xs font-semibold text-amber-800 flex items-center gap-1.5 animate-pulse">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                    <span>This policy expires on {new Date(policy.expiry_date).toLocaleDateString("en-IN")}. Please contact HR to renew.</span>
                  </div>
                )}
                {isExpired && (
                  <div className="bg-rose-50 border-b border-rose-100 px-4 py-2 text-xs font-semibold text-rose-800 flex items-center gap-1.5">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
                    <span>This policy expired on {new Date(policy.expiry_date).toLocaleDateString("en-IN")}. Please contact HR immediately.</span>
                  </div>
                )}

                {/* Card Header */}
                <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-2.5 rounded-xl border ${getPolicyColorClass(policy.policy_type)}`}>
                      {getPolicyIcon(policy.policy_type)}
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-900 text-lg leading-tight">{policy.policy_type} Insurance</h3>
                      <p className="text-xs font-semibold text-brand-700 tracking-wide uppercase mt-0.5">{policy.insurer_name}</p>
                    </div>
                  </div>

                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold shadow-sm border ${
                    policy.status === "Active" && !isExpiring
                      ? "bg-emerald-50 text-emerald-700 border-emerald-100" 
                      : isExpiring
                        ? "bg-amber-50 text-amber-700 border-amber-100"
                        : "bg-rose-50 text-rose-700 border-rose-100"
                  }`}>
                    {isExpiring ? "Expiring Soon" : isExpired ? "Expired" : policy.status}
                  </span>
                </div>

                {/* Card Body */}
                <div className="p-5 space-y-4 flex-1">
                  {/* Coverage details */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-0.5">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Coverage Amount</p>
                      <p className="text-2xl font-extrabold text-slate-900">₹{policy.coverage_amount.toLocaleString("en-IN")}</p>
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Policy Number</p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="font-mono text-sm font-semibold text-slate-700 bg-slate-50 px-2 py-0.5 rounded border border-slate-100">{policy.policy_number}</span>
                        <button
                          onClick={() => handleCopyNumber(policy.id, policy.policy_number)}
                          className="text-slate-400 hover:text-brand-600 transition"
                          title="Copy policy number"
                        >
                          {copiedId === policy.id ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Dates */}
                  <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3 flex justify-between text-xs text-slate-600">
                    <div className="space-y-0.5">
                      <span className="font-semibold text-slate-400 block uppercase tracking-wide text-[9px]">Start Date</span>
                      <span className="font-bold text-slate-700">{new Date(policy.start_date).toLocaleDateString("en-IN", { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                    </div>
                    <div className="h-8 w-px bg-slate-200 self-center"></div>
                    <div className="space-y-0.5 text-right">
                      <span className="font-semibold text-slate-400 block uppercase tracking-wide text-[9px]">Expiry Date</span>
                      <span className={`font-bold ${isExpired ? "text-rose-600" : isExpiring ? "text-amber-600" : "text-slate-700"}`}>
                        {new Date(policy.expiry_date).toLocaleDateString("en-IN", { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                    </div>
                  </div>

                  {/* Document Action */}
                  {policy.policy_document_url && (
                    <button
                      onClick={() => handleViewDocument(policy)}
                      disabled={downloadingId === policy.id}
                      className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-4 py-2.5 text-sm font-semibold text-brand-700 hover:bg-brand-100 transition active:scale-[0.98]"
                    >
                      <Eye className="h-4 w-4" />
                      {downloadingId === policy.id ? "Opening Document..." : "View Policy Document"}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {/* Relationship Manager Contact Box */}
                {(policy.rm_name || policy.rm_phone || policy.rm_email) && (
                  <div className="bg-slate-50 border-t border-slate-100 p-5 space-y-3">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      For claims, hospitalization or queries, contact Relationship Manager:
                    </p>
                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-3">
                      <div>
                        <p className="font-bold text-slate-800">{policy.rm_name || "Assigned Manager"}</p>
                        {policy.rm_company && (
                          <p className="text-xs text-slate-500 font-medium flex items-center gap-1 mt-0.5">
                            <Building2 className="h-3.5 w-3.5 text-slate-400" />
                            {policy.rm_company}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-x-4 gap-y-2 pt-2 border-t border-slate-100 text-xs">
                        {policy.rm_phone && (
                          <a 
                            href={`tel:${policy.rm_phone.replace(/\s+/g, '')}`} 
                            className="inline-flex items-center gap-1.5 font-semibold text-brand-700 hover:underline transition"
                          >
                            <Phone className="h-3.5 w-3.5" />
                            {policy.rm_phone}
                          </a>
                        )}
                        {policy.rm_email && (
                          <a 
                            href={`mailto:${policy.rm_email}`} 
                            className="inline-flex items-center gap-1.5 font-semibold text-brand-700 hover:underline transition"
                          >
                            <Mail className="h-3.5 w-3.5" />
                            {policy.rm_email}
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
