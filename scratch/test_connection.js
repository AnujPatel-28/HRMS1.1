import { createClient } from "@insforge/sdk";

const baseUrl = "https://rq3qmu8y-jx7.ap-southeast.insforge.app";
const anonKey = "ik_48f0f767d6c40717ba3112c9dca15a3b";

const db = createClient({ baseUrl, anonKey });

async function main() {
  console.log("Querying posts from client...");
  const { data: posts, error: postsErr } = await db.database
    .from("posts")
    .select("*")
    .limit(1);

  if (postsErr) {
    console.error("Posts query error:", postsErr);
  } else {
    console.log("Posts query success, row count:", posts?.length);
    console.log("Sample post:", posts?.[0]);
  }

  console.log("Querying employees from client...");
  const { data: employees, error: empErr } = await db.database
    .from("employees")
    .select("id,full_name,date_of_birth")
    .limit(1);

  if (empErr) {
    console.error("Employees query error:", empErr);
  } else {
    console.log("Employees query success, row count:", employees?.length);
    console.log("Sample employee:", employees?.[0]);
  }
}

main().catch(console.error);
