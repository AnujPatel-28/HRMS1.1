import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const file = process.argv[2];

if (!file) {
  console.error("Usage: node scratch/apply_sql_file.mjs <sql-file>");
  process.exit(1);
}

const sql = readFileSync(file, "utf8");

function splitSqlStatements(source) {
  const statements = [];
  let current = "";
  let singleQuoted = false;
  let doubleQuoted = false;
  let dollarTag = null;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (!singleQuoted && !doubleQuoted && !dollarTag && char === "-" && next === "-") {
      while (i < source.length && source[i] !== "\n") i += 1;
      current += "\n";
      continue;
    }

    if (!singleQuoted && !doubleQuoted && char === "$") {
      const match = source.slice(i).match(/^\$[A-Za-z0-9_]*\$/);
      if (match) {
        const tag = match[0];
        current += tag;
        i += tag.length - 1;
        dollarTag = dollarTag === tag ? null : tag;
        continue;
      }
    }

    if (!dollarTag && !doubleQuoted && char === "'" && source[i - 1] !== "\\") {
      singleQuoted = !singleQuoted;
    } else if (!dollarTag && !singleQuoted && char === '"') {
      doubleQuoted = !doubleQuoted;
    }

    if (!singleQuoted && !doubleQuoted && !dollarTag && char === ";") {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = "";
      continue;
    }

    current += char;
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

const statements = splitSqlStatements(sql);
console.log(`Applying ${statements.length} SQL statements from ${file}`);

for (let index = 0; index < statements.length; index += 1) {
  const statement = statements[index].replace(/\s+/g, " ").trim();
  const npxCli = "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js";
  const command = process.platform === "win32" && existsSync(npxCli) ? "node" : "npx";
  const args = command === "node"
    ? [npxCli, "@insforge/cli", "db", "query", statement, "--json"]
    : ["@insforge/cli", "db", "query", statement, "--json"];
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    console.error(`Statement ${index + 1} failed:`);
    console.error(statement);
    if (result.error) console.error(result.error);
    console.error(result.stdout);
    console.error(result.stderr);
    process.exit(result.status ?? 1);
  }

  console.log(`Applied ${index + 1}/${statements.length}`);
}
