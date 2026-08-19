import { createClient } from "@insforge/sdk";

const baseUrl = process.env.VITE_INSFORGE_URL;
const anonKey = process.env.VITE_INSFORGE_ANON_KEY;
const tenantId = "97da3641-d69e-4e7a-bdc9-760675be8d28"; // testtest tenant

if (!baseUrl || !anonKey) {
  console.error("Missing VITE_INSFORGE_URL or VITE_INSFORGE_ANON_KEY in .env");
  process.exit(1);
}

const insforge = createClient({ baseUrl, anonKey });

async function run() {
  console.log("1. Signing in as patelmanya59@gmail.com...");
  const { data, error: authErr } = await insforge.auth.signInWithPassword({
    email: "patelmanya59@gmail.com",
    password: "Password123!"
  });
  if (authErr) {
    console.error("Auth failed:", authErr);
    return;
  }
  console.log("Logged in successfully!");

  const db = insforge.database;

  // Let's run Dashboard employee query
  console.log("2. Running Dashboard employee query...");
  const qEmp = await db.from("employees")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("status", "active");

  if (qEmp.error) {
    console.error("Dashboard employees Query Error:", qEmp.error);
  } else {
    console.log("Dashboard employees Query Success! Rows:", qEmp.data?.length);
  }

  // Let's run Dashboard leaves query
  console.log("3. Running Dashboard leaves query...");
  const qLeaves = await db.from("leaves")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("status", "pending");

  if (qLeaves.error) {
    console.error("Dashboard leaves Query Error:", qLeaves.error);
  } else {
    console.log("Dashboard leaves Query Success! Rows:", qLeaves.data?.length);
  }

  // Let's run Dashboard attendance query
  console.log("4. Running Dashboard attendance query...");
  const qAtt = await db.from("attendance")
    .select("*")
    .eq("tenant_id", tenantId);

  if (qAtt.error) {
    console.error("Dashboard attendance Query Error:", qAtt.error);
  } else {
    console.log("Dashboard attendance Query Success! Rows:", qAtt.data?.length);
  }

  // Let's run Dashboard notifications query
  console.log("5. Running Dashboard notifications query...");
  const qNotif = await db.from("notifications")
    .select("*")
    .eq("tenant_id", tenantId);

  if (qNotif.error) {
    console.error("Dashboard notifications Query Error:", qNotif.error);
  } else {
    console.log("Dashboard notifications Query Success! Rows:", qNotif.data?.length);
  }

  // Let's run Dashboard shifts query
  console.log("6. Running Dashboard shifts query...");
  const qShifts = await db.from("shifts")
    .select("*")
    .eq("tenant_id", tenantId);

  if (qShifts.error) {
    console.error("Dashboard shifts Query Error:", qShifts.error);
  } else {
    console.log("Dashboard shifts Query Success! Rows:", qShifts.data?.length);
  }

  // Let's run Dashboard employee_shifts query
  console.log("7. Running Dashboard employee_shifts query...");
  const qEmpShifts = await db.from("employee_shifts")
    .select("*")
    .eq("tenant_id", tenantId);

  if (qEmpShifts.error) {
    console.error("Dashboard employee_shifts Query Error:", qEmpShifts.error);
  } else {
    console.log("Dashboard employee_shifts Query Success! Rows:", qEmpShifts.data?.length);
  }

  // Let's run Dashboard probation employees query
  console.log("8. Running Dashboard probation employees query...");
  const qProbation = await db.from("employees")
    .select("id, full_name, designation, probation_end_date, probation_status")
    .eq("tenant_id", tenantId)
    .in("probation_status", ["on_probation", "extended"])
    .order("probation_end_date");

  if (qProbation.error) {
    console.error("Dashboard probation employees Query Error:", qProbation.error);
  } else {
    console.log("Dashboard probation employees Query Success! Rows:", qProbation.data?.length);
  }

  // Let's run Offboarding exit requests query
  console.log("9. Running Offboarding exit requests query...");
  const qExit = await db.from("exit_requests")
    .select(`
      *,
      employee:employees!exit_requests_employee_id_fkey (
        full_name,
        designation,
        department,
        profile_photo_url
      )
    `)
    .eq("tenant_id", tenantId);

  if (qExit.error) {
    console.error("Offboarding exit requests Query Error:", qExit.error);
  } else {
    console.log("Offboarding exit requests Query Success! Rows:", qExit.data?.length);
  }
}

run().catch(console.error);
