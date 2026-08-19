import { spawn } from "child_process";
import readline from "readline";
import fs from "fs";
import path from "path";

const docTypes = [
  "instructions",
  "auth-sdk",
  "db-sdk",
  "storage-sdk",
  "functions-sdk",
  "ai-integration-sdk",
  "real-time",
  "deployment"
];

const args = [
  "-y",
  "@insforge/mcp@latest",
  "--api_key",
  "ik_1a616463854d5d7b3fef4c4bf7516aee",
  "--api_base_url",
  "https://sytk3jgv.ap-southeast.insforge.app"
];

async function fetchDoc(docType) {
  return new Promise((resolve, reject) => {
    const mcpProcess = spawn("npx", args, {
      stdio: ["pipe", "pipe", "inherit"],
      shell: true
    });

    const rl = readline.createInterface({
      input: mcpProcess.stdout,
      terminal: false
    });

    let msgId = 1;
    const pending = new Map();

    function send(method, params, isNotification = false) {
      const msg = { jsonrpc: "2.0", method };
      if (params !== undefined) msg.params = params;
      if (!isNotification) msg.id = msgId++;
      mcpProcess.stdin.write(JSON.stringify(msg) + "\n");
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
        // Ignored
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
        name: "fetch-docs",
        arguments: { docType }
      });

      let text = "";
      if (callRes.result?.content) {
        callRes.result.content.forEach((item) => {
          if (item.type === "text") {
            text += item.text + "\n";
          }
        });
      } else {
        text = JSON.stringify(callRes, null, 2);
      }

      mcpProcess.kill();
      resolve(text);
    }

    runFlow().catch((err) => {
      mcpProcess.kill();
      reject(err);
    });
  });
}

async function main() {
  for (const docType of docTypes) {
    try {
      console.log(`Fetching doc: ${docType}...`);
      const content = await fetchDoc(docType);
      const filePath = path.join("scratch", `insforge_${docType}.md`);
      fs.writeFileSync(filePath, content, "utf8");
      console.log(`Saved to ${filePath}`);
    } catch (err) {
      console.error(`Error fetching ${docType}:`, err);
    }
  }
  console.log("All docs fetched successfully!");
}

main().catch(console.error);
