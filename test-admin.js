import { createClient } from "@insforge/sdk";

const insforge = createClient({
  baseUrl: "https://rq3qmu8y.ap-southeast.insforge.app",
  anonKey: "ik_aaf7c33902b801271b5ec27017882e87"
});

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

  // Let's test the specific queries using raw fetch to see exactly what PostgREST responds
  const res = await fetch("https://rq3qmu8y.ap-southeast.insforge.app/rest/v1/tenants?select=id,plan,status", {
    headers: {
      "apikey": "ik_aaf7c33902b801271b5ec27017882e87",
      "Authorization": "Bearer " + resAuth.data.session.access_token
    }
  });
  
  console.log("Status:", res.status);
  const text = await res.text();
  console.log("Body:", text);
}

test().catch(console.error);
