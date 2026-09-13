#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BASELINE_RO_PROJECT_ID, REQUIRED_CLI, TB_M1M2 } from "./_target.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export class HarnessBlockedError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "HarnessBlockedError";
    this.code = code;
  }
}

function parseCliJson(raw) {
  const starts = [raw.indexOf("{"), raw.indexOf("[")].filter((index) => index >= 0);
  if (starts.length === 0) {
    throw new HarnessBlockedError("CLI_JSON_MISSING", "InsForge CLI returned no JSON payload.");
  }
  try {
    return JSON.parse(raw.slice(Math.min(...starts)));
  } catch {
    throw new HarnessBlockedError("CLI_JSON_INVALID", "InsForge CLI returned invalid JSON.");
  }
}

// Command names, branch names and flags (`-y`, `--parent`) only. No spaces, quotes or shell
// metacharacters. Free text such as SQL must opt in explicitly via `allowFreeText`.
const SAFE_CLI_ARG = /^--?[A-Za-z0-9][A-Za-z0-9._@-]*$|^[A-Za-z0-9][A-Za-z0-9._@-]*$/;

/**
 * Resolves the locally pinned CLI's JS entrypoint, to be run with `process.execPath`.
 *
 * Deliberately not `npx`: Node 20+ refuses to spawn a `.cmd` shim without `shell: true`
 * (the CVE-2024-27980 change), and a shell would force this harness to hand-quote SQL for
 * cmd.exe. Running the entrypoint directly keeps one argv-array code path on every platform.
 *
 * It is also the only way the version is genuinely pinned. `npx @insforge/cli` here resolved a
 * stale 0.1.73 from cache — a version with no `branch` command at all, which is why the original
 * baseline recorded branch listing as "insufficient permissions" rather than a version gap.
 */
function cliEntrypoint() {
  const entry = join(repoRoot, "node_modules", "@insforge", "cli", "dist", "index.js");
  if (!existsSync(entry)) {
    throw new HarnessBlockedError(
      "CLI_NOT_INSTALLED",
      `Pinned ${REQUIRED_CLI} is not installed. Run: npm install --save-dev ${REQUIRED_CLI}`,
    );
  }
  return entry;
}

/** Runs the pinned CLI with an argv array and no shell. See `cliEntrypoint` for why. */
function runCli(args, { json = true, allowFreeText = false } = {}) {
  if (!allowFreeText && args.some((arg) => !SAFE_CLI_ARG.test(arg))) {
    throw new HarnessBlockedError("CLI_ARGUMENT_DENIED", "Harness CLI arguments must be bare tokens.");
  }
  const result = spawnSync(process.execPath, [cliEntrypoint(), ...args, ...(json ? ["--json"] : [])], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error || result.status !== 0) {
    // Raw output is suppressed deliberately: CLI errors have been observed to echo privileged
    // configuration, and this harness must never put that in a test log.
    throw new HarnessBlockedError(
      "CLI_CALL_FAILED",
      `InsForge CLI call failed for '${args[0]}'; raw output was suppressed.`,
    );
  }
  return json ? parseCliJson(result.stdout) : result.stdout;
}

function runCliJson(args) {
  return runCli(args, { json: true });
}

/** Runs one SQL statement against the verified target. Callers must be inside `guardedMutation`. */
export function runSql(sql) {
  return runCli(["db", "query", sql], { json: true, allowFreeText: true });
}

function readLinkedProject() {
  try {
    const linked = JSON.parse(readFileSync(join(repoRoot, ".insforge", "project.json"), "utf8"));
    return {
      projectId: linked.project_id,
      projectName: linked.project_name,
      baseUrl: linked.oss_host,
      region: linked.region,
      branchedFrom: linked.branched_from?.project_id ?? null,
    };
  } catch {
    throw new HarnessBlockedError(
      "LINK_METADATA_UNAVAILABLE",
      "Local InsForge link metadata is missing or unreadable.",
    );
  }
}

export function assertRecordedTarget(target = TB_M1M2) {
  if (!target.projectId || !target.baseUrl || target.status !== "AUTHORIZED") {
    throw new HarnessBlockedError(
      "TARGET_NOT_AUTHORIZED",
      "TB-M1M2 lacks a verified authorized project ID/base URL; refusing all mutations.",
    );
  }
  if (target.projectId === BASELINE_RO_PROJECT_ID) {
    throw new HarnessBlockedError(
      "BASELINE_RO_DENIED",
      "The recorded target is BASELINE-RO; refusing all mutations.",
    );
  }
}

export function assertTargetIdentity({ target = TB_M1M2, currentProject, linkedProject }) {
  assertRecordedTarget(target);
  const currentId = currentProject?.project?.project_id ?? currentProject?.project_id;
  if (!currentId || currentId !== target.projectId) {
    throw new HarnessBlockedError(
      "WRONG_PROJECT",
      "The active InsForge project does not match recorded TB-M1M2; refusing all mutations.",
    );
  }
  if (linkedProject.projectId !== target.projectId || linkedProject.baseUrl !== target.baseUrl) {
    throw new HarnessBlockedError(
      "LINK_TARGET_MISMATCH",
      "Local link identifiers do not match recorded TB-M1M2; refusing all mutations.",
    );
  }
  // TB-M1M2 is a branch. `branch switch --parent` rewrites .insforge/project.json in place, so a
  // stale shell that switched back must not be able to satisfy the checks above by coincidence.
  if (target.branchedFrom && linkedProject.branchedFrom !== target.branchedFrom) {
    throw new HarnessBlockedError(
      "BRANCH_LINEAGE_MISMATCH",
      "Linked project is not the recorded branch of BASELINE-RO; refusing all mutations.",
    );
  }
}

