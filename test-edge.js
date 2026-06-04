import { createClient } from "@insforge/sdk";
import fs from "fs";

// Need to grab the URL and Anon Key from the project env.
const envFile = fs.readFileSync(".env", "utf-8");
const urlMatch = envFile.match(/VITE_INSFORGE_URL=(.*)/);
const keyMatch = envFile.match(/VITE_INSFORGE_ANON_KEY=(.*)/);

const supabaseUrl = urlMatch[1].replace(/"/g, '').trim();
const supabaseKey = keyMatch[1].replace(/"/g, '').trim();

const insforge = createClient({ baseUrl: supabaseUrl, anonKey: supabaseKey });

async function testFunction() {
  console.log("Signing in as HR Admin...");
  const { data: authData, error: authErr } = await insforge.auth.signInWithPassword({
    email: "hr@talentmeshsolutions.com",
    password: "Password@123",
  });

  if (authErr || !authData) {
    console.error("Auth failed:", authErr);
    return;
  }

  console.log("Auth success. Token:", authData.accessToken);

  const email = "manyamanya173@gmail.com";
  const password = "MANYA123";

  console.log("Invoking create-employee-user...");
  try {
    const { data, error } = await insforge.functions.invoke("create-employee-user", {
      body: { 
        email, 
        password,
        name: "Test User",
        tenant_id: "c3816de9-2222-49d0-842b-8e99613c635a"
      },
    });
    
    console.log("Result:");
    console.log("Data:", JSON.stringify(data, null, 2));
    console.log("Error:", JSON.stringify(error, null, 2));
  } catch (err) {
    console.error("Exception:", err);
  }
}

testFunction();
