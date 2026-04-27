import type { ReactNode } from "react";

type PageShellProps = {
  title: string;
  subtitle?: string;
  children?: ReactNode;
};

export function PageShell({ title, subtitle, children }: PageShellProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
      {children ? <div className="mt-6">{children}</div> : null}
    </div>
  );
}
