import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  minimal?: boolean;
}

export function EmptyState({ icon: Icon, title, description, action, minimal = false }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center p-12 text-center ${minimal ? "" : "border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50/50"}`}>
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-100 mb-4">
        <Icon className="h-8 w-8 text-slate-400" />
      </div>
      <h3 className="text-lg font-semibold text-slate-900 mb-1">{title}</h3>
      <p className="text-sm text-slate-500 max-w-sm mx-auto">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
