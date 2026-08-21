import { forwardRef } from "react";
import { Phone, Mail, MapPin } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import type { Employee } from "../../types";
import type { Tenant } from "../../contexts/TenantContext";
import { useDepartmentLabel, useJobTitleLabel } from "../../contexts/OrgUnitsContext";

interface IDCardProps {
  employee: Employee;
  tenant: Tenant;
  side: "front" | "back";
  type: "id" | "visiting";
}

export const IDCard = forwardRef<HTMLDivElement, IDCardProps>(
  ({ employee, tenant, side, type }, ref) => {
    const deptLabel = useDepartmentLabel();
    const titleLabel = useJobTitleLabel();
    const isId = type === "id";
    const isFront = side === "front";

    // Standard CR80 Size: 326px x 205px
    const cardStyle: React.CSSProperties = {
      width: "326px",
      height: "205px",
      borderRadius: "12px",
      overflow: "hidden",
      position: "relative",
      boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
      fontFamily: "Inter, Roboto, sans-serif",
      userSelect: "none",
    };

    if (isId) {
      if (isFront) {
        // ID Card Front Design
        return (
          <div ref={ref} style={cardStyle} className="bg-white flex flex-col justify-between">
            {/* Top gradient section */}
            <div className="h-[125px] w-full bg-gradient-to-br from-[#1D9E75] to-[#0F6E56] relative p-3">
              {/* Tenant Logo top-right */}
              {tenant.logo_url ? (
                <img
                  src={tenant.logo_url}
                  alt=""
                  className="absolute top-2.5 right-3 h-5 max-w-[80px] object-contain brightness-0 invert"
                />
              ) : (
                <span className="absolute top-2.5 right-3 text-[8px] font-bold tracking-wider text-white/95 uppercase">
                  {tenant.company_name}
                </span>
              )}

              {/* Employee circular photo */}
              <div className="absolute bottom-[-30px] left-1/2 -translate-x-1/2 h-[90px] w-[90px] rounded-full border-4 border-white overflow-hidden shadow-md bg-slate-100 flex items-center justify-center">
                {employee.profile_photo_url ? (
                  <img
                    src={employee.profile_photo_url}
                    alt={employee.full_name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="text-xl font-bold text-slate-400">
                    {employee.full_name.slice(0, 2).toUpperCase()}
                  </div>
                )}
              </div>
            </div>

            {/* Bottom info section */}
            <div className="h-[80px] pt-8 pb-1.5 px-2 bg-white flex flex-col justify-between items-center text-center">
              <div>
                <div className="text-xs font-bold text-slate-800 tracking-wide truncate max-w-[280px]">
                  {employee.full_name}
                </div>
                <div className="text-[9px] font-medium text-slate-500 truncate max-w-[280px] capitalize mt-0.5">
                  {titleLabel(employee)} {deptLabel(employee, "") ? `• ${deptLabel(employee, "")}` : ""}
                </div>
              </div>

              {/* Bottom details row */}
              <div className="w-full flex items-center justify-between text-[8px] text-slate-600 font-mono px-3">
                <span className="truncate max-w-[120px]">
                  EMP ID: <strong className="text-slate-800">{employee.employee_code || "—"}</strong>
                </span>
                <span className="shrink-0">
                  BLOOD: <strong className="text-slate-800">{employee.blood_group || "—"}</strong>
                </span>
              </div>
            </div>
          </div>
        );
      } else {
        // ID Card Back Design
        return (
          <div ref={ref} style={cardStyle} className="bg-white flex flex-col justify-between p-3 border border-slate-150">
            {/* Watermark logo */}
            {tenant.logo_url && (
              <img
                src={tenant.logo_url}
                alt=""
                className="absolute inset-0 m-auto h-16 w-32 object-contain opacity-[0.04] pointer-events-none"
              />
            )}

            <div className="flex gap-3 h-full items-center">
              {/* Left Side: QR Code */}
              <div className="shrink-0 flex flex-col items-center gap-1">
                <div className="p-1 border border-slate-200 rounded bg-white shadow-sm">
                  <QRCodeSVG value={employee.email} size={70} />
                </div>
                <span className="text-[7px] text-slate-400 font-mono select-none">EMAIL QR</span>
              </div>

              {/* Right Side: Properties and Details */}
              <div className="flex-1 flex flex-col justify-between h-full py-1 text-[8px] text-slate-600 min-w-0">
                <div>
                  <div className="font-bold text-slate-800 uppercase tracking-wider text-[7px]">
                    Terms & Instructions
                  </div>
                  <p className="mt-1 leading-tight text-[7px] text-slate-500">
                    This card is property of {tenant.company_name}. If found, please return immediately to the company office.
                  </p>
                </div>

                {/* Emergency contact info */}
                {employee.emergency_contact_name && (
                  <div className="border-t border-dashed border-slate-200 pt-1">
                    <span className="font-bold text-rose-600 block text-[7px] uppercase">
                      Emergency Contact
                    </span>
                    <div className="truncate text-[7px] font-medium text-slate-700 mt-0.5">
                      {employee.emergency_contact_name} ({employee.emergency_contact_relation || "Contact"})
                    </div>
                    <div className="font-semibold text-slate-800 mt-0.5">
                      Ph: {employee.emergency_contact_phone || "—"}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Address bar */}
            <div className="text-[7px] text-center border-t border-slate-100 pt-1 text-slate-400 truncate">
              {tenant.company_name} • {tenant.subdomain ? `${tenant.subdomain}.talentmeshsolutions.com` : "talentmeshsolutions.com"}
            </div>
          </div>
        );
      }
    } else {
      // Visiting Card (type === "visiting")
      if (isFront) {
        // Visiting Card Front (Dark Theme)
        return (
          <div ref={ref} style={cardStyle} className="bg-[#111827] text-white flex p-3.5 select-none relative">
            {/* Left Column (Logo, Name, Title) */}
            <div className="w-[55%] flex flex-col justify-between pr-2.5 border-r border-teal-500/25">
              <div>
                {tenant.logo_url ? (
                  <img src={tenant.logo_url} alt="" className="h-5 max-w-[110px] object-contain mb-3 filter brightness-100" />
                ) : (
                  <div className="text-[9px] font-bold text-teal-400 tracking-wider uppercase mb-3">{tenant.company_name}</div>
                )}
                <div className="text-xs font-bold tracking-wide truncate max-w-[150px]">{employee.full_name}</div>
                <div className="text-[8px] text-teal-400 font-semibold truncate mt-0.5 capitalize max-w-[150px]">
                  {titleLabel(employee)}
                </div>
                {deptLabel(employee, "") && (
                  <div className="text-[7px] text-slate-400 font-medium uppercase tracking-wider mt-0.5">
                    {deptLabel(employee, "")}
                  </div>
                )}
              </div>
              <div className="text-[7px] text-slate-400 font-medium truncate">{tenant.company_name}</div>
            </div>

            {/* Right Column (Contact Details) */}
            <div className="w-[45%] flex flex-col justify-center pl-3.5 space-y-2 text-[8px] text-slate-300">
              {employee.phone && (
                <div className="flex items-center gap-1.5 min-w-0">
                  <Phone className="h-2.5 w-2.5 shrink-0 text-teal-400" />
                  <span className="truncate font-mono">{employee.phone}</span>
                </div>
              )}
              <div className="flex items-center gap-1.5 min-w-0">
                <Mail className="h-2.5 w-2.5 shrink-0 text-teal-400" />
                <span className="truncate font-mono">{employee.email}</span>
              </div>
              {employee.work_location && (
                <div className="flex items-center gap-1.5 min-w-0">
                  <MapPin className="h-2.5 w-2.5 shrink-0 text-teal-400" />
                  <span className="truncate">{employee.work_location}</span>
                </div>
              )}
            </div>
          </div>
        );
      } else {
        // Visiting Card Back (Dark Theme)
        return (
          <div ref={ref} style={cardStyle} className="bg-[#111827] text-white flex flex-col items-center justify-center p-4">
            {tenant.logo_url ? (
              <img src={tenant.logo_url} alt="" className="h-10 max-w-[180px] object-contain mb-3" />
            ) : (
              <div className="text-sm font-bold text-teal-400 tracking-wider uppercase mb-2">{tenant.company_name}</div>
            )}
            <div className="text-[9px] font-semibold tracking-widest text-slate-200 uppercase">{tenant.company_name}</div>
            <div className="text-[8px] text-teal-400 mt-2 font-mono tracking-wider">
              {tenant.subdomain ? `${tenant.subdomain}.talentmeshsolutions.com` : "www.talentmeshsolutions.com"}
            </div>
          </div>
        );
      }
    }
  }
);

IDCard.displayName = "IDCard";
