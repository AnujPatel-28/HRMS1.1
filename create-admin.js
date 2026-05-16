import { createClient } from "@insforge/sdk";

const insforge = createClient({
  baseUrl: "https://rq3qmu8y.ap-southeast.insforge.app",
  anonKey: "ik_aaf7c33902b801271b5ec27017882e87"
});

async function fix() {
  console.log("Signing up admin@talentmeshsolutions.com...");
  const email = "admin@talentmeshsolutions.com";
  const password = "password123";
  
  const { data, error } = await insforge.auth.signUp({
    email,
    password,
    options: {
      data: {
        role: "superadmin",
        tenant_id: null
      }
    }
  });
  
  if (error) {
    console.log("Signup error:", error.message);
  } else {
    console.log("Signup success!");
    console.log("Email:", email);
    console.log("Password:", password);
  }
}

fix().catch(console.error);
