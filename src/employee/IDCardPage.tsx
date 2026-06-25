import { useRef, useState } from "react";
import { CreditCard, Printer } from "lucide-react";
import { useEmployee } from "../hooks/useEmployee";
import { useTenant } from "../contexts/TenantContext";
import { IDCard } from "../shared/components/IDCard";
import { Skeleton } from "../shared/Skeleton";
import { EmptyState } from "../shared/EmptyState";

export default function IDCardPage() {
  const { employee, loading } = useEmployee();
  const { tenant } = useTenant();

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
            /* Force print colors & gradients */
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

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-1/3 rounded-xl animate-pulse" />
        <div className="grid gap-6 md:grid-cols-2">
          <Skeleton className="h-64 w-full rounded-2xl animate-pulse" />
          <Skeleton className="h-64 w-full rounded-2xl animate-pulse" />
        </div>
      </div>
    );
  }

  if (!employee || !tenant) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <EmptyState
          icon={CreditCard}
          title="Digital Cards Unavailable"
          description="Could not load your employee details or organization settings. Please try again."
        />
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 md:p-6 shadow-sm">
      {/* Header */}
      <div className="border-b border-slate-100 pb-4 mb-6">
        <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <CreditCard className="h-6 w-6 text-brand-600" />
          My Digital Cards
        </h2>
        <p className="text-sm text-slate-500 mt-1">Download and print your official identity and business cards</p>
      </div>

      <div className="grid gap-8 md:grid-cols-2 lg:gap-12">
        {/* Left: ID Card Container */}
        <div className="flex flex-col items-center p-5 rounded-2xl border border-slate-100 bg-slate-50/50 shadow-[0_2px_8px_rgba(0,0,0,0.01)]">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-4">Identity Card</h3>
          
          {/* Card Frame */}
          <div className="h-[215px] flex items-center justify-center">
            <IDCard
              ref={idCardRef}
              employee={employee}
              tenant={tenant}
              side={idSide}
              type="id"
            />
          </div>

          {/* Side Select Toggle Buttons */}
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

          {/* Download Button */}
          <button
            type="button"
            onClick={() => printCard(idCardRef, `${employee.full_name}_ID_Card_${idSide}`)}
            className="mt-5 w-full max-w-[200px] flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-xs font-bold text-white shadow hover:bg-brand-700 active:scale-[0.98] transition"
          >
            <Printer className="h-4 w-4" />
            Print / PDF ({idSide === "front" ? "Front" : "Back"})
          </button>
        </div>

        {/* Right: Visiting Card Container */}
        <div className="flex flex-col items-center p-5 rounded-2xl border border-slate-100 bg-slate-50/50 shadow-[0_2px_8px_rgba(0,0,0,0.01)]">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-4">Visiting Card</h3>

          {/* Card Frame */}
          <div className="h-[215px] flex items-center justify-center">
            <IDCard
              ref={visitingCardRef}
              employee={employee}
              tenant={tenant}
              side={visitingSide}
              type="visiting"
            />
          </div>

          {/* Side Select Toggle Buttons */}
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

          {/* Download Button */}
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
    </section>
  );
}
