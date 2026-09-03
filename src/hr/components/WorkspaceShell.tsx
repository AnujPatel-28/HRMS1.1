import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "../../utils/cn";

/**
 * The shared frame for a module workspace.
 *
 * A module workspace is not another dashboard. `/hr/dashboard` is deliberately cross-module —
 * headcount, pending leave, punched-in-today, probation reviews — and answers "how is the company".
 * A workspace answers "is THIS module working, and what needs me", which is the question the
 * 2026-09-02 policy-center audit found nothing in the product could answer.
 *
 * The frame is shared so the three workspaces read as one system; what differs is the content, and
 * it should differ a lot — attendance is time-shaped, tasks are board-shaped, payroll is
 * period-shaped. See doc/navigation_proposal_2026-09-03.md §4.3.
 */

export type WorkspaceStat = {
  label: string;
  value: string | number;
  /** `bad` and `warn` are for things needing attention, not merely for large numbers. */
  tone?: "neutral" | "good" | "warn" | "bad";
  hint?: string;
  href?: string;
};

const toneClasses: Record<NonNullable<WorkspaceStat["tone"]>, string> = {
  neutral: "border-slate-200 bg-white",
  good: "border-emerald-200 bg-emerald-50/60",
  warn: "border-amber-200 bg-amber-50/60",
  bad: "border-rose-200 bg-rose-50/60",
};

const toneValueClasses: Record<NonNullable<WorkspaceStat["tone"]>, string> = {
  neutral: "text-slate-900",
  good: "text-emerald-700",
  warn: "text-amber-800",
  bad: "text-rose-700",
};

export function WorkspaceStats({ stats }: { stats: WorkspaceStat[] }) {
  if (stats.length === 0) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {stats.map((stat) => {
        const body = (
          <>
            <p className="text-xs font-medium text-slate-500">{stat.label}</p>
            <p className={cn("mt-1 text-2xl font-semibold tabular-nums", toneValueClasses[stat.tone ?? "neutral"])}>
              {stat.value}
            </p>
            {stat.hint ? <p className="mt-1 text-xs text-slate-500">{stat.hint}</p> : null}
          </>
        );
        const className = cn(
          "rounded-xl border p-4 shadow-sm transition",
          toneClasses[stat.tone ?? "neutral"],
          stat.href && "hover:border-brand-300 hover:shadow",
        );
        return stat.href ? (
          <Link key={stat.label} to={stat.href} className={cn(className, "block")}>
            {body}
          </Link>
        ) : (
          <div key={stat.label} className={className}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

export function WorkspaceSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A section that has nothing to show is a good outcome, and should read like one. */
export function WorkspaceEmpty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-slate-500">{children}</p>;
}

export function WorkspaceShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
          <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}
