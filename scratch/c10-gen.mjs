// C10 generator: derive approve_leave_request / cancel_leave_request from LIVE (TB) bodies.
// Anchored once-only replacements; aborts on a missing or duplicate anchor. Writes the migration.
import { readFileSync, writeFileSync } from "node:fs";
import { runSql } from "../tests/m1m2/_harness.mjs";

const OUT = "migrations/20260923162654_c10-leave-review-authorize-first.sql";

function live(sig) {
  const r = runSql(`select pg_get_functiondef('${sig}'::regprocedure) as def`);
  return (r.rows ?? r)[0].def;
}

function replaceOnce(body, anchor, replacement, label) {
  const eol = body.includes("\r\n") ? "\r\n" : "\n";
  const a = anchor.replace(/\n/g, eol);
  const count = body.split(a).length - 1;
  if (count !== 1) throw new Error(`${label}: anchor found ${count} times`);
  return body.replace(a, replacement.replace(/\n/g, eol));
}

const NOTE = `  -- C10: a missing leave answers exactly like another tenant's leave (P1003), and the caller is
  -- authorized BEFORE any state of the leave is revealed.`;

let approve = live("public.approve_leave_request(uuid,date[],integer)");
approve = replaceOnce(
  approve,
  `  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leave request not found';
  END IF;

  IF v_leave.status <> 'pending' THEN
    RAISE EXCEPTION 'Leave request is no longer pending (current status: %)', v_leave.status;
  END IF;

  v_hr_employee_id := public.assert_leave_reviewer(v_leave.tenant_id, v_leave.employee_id);
`,
  `${NOTE}
  IF NOT FOUND THEN
    RAISE EXCEPTION 'APPROVAL_SUBJECT_UNAVAILABLE' USING ERRCODE = 'P1003';
  END IF;

  v_hr_employee_id := public.assert_leave_reviewer(v_leave.tenant_id, v_leave.employee_id);

  IF v_leave.status <> 'pending' THEN
    RAISE EXCEPTION 'Leave request is no longer pending (current status: %)', v_leave.status;
  END IF;
`,
  "approve",
);

let cancel = live("public.cancel_leave_request(uuid,text,text)");
cancel = replaceOnce(
  cancel,
  `  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leave request not found';
  END IF;

  IF v_leave.status IN ('rejected', 'cancelled') THEN
    RAISE EXCEPTION 'Leave request is already %', v_leave.status;
  END IF;

  v_hr_employee_id := public.assert_leave_reviewer(v_leave.tenant_id, v_leave.employee_id);
`,
  `${NOTE}
  IF NOT FOUND THEN
    RAISE EXCEPTION 'APPROVAL_SUBJECT_UNAVAILABLE' USING ERRCODE = 'P1003';
  END IF;

  v_hr_employee_id := public.assert_leave_reviewer(v_leave.tenant_id, v_leave.employee_id);

  IF v_leave.status IN ('rejected', 'cancelled') THEN
    RAISE EXCEPTION 'Leave request is already %', v_leave.status;
  END IF;
`,
  "cancel",
);

const header = `-- C10: leave review authorizes before it reveals.
-- Measured on TB-M1M2 2026-09-23 (tests/m1m2/c10_leave_review_order.mjs, before-run): a signed-in user
-- of ANOTHER tenant calling approve_leave_request / cancel_leave_request with a leave id was told
-- "no longer pending (current status: approved)", "already cancelled" or "not found" -- the leave's
-- existence and status -- because the status check ran before assert_leave_reviewer(). Nothing was
-- ever approved or changed. Fix: a missing leave raises the same P1003 APPROVAL_SUBJECT_UNAVAILABLE
-- that assert_leave_reviewer() gives another tenant's leave, and the status check moves after the
-- authorization. Authorized reviewers see exactly the same messages as before.
-- Bodies derived from live pg_get_functiondef() by scratch/c10-gen.mjs (anchored, once-only edits).
-- The FOR UPDATE row lock still precedes authorization; an outsider's call raises and rolls back, so
-- the lock lives only for that failing call (accepted, documented in the package review).
-- No BEGIN/COMMIT: the migration runner owns the transaction.

`;
writeFileSync(OUT, `${header}${approve.trimEnd()};\n\n${cancel.trimEnd()};\n`);
console.log(`wrote ${OUT}`);
