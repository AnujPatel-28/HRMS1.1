import { createClient } from "@insforge/sdk";

const baseUrl = process.env.VITE_INSFORGE_URL;
const anonKey = process.env.VITE_INSFORGE_ANON_KEY;

if (!baseUrl || !anonKey) {
  console.error("Missing env");
  process.exit(1);
}

const client = createClient({ baseUrl, anonKey });

async function getEmps() {
  const { data, error } = await client.database.from("employees").select("id, full_name, email, role, status, tenant_id").limit(10);
  if (error) {
    console.error("Error:", error);
  } else {
    console.log("Employees:", data);
  }
}

getEmps().catch(console.error);
