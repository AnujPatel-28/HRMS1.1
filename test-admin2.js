import { createClient } from "@insforge/sdk";

const insforge = createClient({
  baseUrl: "https://rq3qmu8y.ap-southeast.insforge.app",
  anonKey: "ik_aaf7c33902b801271b5ec27017882e87"
});

async function test() {
  const { data, error } = await insforge.functions.invoke("non-existent-function", {
    body: { test: true }
  });
  console.log("Edge function error:", error?.message);
}

test().catch(console.error);
