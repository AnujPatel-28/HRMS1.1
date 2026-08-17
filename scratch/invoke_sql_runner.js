import { createClient } from "@insforge/sdk";
import fs from "fs";

const env = fs.readFileSync(".env", "utf8");
const vars = {};
env.split("\n").forEach((line) => {
  const parts = line.split("=");
  if (parts.length === 2) {
    vars[parts[0].trim()] = parts[1].replace(/"/g, "").trim();
  }
});

const baseUrl = vars.VITE_INSFORGE_URL;
const anonKey = vars.VITE_INSFORGE_ANON_KEY;

const client = createClient({ baseUrl, anonKey });

async function run() {
  console.log("Invoking edge function to run SQL DDL...");
  
  // We want to drop the constraint on the database that the API connects to!
  const query = "ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_status_check;";
  
  console.log("Query:", query);
  
  const { data, error } = await client.functions.invoke("verify-employee-code", {
    body: { query }
  });

  if (error) {
    console.error("Function invocation failed:", error);
  } else {
    console.log("Function response:", data);
  }
}

run().catch(console.error);
