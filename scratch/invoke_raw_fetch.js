import fs from "fs";

const env = fs.readFileSync(".env", "utf8");
const vars = {};
env.split("\n").forEach((line) => {
  const parts = line.split("=");
  if (parts.length === 2) {
    vars[parts[0].trim()] = parts[1].replace(/"/g, "").trim();
  }
});

const baseUrl = vars.VITE_INSFORGE_URL;
const anonKey = vars.VITE_INSFORGE_ANON_KEY;

// Try invoking the function via fetch at various endpoints
async function tryUrl(url) {
  console.log(`\nTesting URL: ${url}`);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": anonKey,
        "Authorization": `Bearer ${anonKey}`
      },
      body: JSON.stringify({
        query: "ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_status_check;"
      })
    });
    
    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Response:", text);
  } catch (e) {
    console.error("Error:", e.message);
  }
}

async function run() {
  const url1 = `${baseUrl}/api/functions/verify-employee-code`;
  const url2 = `${baseUrl}/functions/v1/verify-employee-code`;
  const url3 = `https://rq3qmu8y.functions.insforge.app/verify-employee-code`;
  
  await tryUrl(url1);
  await tryUrl(url2);
  await tryUrl(url3);
}

run().catch(console.error);
