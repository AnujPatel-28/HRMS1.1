import { readFileSync } from "node:fs";

const file = process.argv[2];

if (!file) {
  console.error("Usage: node scratch/apply_sql_direct.mjs <sql-file>");
  process.exit(1);
}

const project = JSON.parse(readFileSync(".insforge/project.json", "utf8"));
const query = readFileSync(file, "utf8");

const response = await fetch(`${project.oss_host}/api/database/advance/rawsql`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${project.api_key}`,
  },
  body: JSON.stringify({ query }),
});

const text = await response.text();
console.log(response.status);
console.log(text);

if (!response.ok) {
  process.exit(1);
}
