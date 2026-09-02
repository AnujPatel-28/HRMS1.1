import { createClient } from "@insforge/sdk";
import fs from "node:fs";
const env = fs.readFileSync(".env", "utf-8");
const baseUrl = env.match(/VITE_INSFORGE_URL=(.*)/)[1].replace(/"/g, "").trim();
const anonKey = env.match(/VITE_INSFORGE_ANON_KEY=(.*)/)[1].replace(/"/g, "").trim();
const TENANT = "da7a0000-7e57-4bca-95ba-c4ea7a6eca5e";
const c = createClient({ baseUrl, anonKey });
const { error } = await c.auth.signInWithPassword({ email: "hr-qa@talentmeshsolutions.com", password: process.env.QA_PASSWORD });
if (error) { console.error(error.message); process.exit(1); }

const r = await c.database.from("employees")
  .select("*, manager:employees!manager_id(full_name)")
  .eq("tenant_id", TENANT).order("created_at", { ascending: false });

console.log("error:", r.error ? r.error.message : "none");
(r.data ?? []).forEach(e => console.log("  " + String(e.full_name).padEnd(26) +
  " manager_id=" + (e.manager_id ? String(e.manager_id).slice(-4) : "null") +
  "  manager=" + JSON.stringify(e.manager) +
  "  -> name would render: " + JSON.stringify(e.manager?.full_name || null)));
