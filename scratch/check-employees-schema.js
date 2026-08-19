import { createClient } from "@insforge/sdk";

const baseUrl = process.env.VITE_INSFORGE_URL;
const anonKey = process.env.VITE_INSFORGE_ANON_KEY;

if (!baseUrl || !anonKey) {
  console.error("Missing env");
  process.exit(1);
}

const client = createClient({ baseUrl, anonKey });

async function run() {
  const { data, error } = await client.database.from("employees").select("*").limit(1);
  if (error) {
    console.error("Error:", error);
  } else {
    console.log("Employee Columns:", Object.keys(data[0]));
    console.log("Employee Sample Row:", data[0]);
  }
}

run().catch(console.error);
