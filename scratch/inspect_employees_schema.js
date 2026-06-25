import { createClient } from "@insforge/sdk";

const baseUrl = "https://rq3qmu8y-jx7.ap-southeast.insforge.app";
const anonKey = "ik_48f0f767d6c40717ba3112c9dca15a3b";

const db = createClient({ baseUrl, anonKey });

async function main() {
  console.log("Querying sample employee...");
  const { data: emp, error: empErr } = await db.database
    .from("employees")
    .select("*")
    .limit(1);

  if (empErr) {
    console.error("Employee query error:", empErr);
  } else {
    console.log("Employee columns:", Object.keys(emp?.[0] || {}));
    console.log("Employee data:", emp?.[0]);
  }

  console.log("\nQuerying sample profile...");
  const { data: prof, error: profErr } = await db.database
    .from("profiles")
    .select("*")
    .limit(1);

  if (profErr) {
    console.error("Profile query error:", profErr);
  } else {
    console.log("Profile columns:", Object.keys(prof?.[0] || {}));
    console.log("Profile data:", prof?.[0]);
  }
}

main().catch(console.error);
