// DEV UTILITY — not used in production. Run with: node --env-file=.env test-admin2.js
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
  const { data, error } = await insforge.functions.invoke("non-existent-function", {
    body: { test: true }
  });
  console.log("Edge function error:", error?.message);
}

test().catch(console.error);
