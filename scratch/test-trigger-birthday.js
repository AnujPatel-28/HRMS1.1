import { createClient } from "@insforge/sdk";

const baseUrl = process.env.VITE_INSFORGE_URL;
const anonKey = process.env.VITE_INSFORGE_ANON_KEY;

if (!baseUrl || !anonKey) {
  console.error("Missing env");
  process.exit(1);
}

const client = createClient({ baseUrl, anonKey });

async function run() {
  const empId = '24ef7b09-f9c4-4a66-88e4-7e0f046ad62d';
  console.log("1. Setting employee date of birth to today (June 24)...");
  
  const { error: updateError } = await client.database
    .from("employees")
    .update({ date_of_birth: '1995-06-24' })
    .eq("id", empId);
    
  if (updateError) {
    console.error("Update error:", updateError);
    return;
  }
  
  console.log("2. Triggering Deno edge function via HTTP POST...");
  const res = await fetch("https://rq3qmu8y-jx7.functions.insforge.app/auto-birthday-posts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ date: "2026-06-24" })
  });
  
  console.log("Deno trigger status:", res.status);
  console.log("Deno response:", await res.json());
  
  console.log("3. Fetching posts of type 'birthday' for tenant...");
  const { data: posts, error: postErr } = await client.database
    .from("posts")
    .select("*")
    .eq("type", "birthday")
    .eq("tenant_id", "97da3641-d69e-4e7a-bdc9-760675be8d28");
    
  if (postErr) {
    console.error("Posts fetch error:", postErr);
  } else {
    console.log("Birthday posts found:", posts);
  }

  console.log("4. Cleaning up (resetting date of birth and deleting test post)...");
  await client.database
    .from("employees")
    .update({ date_of_birth: null })
    .eq("id", empId);
    
  if (posts && posts.length > 0) {
    for (const post of posts) {
      await client.database.from("posts").delete().eq("id", post.id);
    }
    console.log("Test posts cleaned up!");
  }
}

run().catch(console.error);
