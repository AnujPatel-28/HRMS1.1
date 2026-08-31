// Runner for doc/verification/*.sql batteries.
//
// Why this exists rather than the two runners next to it:
//   apply_sql_file.mjs  passes each statement as a command-line ARGUMENT and collapses all
//                       whitespace first. Both break here -- Windows caps a command line at
//                       ~8k characters, and collapsing newlines without stripping `--`
//                       comments folds a whole dollar-quoted block into one comment line.
//   apply_sql_direct.mjs posts the whole file in one request, and the raw-SQL endpoint
//                       returns rows only for a SINGLE-statement body; anything longer comes
//                       back as {"rows":[]} whatever it actually selected.
//
// So: split on dollar-quote-aware statement boundaries, post each statement VERBATIM in its
// own request, and print what each one returned. Each statement is therefore its own
// transaction -- a battery that needs to roll its own writes back must do so inside a single
// DO block, which is how the ones in doc/verification are written.
//
// A statement that raises SQLSTATE ZZ002 is a REPORT, not a failure: it is how a DO block
// that must roll back its writes still gets its findings out (a DO block cannot return rows).

import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scratch/qa-battery-run.mjs <sql-file>");
  process.exit(1);
}

const project = JSON.parse(readFileSync(".insforge/project.json", "utf8"));
const source = readFileSync(file, "utf8");

function splitStatements(src) {
  const out = [];
  let cur = "";
  let single = false;
  let dollar = null;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];

    // Line comments only outside quoting. Kept in the text, not stripped -- newlines are
    // preserved, so a comment cannot swallow the code that follows it.
    if (!single && !dollar && ch === "-" && src[i + 1] === "-") {
      while (i < src.length && src[i] !== "\n") { cur += src[i]; i += 1; }
      cur += "\n";
      continue;
    }

    if (!single && ch === "$") {
      const m = src.slice(i).match(/^\$[A-Za-z0-9_]*\$/);
      if (m) {
        cur += m[0];
        i += m[0].length - 1;
        dollar = dollar === m[0] ? null : (dollar ?? m[0]);
        continue;
      }
    }

    if (!dollar && ch === "'") single = !single;

    if (!single && !dollar && ch === ";") {
      const s = cur.trim();
      if (s) out.push(s);
      cur = "";
      continue;
    }
    cur += ch;
  }
  const tail = cur.trim();
  if (tail) out.push(tail);
  return out;
}

const statements = splitStatements(source);
console.log(`${file}: ${statements.length} statements\n`);

let failed = 0;

for (let i = 0; i < statements.length; i += 1) {
  const stmt = statements[i];
  const label = (stmt.match(/\$([a-z_0-9]+)\$/i)?.[1]) ?? stmt.slice(0, 48).replace(/\s+/g, " ");

  const res = await fetch(`${project.oss_host}/api/database/advance/rawsql`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${project.api_key}` },
    body: JSON.stringify({ query: stmt }),
  });
  const body = await res.json().catch(() => ({}));

  if (res.ok) {
    const rows = body.rows ?? [];
    console.log(`[${i + 1}/${statements.length}] OK    ${label}${rows.length ? "" : "  (no rows)"}`);
    for (const row of rows) console.log("      ", JSON.stringify(row));
    continue;
  }

  const msg = body.message ?? JSON.stringify(body);
  // ZZ002 is the report channel, not a failure. The message carries `||`-separated findings.
  if (/ZZ002/.test(msg) || /^REPORT\b/.test(msg) || msg.includes("REPORT ::")) {
    console.log(`[${i + 1}/${statements.length}] REPORT ${label}`);
    for (const line of msg.replace(/^.*?REPORT ::\s*/s, "").split(" || ")) {
      console.log("       -", line.trim());
    }
    continue;
  }

  failed += 1;
  console.error(`[${i + 1}/${statements.length}] FAIL  ${label}`);
  console.error("       ", msg);
}

console.log(failed === 0 ? "\nAll statements passed." : `\n${failed} statement(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
