import { createClient } from "@insforge/sdk";

const insforge = createClient({
  baseUrl: "https://rq3qmu8y.ap-southeast.insforge.app",
  anonKey: "ik_aaf7c33902b801271b5ec27017882e87"
});

async function test() {
  // Try to query tenants directly without login to see if it fails with Invalid token or RLS
  console.log("Querying as anon...");
  let res = await insforge.database.from("tenants").select("id,plan,status");
  console.log("Anon result:", res.error?.message || "Success", res.data?.length);

  // Authenticate as some test user if we had one. But we can just create a test user.
  const email = "testadmin3@example.com";
  const password = "Password123!";
  console.log("Signing up test user...");
  let authRes = await insforge.auth.signUp({
    email,
    password,
    options: {
      data: {
        role: "superadmin",
        tenant_id: null
      }
    }
  });
  
  if (authRes.error) {
    console.log("Signup error:", authRes.error.message);
    // If user exists, try to log in
    authRes = await insforge.auth.signInWithPassword({ email, password });
  }

  console.log("Token:", authRes.data?.session?.access_token?.substring(0, 20) + "...");

  console.log("Querying as superadmin...");
  res = await insforge.database.from("tenants").select("id,plan,status");
  console.log("Superadmin result:", res.error?.message || "Success", res.data?.length);
  
  if (res.error) {
    console.log("FULL ERROR:", res.error);
  }
}

test().catch(console.error);
