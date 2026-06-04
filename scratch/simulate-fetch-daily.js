import { createClient } from "@insforge/sdk";
import fs from "fs";

const envFile = fs.readFileSync(".env", "utf-8");
const urlMatch = envFile.match(/VITE_INSFORGE_URL=(.*)/);
const keyMatch = envFile.match(/VITE_INSFORGE_ANON_KEY=(.*)/);

const baseUrl = urlMatch[1].replace(/"/g, '').trim();
const anonKey = keyMatch[1].replace(/"/g, '').trim();

const insforge = createClient({ baseUrl, anonKey });

async function run() {
  console.log("Signing in as patelmanya59@gmail.com...");
  const authRes = await insforge.auth.signInWithPassword({
    email: "patelmanya59@gmail.com",
    password: "Password123!"
  });

  if (authRes.error) {
    console.error("Auth failed:", authRes.error.message);
    return;
  }

  const tenantId = "97da3641-d69e-4e7a-bdc9-760675be8d28";
  const dailyDate = "2026-06-03";

  // Fetch all employees
  const { data: allEmployees, error: empErr } = await insforge.database
    .from("employees")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("full_name");
  
  if (empErr) {
    console.error("Error fetching employees:", empErr);
    return;
  }

  console.log(`\n--- allEmployees in tenant (${allEmployees.length}) ---`);
  for (const emp of allEmployees) {
    console.log(`- ID: ${emp.id}, Name: ${emp.full_name}, Email: ${emp.email}`);
  }

  // Fetch daily attendance
  const { data: attRes, error: attErr } = await insforge.database
    .from("attendance")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("date", dailyDate);

  if (attErr) {
    console.error("Error fetching attendance:", attErr);
    return;
  }

  console.log(`\n--- attRes.data from query (${attRes.length}) ---`);
  for (const att of attRes) {
    console.log(`- ID: ${att.id}, EmployeeID: ${att.employee_id}, Date: ${att.date}, Status: ${att.status}, PunchIn: ${att.punch_in}`);
  }

  // Merging logic
  const merged = allEmployees.map((emp) => {
    const rec = attRes.find((row) => row.employee_id === emp.id);
    if (rec) return { ...rec, employee: emp };
    return {
      id: "",
      employee_id: emp.id,
      date: dailyDate,
      punch_in: null,
      status: "absent",
      employee: emp
    };
  });

  console.log(`\n--- Merged Results (${merged.length}) ---`);
  for (const row of merged) {
    console.log(`- Employee: ${row.employee.full_name}, ID: ${row.employee_id}, PunchIn: ${row.punch_in}, Status: ${row.status}`);
  }
}

run().catch(console.error);