export function verifyTarget({ cli = runCliJson, target = TB_M1M2 } = {}) {
  assertRecordedTarget(target);
  const currentProject = cli(["current"]);
  const linkedProject = readLinkedProject();
  assertTargetIdentity({ target, currentProject, linkedProject });

  // A successful fresh metadata read proves backend access without printing the response,
  // which may contain privileged configuration on older CLI/backend combinations.
  const metadata = cli(["metadata"]);
  if (!metadata || typeof metadata !== "object" || !metadata.version) {
    throw new HarnessBlockedError(
      "FRESH_METADATA_INVALID",
      "Fresh TB-M1M2 metadata was unavailable or incomplete; refusing all mutations.",
    );
  }

  return Object.freeze({
    projectId: target.projectId,
    projectName: target.name,
    baseUrl: target.baseUrl,
    backendVersion: metadata.version,
  });
}

export async function guardedMutation(label, mutate, options) {
  const verified = verifyTarget(options);
  console.log(`${label}: target guard passed for ${verified.projectName} (${verified.projectId}).`);
  return mutate(verified);
}

/**
 * Restores TB-M1M2 to its branch-creation (T0) snapshot.
 *
 * This is the whole reason the target is a branch rather than a standalone project: reset is a
 * backend-level rollback to a known-good state, not a hand-maintained teardown script that has to
 * stay in step with every fixture any lane adds. A teardown script drifts; T0 does not.
 *
 * It discards ALL changes made since the branch was created, fixtures and schema alike. Callers
 * must already have passed the target guard.
 */
export function resetBranchToSnapshot(target = TB_M1M2) {
  if (!target.branchName) {
    throw new HarnessBlockedError("BRANCH_NAME_MISSING", "Recorded target has no branch name to reset.");
  }
  // `branch` commands address the parent's branch list, so this must run from the parent context.
  runCli(["branch", "switch", "--parent"], { json: false });
  try {
    runCli(["branch", "reset", target.branchName, "-y"], { json: false });
  } finally {
    runCli(["branch", "switch", target.branchName], { json: false });
  }
}

function selfTest() {
  const expected = "11111111-1111-4111-8111-111111111111";
  const wrong = "22222222-2222-4222-8222-222222222222";
  const target = {
    name: "SYNTHETIC-UNIT-TARGET",
    projectId: expected,
    baseUrl: "https://synthetic-unit-target.invalid",
    status: "AUTHORIZED",
  };
  assert.throws(
    () =>
      assertTargetIdentity({
        target,
        currentProject: { project: { project_id: wrong } },
        linkedProject: { projectId: wrong, baseUrl: target.baseUrl },
      }),
    (error) => error instanceof HarnessBlockedError && error.code === "WRONG_PROJECT",
  );
  assert.throws(
    () => assertRecordedTarget({ ...target, projectId: BASELINE_RO_PROJECT_ID }),
    (error) => error instanceof HarnessBlockedError && error.code === "BASELINE_RO_DENIED",
  );
  // Lineage: a shell that ran `branch switch --parent` must not satisfy the id/url checks by luck.
  const branched = { ...target, branchedFrom: BASELINE_RO_PROJECT_ID };
  assert.throws(
    () =>
      assertTargetIdentity({
        target: branched,
        currentProject: { project: { project_id: expected } },
        linkedProject: { projectId: expected, baseUrl: target.baseUrl, branchedFrom: null },
      }),
    (error) => error instanceof HarnessBlockedError && error.code === "BRANCH_LINEAGE_MISMATCH",
  );
  // Free text is refused on the bare-token path, so a CLI argument cannot smuggle a shell token.
  assert.throws(
    () => runCli(["db", "query", "SELECT 1; DROP TABLE x"], { json: true }),
    (error) => error instanceof HarnessBlockedError && error.code === "CLI_ARGUMENT_DENIED",
  );
  assert.doesNotThrow(() =>
    assertTargetIdentity({
      target: branched,
      currentProject: { project: { project_id: expected } },
      linkedProject: {
        projectId: expected,
        baseUrl: target.baseUrl,
        branchedFrom: BASELINE_RO_PROJECT_ID,
      },
    }),
  );
  console.log(
    "M1M2 harness self-test passed: wrong-project, BASELINE-RO, branch-lineage and CLI-argument guards fail closed.",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes("--self-test")) selfTest();
    else if (process.argv.includes("--check-target")) {
      const target = verifyTarget();
      console.log(`Verified ${target.projectName} (${target.projectId}); privileged metadata suppressed.`);
    } else {
      throw new HarnessBlockedError(
        "USAGE",
        "Use --self-test or --check-target. Fixture commands have separate package scripts.",
      );
    }
  } catch (error) {
    const code = error instanceof HarnessBlockedError ? error.code : "HARNESS_ERROR";
    console.error(`${code}: ${error.message}`);
    process.exit(1);
  }
}
