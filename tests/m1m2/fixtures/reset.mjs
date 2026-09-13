#!/usr/bin/env node
/**
 * Restores TB-M1M2 to its branch-creation (T0) snapshot.
 *
 * Destructive by design: every change made since the branch was created is discarded — synthetic
 * fixtures, schema changes, applied migrations, all of it. That is the point. A reset that only
 * deletes the rows a teardown script happens to know about drifts out of step with the fixtures
 * the moment a lane adds one; T0 cannot drift.
 *
 * Re-running is safe and idempotent: resetting an already-reset branch is a no-op.
 */
import { guardedMutation, HarnessBlockedError, resetBranchToSnapshot } from "../_harness.mjs";

try {
  await guardedMutation("M1M2 synthetic reset", async (verified) => {
    resetBranchToSnapshot();
    console.log(
      `M1M2 synthetic reset: ${verified.projectName} restored to its T0 branch snapshot. ` +
        "Any migrations applied after branch creation must be re-applied.",
    );
  });
} catch (error) {
  const code = error instanceof HarnessBlockedError ? error.code : "RESET_ERROR";
  console.error(`${code}: ${error.message}`);
  process.exit(1);
}
