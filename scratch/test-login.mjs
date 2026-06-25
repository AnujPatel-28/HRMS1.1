import { createClient } from "@insforge/sdk";

const baseUrl = process.env.VITE_INSFORGE_URL;
const anonKey = process.env.VITE_INSFORGE_ANON_KEY;

const insforge = createClient({ baseUrl, anonKey });

async function check(email, password) {
  const { data, error } = await insforge.auth.signInWithPassword({ email, password });
  if (error) {
    console.log(`Failed login for ${email}: ${error.message}`);
    return false;
  }
  console.log(`Successful login for ${email}! User ID: ${data.user.id}, Tenant ID: ${data.user.metadata?.tenant_id}`);
  return true;
}

async function run() {
  console.log("Checking hr@talentmeshsolutions.com with Password123!:");
  await check("hr@talentmeshsolutions.com", "Password123!");

  console.log("\nChecking vishalsuthar2711@gmail.com with Password123!:");
  await check("vishalsuthar2711@gmail.com", "Password123!");
}

run().catch(console.error);
