// Make storage buckets private on the harness target (SQL cannot set the managed bucket flag; see
// migrations 187000/189000/190000). Same call as tests/m1m2/p3_private_buckets.mjs patchBucketPublic.
// Usage (repo root): M1M2_TARGET=rehearsal node scripts/tools/bucket-private.mjs hr-policies [more…]
// Production is refused here on purpose: the release does this step by hand with the owner's go.
import { readFileSync } from "node:fs";
import { TB_M1M2, BASELINE_RO_PROJECT_ID } from "../../tests/m1m2/_target.mjs";

const linked = JSON.parse(readFileSync(".insforge/project.json", "utf8"));
if (linked.project_id === BASELINE_RO_PROJECT_ID || TB_M1M2.projectId === BASELINE_RO_PROJECT_ID) throw new Error("refusing the production parent");
if (linked.project_id !== TB_M1M2.projectId) throw new Error(`link is ${linked.project_name}, target is ${TB_M1M2.name}`);

for (const bucket of process.argv.slice(2)) {
  const res = await fetch(`${TB_M1M2.baseUrl}/api/storage/buckets/${bucket}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${linked.api_key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ isPublic: false }),
  });
  console.log(`${TB_M1M2.name} ${bucket} isPublic=false -> HTTP ${res.status}`);
  if (!res.ok) process.exitCode = 1;
}
