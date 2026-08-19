import { createClient } from "@insforge/sdk";

const baseUrl = process.env.VITE_INSFORGE_URL;
const anonKey = process.env.VITE_INSFORGE_ANON_KEY;

const insforge = createClient({ baseUrl, anonKey });

async function check() {
  const passwords = ["Password@123", "password123", "Password123!"];
  for (const password of passwords) {
    console.log(`Trying patelmanya59@gmail.com with password: ${password}...`);
    const { data, error } = await insforge.auth.signInWithPassword({
      email: "patelmanya59@gmail.com",
      password
    });
    if (!error) {
      console.log(`Success! Password is: ${password}`);
      console.log("Session:", data.session.access_token.substring(0, 15) + "...");
      return;
    }
  }
  console.log("All common passwords failed.");
}

check().catch(console.error);
