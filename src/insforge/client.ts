import { createClient } from "@insforge/sdk";

const projectUrl = import.meta.env.VITE_INSFORGE_URL as string | undefined;
const apiKey = import.meta.env.VITE_INSFORGE_KEY as string | undefined;

if (!projectUrl || !apiKey) {
  console.warn("Missing InsForge env vars: VITE_INSFORGE_URL / VITE_INSFORGE_KEY");
}

export const insforge = createClient({
  baseUrl: projectUrl ?? "",
  anonKey: apiKey ?? "",
});

export const db = insforge.database;
export const auth = insforge.auth;
export const storage = insforge.storage;
export const realtime = insforge.realtime;
