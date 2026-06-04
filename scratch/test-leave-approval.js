import { createClient } from "@insforge/sdk";
import fs from "fs";

// Grab the URL and Anon Key from the project env.
const envFile = fs.readFileSync(".env", "utf-8");
const urlMatch = envFile.match(/VITE_INSFORGE_URL=(.*)/);
const keyMatch = envFile.match(/VITE_INSFORGE_ANON_KEY=(.*)/);

const supabaseUrl = urlMatch[1].replace(/"/g, '').trim();
const supabaseKey = keyMatch[1].replace(/"/g, '').trim();

const insforge = createClient({ baseUrl: supabaseUrl, anonKey: supabaseKey });

const leaveId = "15b7c922-b721-4818-b1f7-132127851f1c";

async function testLeaveRPCs() {
  console.log("Signing in as HR Manager (Manya)...");
  const { data: authData, error: authErr } = await insforge.auth.signInWithPassword({
    email: "patelmanya59@gmail.com",
    password: "Password123!",
  });

  if (authErr || !authData) {
    console.error("Auth failed:", authErr);
    return;
  }

  console.log("Auth success!");

  console.log("\n--- Scenario 1: Approving Leave ---");
  const { data: d1, error: err1 } = await insforge.database.rpc("approve_leave_request", {
    p_leave_id: leaveId,
    p_working_dates: ["2026-05-22"],
    p_approved_business_days: 1
  });

  if (err1) {
    console.error("❌ Approve RPC failed:", err1);
  } else {
    console.log("✅ Approve RPC succeeded!");
    
    // Check if the leave status updated in database
    const { data: leaveRow } = await insforge.database.from("leaves").select("status").eq("id", leaveId).single();
    console.log("Current leave status in DB:", leaveRow?.status);
  }

  console.log("\n--- Scenario 2: Rejecting Leave via Cancel RPC ---");
  const { data: d2, error: err2 } = await insforge.database.rpc("cancel_leave_request", {
    p_leave_id: leaveId,
    p_rejection_reason: "Resetting for user testing",
    p_new_status: "rejected"
  });

  if (err2) {
    console.error("❌ Cancel RPC failed:", err2);
  } else {
    console.log("✅ Cancel RPC succeeded!");
    
    // Verify status is rejected
    const { data: leaveRow } = await insforge.database.from("leaves").select("status").eq("id", leaveId).single();
    console.log("Current leave status in DB:", leaveRow?.status);
  }
}

testLeaveRPCs();
