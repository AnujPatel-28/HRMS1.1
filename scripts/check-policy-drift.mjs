#!/usr/bin/env node
/**
 * Fails when an RLS policy exists in the live database but in no file under migrations/.
 *
 * This is the guard for engineering principle P1 (doc/architecture/01-engineering-principles.md).
 * Without it the drift returns — it already did once: on 2026-08-14, three untracked policies on
 * `employees` caused a full outage (42P17 infinite recursion) that no code review could have caught,
 * because the policies existed in no reviewable file.
 *
 * Checks provenance (does a policy of this name appear in migrations/), NOT text equivalence.
 * A later migration legitimately supersedes an earlier one's text, so comparing bodies would produce
 * false failures. What we are enforcing is "nothing was applied outside migration control".
 *
 * Usage:  node scripts/check-policy-drift.mjs
 * CI:     needs the InsForge admin key available to the CLI (.insforge/project.json or env).
 */
import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(repoRoot, "migrations");

const SQL =
  "SELECT tablename, policyname FROM pg_policies WHERE schemaname='public' ORDER BY tablename, policyname";

let rows;
try {
  // Shell form (not execFileSync) so this works on Windows, where npx is a .cmd shim.
  // SQL is a fixed literal below — no interpolation, nothing user-supplied.
  const raw = execSync(`npx --yes @insforge/cli db query "${SQL}" --json`, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  rows = JSON.parse(raw.slice(raw.indexOf("{"))).rows;
} catch (err) {
  console.error("Could not read pg_policies. Is the InsForge CLI linked and authenticated?");
  console.error(err.message);
  process.exit(2);
}

const migrationText = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(migrationsDir, f), "utf8"))
  .join("\n");

const untracked = rows.filter((p) => !migrationText.includes(p.policyname));

if (untracked.length === 0) {
  console.log(`OK — all ${rows.length} live RLS policies are defined in migrations/.`);
  process.exit(0);
}

console.error(
  `\nPOLICY DRIFT: ${untracked.length} of ${rows.length} live policies are in no migration.\n`,
);
const byTable = {};
for (const p of untracked) (byTable[p.tablename] ??= []).push(p.policyname);
for (const t of Object.keys(byTable).sort()) {
  console.error(`  ${t}`);
  for (const n of byTable[t]) console.error(`      ${n}`);
}
console.error(`
These were applied outside migration control — via the dashboard, a loose .sql script, or an ad-hoc
db query. That means they cannot be reviewed in a diff, recreated on a new project, or diffed between
environments.

Fix: write a migration that defines them (DROP POLICY IF EXISTS + CREATE POLICY), then re-run.
See system-audit-2026-08/10-policy-provenance-drift.md.
`);
process.exit(1);
