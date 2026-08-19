import { spawn } from "child_process";
import readline from "readline";
import fs from "fs";

const queryColumns = `
  SELECT 
      t.table_name,
      c.column_name,
      c.data_type,
      c.is_nullable
  FROM information_schema.tables t
  JOIN information_schema.columns c 
      ON t.table_name = c.table_name 
      AND t.table_schema = c.table_schema
  WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
  ORDER BY t.table_name, c.ordinal_position;
`;

const queryFks = `
  SELECT
      tc.table_name, 
      kcu.column_name, 
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name 
  FROM 
      information_schema.table_constraints AS tc 
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
  WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema='public';
`;

const args = [
  "-y",
  "@insforge/mcp@latest",
  "--api_key",
  "ik_48f0f767d6c40717ba3112c9dca15a3b",
  "--api_base_url",
  "https://rq3qmu8y-jx7.ap-southeast.insforge.app"
];

async function runSql(query) {
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

      const callRes = await callMethod("tools/call", {
        name: "run-raw-sql",
        arguments: { query }
      });

      mProcess.kill();
      resolve(callRes.result?.content?.[0]?.text || JSON.stringify(callRes, null, 2));
    }

    runFlow().catch((err) => {
      mProcess.kill();
      reject(err);
    });
  });
}

function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("Could not find JSON object in: " + text);
  }
  return text.substring(start, end + 1);
}

async function main() {
  console.log("Fetching columns...");
  const colsRaw = await runSql(queryColumns);
  console.log("Fetching FKs...");
  const fksRaw = await runSql(queryFks);

  const colsObj = JSON.parse(extractJson(colsRaw));
  const fksObj = JSON.parse(extractJson(fksRaw));

  const result = {
    columns: colsObj.rows || [],
    fks: fksObj.rows || []
  };

  fs.writeFileSync("scratch/schema_dump.json", JSON.stringify(result, null, 2));
  console.log("Schema dumped successfully to scratch/schema_dump.json");
}

main().catch(console.error);
