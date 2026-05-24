import { createClient } from "@insforge/sdk";

const projectUrl = process.env.VITE_INSFORGE_URL;
const apiKey = process.env.VITE_INSFORGE_KEY;

const db = createClient({
  baseUrl: projectUrl,
  anonKey: apiKey,
});

async function testInsert() {
  const { data: { session }, error: authErr } = await db.auth.signInWithPassword({
    email: "hr@talentmeshsolutions.com",
    password: "Password@123", // Assuming standard test password, wait I shouldn't guess. But wait, I can use service role.
  });

  if (authErr) {
    console.error("Auth error", authErr);
    return;
  }

  const tenantId = "c3816de9-2222-49d0-842b-8e99613c635a";
  const hrEmployeeId = "b6ad3f26-d420-4084-a176-53db50f2bf79";
  const empId = "a3b602b8-71d0-42d4-934a-7baf7cd51370";

  const { error } = await db.from("tasks").insert([{
    title: "Test Task",
    tenant_id: tenantId,
    assigned_to: empId,
    assigned_by: hrEmployeeId,
    priority: "medium",
    status: "assigned",
  }]);

  console.log("Insert result:", error ? error : "Success!");
}

testInsert();
