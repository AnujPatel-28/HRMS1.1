import { spawn } from "child_process";
import readline from "readline";

const args = [
  "-y",
  "@insforge/mcp@latest",
  "--api_key",
  "ik_1a616463854d5d7b3fef4c4bf7516aee",
  "--api_base_url",
  "https://sytk3jgv.ap-southeast.insforge.app"
];

const toolName = process.argv[2] || "tools/list";
const toolArgsStr = process.argv[3] || "{}";
const toolArgs = JSON.parse(toolArgsStr);

console.log(`Executing MCP tool: ${toolName} with args:`, toolArgs);

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
  const msg = {
    jsonrpc: "2.0",
    method
  };
  if (params !== undefined) {
    msg.params = params;
  }
  if (!isNotification) {
    msg.id = msgId++;
  }
  const str = JSON.stringify(msg) + "\n";
  mcpProcess.stdin.write(str);
  return msg.id;
}

rl.on("line", (line) => {
  if (!line.trim()) return;
  try {
    const response = JSON.parse(line);
    // Ignore log messages or check responses
    if (response.id && pending.has(response.id)) {
      const resolve = pending.get(response.id);
      pending.delete(response.id);
      resolve(response);
    }
  } catch (err) {
    console.error("Failed to parse JSON response:", line, err);
  }
});

function callMethod(method, params) {
  return new Promise((resolve) => {
    const id = send(method, params);
    pending.set(id, resolve);
  });
}

async function run() {
  // 1. Initialize
  // console.log("Sending initialize...");
  const initRes = await callMethod("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "custom-client", version: "1.0.0" }
  });
  // console.log("Initialize Response:", JSON.stringify(initRes, null, 2));

  // 2. Initialized Notification
  // console.log("Sending initialized notification...");
  send("notifications/initialized", {}, true);

  // 3. Call actual tool
  if (toolName === "tools/list") {
    const listRes = await callMethod("tools/list", {});
    console.log("TOOLS LIST:");
    console.log(JSON.stringify(listRes, null, 2));
  } else {
    const callRes = await callMethod("tools/call", {
      name: toolName,
      arguments: toolArgs
    });
    console.log("TOOL RESULT:");
    if (callRes.result?.content) {
      callRes.result.content.forEach((item) => {
        if (item.type === "text") {
          console.log(item.text);
        } else {
          console.log(item);
        }
      });
    } else {
      console.log(JSON.stringify(callRes, null, 2));
    }
  }

  mcpProcess.kill();
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  mcpProcess.kill();
  process.exit(1);
});
