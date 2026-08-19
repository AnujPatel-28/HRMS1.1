import { createClient } from "@insforge/sdk";

const baseUrl = process.env.VITE_INSFORGE_URL;
const anonKey = process.env.VITE_INSFORGE_ANON_KEY;

if (!baseUrl || !anonKey) {
  console.error("Missing VITE_INSFORGE_URL or VITE_INSFORGE_ANON_KEY in env");
  process.exit(1);
}

const client = createClient({ baseUrl, anonKey });

async function check() {
  console.log("Querying posts table using SDK with anonymous key...");
  const resPosts = await client.database.from("posts").select("*").limit(1);
  if (resPosts.error) {
    console.error("posts error:", resPosts.error);
  } else {
    console.log("posts columns or empty array:", resPosts.data);
  }

  console.log("Querying post_reactions table using SDK with anonymous key...");
  const resReactions = await client.database.from("post_reactions").select("*").limit(1);
  if (resReactions.error) {
    console.error("post_reactions error:", resReactions.error);
  } else {
    console.log("post_reactions columns or empty array:", resReactions.data);
  }
}

check().catch(console.error);
