import { createClient } from "@insforge/sdk";
import fs from "fs";

const envFile = fs.readFileSync(".env", "utf-8");
const urlMatch = envFile.match(/VITE_INSFORGE_URL=(.*)/);
const keyMatch = envFile.match(/VITE_INSFORGE_ANON_KEY=(.*)/);

const baseUrl = urlMatch[1].replace(/"/g, '').trim();
const anonKey = keyMatch[1].replace(/"/g, '').trim();

const insforge = createClient({ baseUrl, anonKey });

async function run() {
  console.log("Signing in...");
  const authRes = await insforge.auth.signInWithPassword({
    email: "patelmanya59@gmail.com",
    password: "Password123!"
  });

  if (authRes.error) {
    console.error("Auth failed:", authRes.error.message);
    return;
  }

  console.log("\n--- Querying Tenants ---");
  const { data: tenant1 } = await insforge.database.from("tenants").select("*").eq("id", "97da3641-d69e-4e7a-bdc9-760675be8d28").maybeSingle();
  console.log("Tenant 97da3641-d69e-4e7a-bdc9-760675be8d28:", JSON.stringify(tenant1, null, 2));

  const { data: tenant2 } = await insforge.database.from("tenants").select("*").eq("id", "c3816de9-2222-49d0-842b-8e99613c635a").maybeSingle();
  console.log("Tenant c3816de9-2222-49d0-842b-8e99613c635a:", JSON.stringify(tenant2, null, 2));
}

run().catch(console.error);
