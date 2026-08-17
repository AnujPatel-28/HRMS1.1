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

async function run() {
  console.log("Fetching OpenAPI spec from PostgREST...");
  const res = await fetch(baseUrl, {
    headers: {
      Accept: "application/json"
    }
  });

  const spec = await res.json();
  const paths = Object.keys(spec.paths || {});
  console.log("Total paths found:", paths.length);
  
  const rpcs = paths.filter(p => p.startsWith("/rpc/"));
  console.log("\nExposed RPC functions:");
  rpcs.forEach(p => console.log(`  ${p}`));
}

run().catch(console.error);
