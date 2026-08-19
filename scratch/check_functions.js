import { spawn } from "child_process";
import readline from "readline";

const slugs = [
  "candidate-profile",
  "candidate-dashboard",
  "candidate-applications",
  "resume-proxy",
  "recruiter-document-proxy",
  "recommendations"
];

const args = [
  "-y",
  "@insforge/mcp@latest",
  "--api_key",
  "ik_48f0f767d6c40717ba3112c9dca15a3b",
  "--api_base_url",
  "https://rq3qmu8y-jx7.ap-southeast.insforge.app"
];

async function checkFunction(slug) {
  return new Promise((resolve) => {
    const mProcess = spawn("npx", args, {
      stdio: ["pipe", "pipe", "inherit"],
      shell: true
    });

    const rl = readline.createInterface({
      input: mProcess.stdout,
      terminal: false
    });

    let msgId = 1;
    const pending = new Map();

    function send(method, params, isNotification = false) {
      const msg = { jsonrpc: "2.0", method };
      if (params !== undefined) msg.params = params;
      if (!isNotification) msg.id = msgId++;
      mProcess.stdin.write(JSON.stringify(msg) + "\n");
      return msg.id;
    }

    rl.on("line", (line) => {
      if (!line.trim()) return;
      try {
        const response = JSON.parse(line);
        if (response.id && pending.has(response.id)) {
          const res = pending.get(response.id);
          pending.delete(response.id);
          res(response);
        }
      } catch (err) {
        // Ignore
      }
    });

    function callMethod(method, params) {
      return new Promise((res) => {
        const id = send(method, params);
        pending.set(id, res);
      });
    }

    async function runFlow() {
      await callMethod("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "custom-client", version: "1.0.0" }
      });
      send("notifications/initialized", {}, true);

      const callRes = await callMethod("tools/call", {
        name: "get-function",
        arguments: { slug }
      });

      mProcess.kill();
      resolve(callRes);
    }

    runFlow().catch((err) => {
      mProcess.kill();
      resolve({ error: err.message });
    });
  });
}

async function main() {
  console.log("Checking recruitment edge functions on the preview branch...");
  const results = {};
  for (const slug of slugs) {
    console.log(`Checking ${slug}...`);
    const res = await checkFunction(slug);
    if (res.result && !res.result.isError) {
      results[slug] = "Found (Active)";
    } else {
      results[slug] = "Not Found / Deleted";
    }
  }
  console.log("\nResults:");
  console.log(JSON.stringify(results, null, 2));
}

main().catch(console.error);
