import { createClient } from "@insforge/sdk";
import fs from "fs";

// Need to grab the URL and Anon Key from the project env.
const envFile = fs.readFileSync(".env", "utf-8");
const urlMatch = envFile.match(/VITE_INSFORGE_URL=(.*)/);
const keyMatch = envFile.match(/VITE_INSFORGE_ANON_KEY=(.*)/);

const supabaseUrl = urlMatch[1].replace(/"/g, '');
const supabaseKey = keyMatch[1].replace(/"/g, '');

const insforge = createClient({ baseUrl: supabaseUrl, anonKey: supabaseKey });

async function testFunction() {
  const email = "manyamanya173@gmail.com";
  const password = "MANYA123";

  console.log("Invoking set-employee-password...");
  try {
    const { data, error } = await insforge.functions.invoke("set-employee-password", {
      body: { email, password },
    });
    
    console.log("Result:");
    console.log("Data:", data);
    console.log("Error:", error);
  } catch (err) {
    console.error("Exception:", err);
  }
}

testFunction();
