// DEV UTILITY — not used in production. Run with: node --env-file=.env test-admin.js
// Keys are loaded from .env (gitignored). Never hard-code secrets here.
import { createClient } from "@insforge/sdk";

const baseUrl = process.env.VITE_INSFORGE_URL;
const anonKey = process.env.VITE_INSFORGE_ANON_KEY;

if (!baseUrl || !anonKey) {
  console.error("Missing VITE_INSFORGE_URL or VITE_INSFORGE_ANON_KEY in .env");
  process.exit(1);
}

const insforge = createClient({ baseUrl, anonKey });

async function test() {
  const email = "admin@talentmeshsolutions.com";
  const resAuth = await insforge.auth.signInWithPassword({
    email,
    password: "password123"
  });
  
  if (resAuth.error) {
    console.log("Login error:", resAuth.error.message);
    return;
  } else {
    console.log("Logged in!");
  }

  const res = await fetch(`${baseUrl}/rest/v1/tenants?select=id,plan,status`, {
    headers: {
      "apikey": anonKey,
      "Authorization": "Bearer " + resAuth.data.session.access_token
    }
  });
  
  console.log("Status:", res.status);
  const text = await res.text();
  console.log("Body:", text);
}

test().catch(console.error);
