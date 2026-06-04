import { createClient } from "@insforge/sdk";
import fs from "fs";

// Need to grab the URL and Anon Key from the project env.
const envFile = fs.readFileSync(".env", "utf-8");
const urlMatch = envFile.match(/VITE_INSFORGE_URL=(.*)/);
const keyMatch = envFile.match(/VITE_INSFORGE_ANON_KEY=(.*)/);

const supabaseUrl = urlMatch[1].replace(/"/g, '').trim();
const supabaseKey = keyMatch[1].replace(/"/g, '').trim();

const insforge = createClient({ baseUrl: supabaseUrl, anonKey: supabaseKey });

// We use the tenant and employee IDs we found in the database.
const tenantId = "111035ce-979c-429a-a482-ddfa87dbfe6e";
const employeeId = "91eaf0ab-8ef7-4d07-80af-7d94ab88e05c"; // Vishal Suthar
const hrEmployeeId = "ed632765-44ae-4139-ab69-44185b5abb57"; // Malvi Kothari (HR)

async function testExceptions() {
  console.log("Signing in as HR Admin (Malvi)...");
  const { data: authData, error: authErr } = await insforge.auth.signInWithPassword({
    email: "hr@talentmeshsolutions.com",
    password: "Password123!",
  });

  if (authErr || !authData) {
    console.error("Auth failed:", authErr);
    return;
  }

  console.log("Auth success! Executing verification scenarios...");

  // Scenario 1: Date check validation (end_date < start_date)
  console.log("\n--- Scenario 1: Inserting invalid date range (End < Start) ---");
  const { data: d1, error: err1 } = await insforge.database.from("attendance_location_exceptions").insert([{
    tenant_id: tenantId,
    employee_id: employeeId,
    exception_type: "work_from_home",
    start_date: "2026-06-10",
    end_date: "2026-06-05", // Invalid
    reason: "Should fail constraint",
    status: "approved",
    approved_by: hrEmployeeId,
    approved_at: new Date().toISOString(),
  }]);

  if (err1) {
    console.log("✅ Successfully caught invalid date exception via DB constraint:", err1.message);
  } else {
    console.error("❌ DB constraint failed: Allowed invalid date range!", d1);
  }

  // Scenario 2: Valid exception insertion
  console.log("\n--- Scenario 2: Inserting a valid exception (2026-06-10 to 2026-06-12) ---");
  const { data: d2, error: err2 } = await insforge.database.from("attendance_location_exceptions").insert([{
    tenant_id: tenantId,
    employee_id: employeeId,
    exception_type: "work_from_home",
    start_date: "2026-06-10",
    end_date: "2026-06-12",
    reason: "Valid exception test",
    status: "approved",
    approved_by: hrEmployeeId,
    approved_at: new Date().toISOString(),
  }]).select("id").single();

  if (err2) {
    console.error("❌ Failed to insert valid exception:", err2);
    return;
  }
  const exceptionId = d2.id;
  console.log("✅ Valid exception inserted successfully. ID:", exceptionId);

  // Scenario 3: Overlap check logic
  console.log("\n--- Scenario 3: Querying for overlap (Proposed: 2026-06-11 to 2026-06-13) ---");
  const proposedStart = "2026-06-11";
  const proposedEnd = "2026-06-13";
  
  const { data: overlaps, error: overlapErr } = await insforge.database
    .from("attendance_location_exceptions")
    .select("id, start_date, end_date")
    .eq("tenant_id", tenantId)
    .eq("employee_id", employeeId)
    .eq("status", "approved")
    .lte("start_date", proposedEnd)
    .gte("end_date", proposedStart);

  if (overlapErr) {
    console.error("❌ Overlap query failed:", overlapErr);
  } else {
    console.log("Query returned overlaps:", overlaps);
    if (overlaps.length > 0) {
      console.log("✅ Overlap logic correctly identified overlapping date range!");
    } else {
      console.error("❌ Overlap logic missed the overlapping exception!");
    }
  }

  // Scenario 4: Soft-cancellation (status = cancelled)
  console.log("\n--- Scenario 4: Soft-cancelling the exception ---");
  const { data: d4, error: err4 } = await insforge.database
    .from("attendance_location_exceptions")
    .update({
      status: "cancelled",
      cancelled_by: hrEmployeeId,
      cancelled_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId)
    .eq("id", exceptionId)
    .select("status, cancelled_at").single();

  if (err4) {
    console.error("❌ Soft-cancel failed:", err4);
  } else {
    console.log("✅ Soft-cancel success. Updated exception status:", d4.status, "at", d4.cancelled_at);
  }

  // Clean up
  console.log("\nCleaning up test exception row...");
  await insforge.database.from("attendance_location_exceptions").delete().eq("id", exceptionId);
  console.log("Cleanup done.");
}

testExceptions();
