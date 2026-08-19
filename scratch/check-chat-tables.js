import { createClient } from "@insforge/sdk";

const baseUrl = process.env.VITE_INSFORGE_URL;
const anonKey = process.env.VITE_INSFORGE_ANON_KEY;

if (!baseUrl || !anonKey) {
  console.error("Missing VITE_INSFORGE_URL or VITE_INSFORGE_ANON_KEY in env");
  process.exit(1);
}

const insforge = createClient({ baseUrl, anonKey });

async function check() {
  const email = "hr@talentmeshsolutions.com";
  const resAuth = await insforge.auth.signInWithPassword({
    email,
    password: "Password@123"
  });
  if (resAuth.error) {
    console.error("Login failed:", resAuth.error);
    return;
  }
  console.log("Logged in!");
  
  const token = resAuth.data.session.access_token;
  
  const resOpenAPI = await fetch(`${baseUrl}/rest/v1/`, {
    headers: {
      "apikey": anonKey,
      "Authorization": `Bearer ${token}`
    }
  });
  const openapi = await resOpenAPI.json();
  
  const tables = ['chat_channels', 'chat_channel_members', 'chat_messages', 'notifications'];
  for (const t of tables) {
    console.log(`\nTable: ${t}`);
    const definition = openapi.definitions[t];
    if (definition && definition.properties) {
      for (const [col, info] of Object.entries(definition.properties)) {
        const required = definition.required?.includes(col) ? "NOT NULL" : "NULL";
        console.log(` - ${col}: ${info.type} (${info.format || ''}) - ${required}`);
      }
    } else {
      console.log("No definition found in OpenAPI spec");
    }
  }
}

check().catch(console.error);
