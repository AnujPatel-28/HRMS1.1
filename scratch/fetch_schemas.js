import { spawn } from "child_process";
import readline from "readline";
import fs from "fs";
import path from "path";

const tables = ["posts", "post_reactions", "employees"];

const args = [
  "-y",
  "@insforge/mcp@latest",
  "--api_key",
  "ik_48f0f767d6c40717ba3112c9dca15a3b",
  "--api_base_url",
  "https://rq3qmu8y-jx7.ap-southeast.insforge.app"
];

async function fetchSchema(tableName) {
  return new Promise((resolve, reject) => {
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

      // Call get-table-schema
      const callRes = await callMethod("tools/call", {
        name: "get-table-schema",
        arguments: { tableName }
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

      mProcess.kill();
      resolve(text);
    }

    runFlow().catch((err) => {
      mProcess.kill();
      reject(err);
    });
  });
}

async function main() {
  for (const table of tables) {
    try {
      console.log(`Fetching schema for table: ${table}...`);
      const schema = await fetchSchema(table);
      const filePath = path.join("scratch", `schema_${table}.json`);
      fs.writeFileSync(filePath, schema, "utf8");
      console.log(`Saved to ${filePath}`);
    } catch (err) {
      console.error(`Error fetching schema for ${table}:`, err);
    }
  }
  console.log("All schemas fetched successfully!");
}

main().catch(console.error);
