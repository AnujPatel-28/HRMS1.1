import { createClient } from "@insforge/sdk";
import fs from "node:fs";
const env = fs.readFileSync(".env", "utf-8");
const baseUrl = env.match(/VITE_INSFORGE_URL=(.*)/)[1].replace(/"/g, "").trim();
const anonKey = env.match(/VITE_INSFORGE_ANON_KEY=(.*)/)[1].replace(/"/g, "").trim();
const TENANT = "da7a0000-7e57-4bca-95ba-c4ea7a6eca5e";
const c = createClient({ baseUrl, anonKey });
const { error } = await c.auth.signInWithPassword({ email: "hr-qa@talentmeshsolutions.com", password: process.env.QA_PASSWORD });
if (error) { console.error(error.message); process.exit(1); }

for (const sel of [
  "*, manager:employees!manager_id(full_name)",
  "*, manager:employees!employees_manager_id_fkey(full_name)",
]) {
  const r = await c.database.from("employees").select(sel).eq("tenant_id", TENANT).order("full_name");
  console.log("\nSELECT " + sel);
  if (r.error) { console.log("  ERROR: " + r.error.message); continue; }
  (r.data ?? []).forEach(e => {
    const m = e.manager;
    const shape = Array.isArray(m) ? `array(${m.length})` : (m ? "object" : "null");
    console.log("  " + String(e.full_name).padEnd(26) + " manager=" + shape +
      " -> renders: " + JSON.stringify(m?.full_name ?? null));
  });
}
