import { createClient } from "@insforge/sdk";

const baseUrl = process.env.VITE_INSFORGE_URL;
const anonKey = process.env.VITE_INSFORGE_ANON_KEY;

if (!baseUrl || !anonKey) {
  console.error("Missing env");
  process.exit(1);
}

const client = createClient({ baseUrl, anonKey });

async function run() {
  console.log("Querying pg_extension...");
  // Using public.get_auth_tenant_id() or whatever we want, let's just query pg_extension
  // Wait! Select from pg_extension might be blocked by RLS/privileges, but let's try.
  // Wait, is there a RPC we can call or query? We can try db query.
  // Let's run a select query.
  const { data, error } = await client.database.from("tenants").select("id").limit(1);
  console.log("Tenants check:", error || data);
}

run().catch(console.error);
