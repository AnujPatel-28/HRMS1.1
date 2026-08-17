import { spawn } from "child_process";
import readline from "readline";

const args = [
  "-y",
  "@insforge/mcp@latest",
  "--api_key",
  "ik_48f0f767d6c40717ba3112c9dca15a3b",
  "--api_base_url",
  "https://rq3qmu8y-jx7.ap-southeast.insforge.app"
];

async function runDeploy() {
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

      console.log("Calling update-function on preview branch...");
      const callRes = await callMethod("tools/call", {
        name: "update-function",
        arguments: {
          slug: "create-employee-user",
          codeFile: "c:\\Users\\Anuj\\Desktop\\hrms\\HRMS-Talentmesh-Solutions\\functions\\create-employee-user.ts"
        }
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
  const result = await runDeploy();
  console.log("Deployment Result:");
  console.log(result);
}

main().catch(console.error);
