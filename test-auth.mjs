import { createClient } from "@insforge/sdk";

const projectUrl = process.env.VITE_INSFORGE_URL;
const apiKey = process.env.VITE_INSFORGE_KEY;

const db = createClient({
  baseUrl: projectUrl,
  anonKey: apiKey,
});

async function testAuth() {
  const { data, error } = await db.auth.signInWithPassword({
    email: "hr@talentmeshsolutions.com",
    password: "Password@123",
  });
  console.log("Auth result:", data?.user?.id, error);
}

testAuth();
