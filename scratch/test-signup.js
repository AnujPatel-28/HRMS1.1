import { createClient } from "@insforge/sdk";

const projectUrl = "https://rq3qmu8y-jx7.ap-southeast.insforge.app";
const apiKey = "ik_48f0f767d6c40717ba3112c9dca15a3b";

async function main() {
  const insforge = createClient({
    baseUrl: projectUrl,
    anonKey: apiKey,
  });

  const email = `test-signup-${Date.now()}@talentmeshsolutions.com`;
  console.log(`Testing signUp with email: ${email}`);
  
  const { data, error } = await insforge.auth.signUp({
    email,
    password: "Password@123",
    name: "Test User"
  });

  console.log("Response data:", JSON.stringify(data, null, 2));
  console.log("Response error:", error);
}

main().catch(console.error);
