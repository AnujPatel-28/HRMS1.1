// Rehearsal-only fixture repair: p1_membership_invitation_revocation expects QA leave 83f1421d… to be
// pending (it was on TB's 13-Sep snapshot; production has since approved it). Refuses anything but the
// rehearsal branch.
import { guardedMutation, runSql } from "../tests/m1m2/_harness.mjs";
import { TB_M1M2 } from "../tests/m1m2/_target.mjs";

if (TB_M1M2.name !== "rehearsal-v090") throw new Error("rehearsal branch only");
await guardedMutation("rehearsal: QA leave back to pending", () => console.log(JSON.stringify(runSql("UPDATE public.leaves SET status = 'pending' WHERE id = '83f1421d-1977-4f20-9587-71070844b9b2' RETURNING id, status"))));
