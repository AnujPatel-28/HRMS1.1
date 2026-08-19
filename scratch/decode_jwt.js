import { createClient } from "@insforge/sdk";
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

const client = createClient({ baseUrl, anonKey });

async function run() {
  console.log("Logging in...");
  const authRes = await client.auth.signInWithPassword({
    email: "manyamanya173@gmail.com",
    password: "MANYA123"
  });

  if (authRes.error) {
    console.error("Auth error:", authRes.error);
    return;
  }

  console.log("Auth Data:", JSON.stringify(authRes.data, null, 2));
  const token = authRes.data.session?.access_token || authRes.data.accessToken;
  console.log("Access Token:", token);

  if (!token) {
    console.error("No token found!");
    return;
  }

  // Decode JWT payload
  const payloadBase64 = token.split(".")[1];
  const payloadJson = Buffer.from(payloadBase64, "base64").toString("utf8");
  console.log("JWT Payload:", JSON.stringify(JSON.parse(payloadJson), null, 2));
}

run().catch(console.error);
