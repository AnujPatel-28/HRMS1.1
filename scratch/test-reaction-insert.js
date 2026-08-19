import { createClient } from "@insforge/sdk";

const baseUrl = process.env.VITE_INSFORGE_URL;
const anonKey = process.env.VITE_INSFORGE_ANON_KEY;

if (!baseUrl || !anonKey) {
  console.error("Missing env");
  process.exit(1);
}

const client = createClient({ baseUrl, anonKey });

async function run() {
  const reaction = {
    tenant_id: '97da3641-d69e-4e7a-bdc9-760675be8d28',
    post_id: '0cad6dd5-df71-4c43-ba32-8da98e839c20',
    employee_id: '24ef7b09-f9c4-4a66-88e4-7e0f046ad62d',
    reaction: 'like'
  };

  const { data, error } = await client.database.from("post_reactions").insert([reaction]).select();
  if (error) {
    console.error("Error:", error);
  } else {
    console.log("Inserted Reaction:", data);
    
    // Clean up
    const { error: delError } = await client.database.from("post_reactions").delete().eq("id", data[0].id);
    if (delError) console.error("Clean up error:", delError);
    else console.log("Cleaned up successfully!");
  }
}

run().catch(console.error);
