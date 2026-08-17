import fs from "fs";

const raw = fs.readFileSync("scratch/schema_dump.json", "utf-8");
const data = JSON.parse(raw);

const tables = {};
data.columns.forEach((row) => {
  if (!tables[row.table_name]) {
    tables[row.table_name] = {
      name: row.table_name,
      columns: [],
      fks: [],
      referencedBy: []
    };
  }
  tables[row.table_name].columns.push({
    name: row.column_name,
    type: row.data_type,
    nullable: row.is_nullable === "YES"
  });
});

data.fks.forEach((fk) => {
  if (tables[fk.table_name]) {
    tables[fk.table_name].fks.push(fk);
  }
  if (tables[fk.foreign_table_name]) {
    tables[fk.foreign_table_name].referencedBy.push(fk);
  }
});

// Identify useless / isolated tables
// A table is isolated if it has 0 FKs going out AND 0 references coming in.
// Note: Some system tables like rate_limits or test_log are isolated but expected.
const isolatedTables = [];
Object.keys(tables).forEach((tableName) => {
  const t = tables[tableName];
  if (t.fks.length === 0 && t.referencedBy.length === 0) {
    isolatedTables.push(tableName);
  }
});

// Build ER diagram (Mermaid)
let mermaid = "```mermaid\nerDiagram\n";
const relations = new Set();
data.fks.forEach((fk) => {
  // Avoid duplicate lines in mermaid
  const relStr = `    ${fk.table_name} }|--|| ${fk.foreign_table_name} : "${fk.column_name} -> ${fk.foreign_column_name}"`;
  relations.add(relStr);
});
relations.forEach((rel) => {
  mermaid += rel + "\n";
});
mermaid += "```\n";

// Write markdown content
let md = `# Live Database Schema and ER Diagram (updateSuggestion Branch)
This document is automatically generated from the active PostgreSQL database instance on the \`updateSuggestion\` preview backend (\`https://rq3qmu8y-jx7.ap-southeast.insforge.app\`).

---

## 📊 Entity Relationship Diagram

${mermaid}

---

## 🔍 Isolated/Useless Tables Analysis
These tables are completely isolated (they have no foreign key relationships pointing out to other tables, and no other tables reference them). 

*Note: Some metadata, log, settings, or system cache tables are expected to be isolated.*

| Table Name | Active Rows | Description / Potential Cleanup Target |
|------------|-------------|----------------------------------------|
${isolatedTables.map((t) => {
  let desc = "System setting / log / cache table. Keep.";
  if (t === "test_log" || t === "test_mcp_sync") desc = "**Useless test table. Can be deleted.**";
  if (t === "activity") desc = "Audit/activity log table. Keep.";
  if (t === "ai_suggestion_cache") desc = "AI response cache table. Keep.";
  return `| \`${t}\` | - | ${desc} |`;
}).join("\n")}

---

## 🗄️ Tables and Columns Documentation

`;

Object.keys(tables).sort().forEach((tableName) => {
  const t = tables[tableName];
  md += `### \`${tableName}\`
**Columns:**
| Column Name | Data Type | Nullable? | Foreign Key? |
|-------------|-----------|-----------|--------------|
`;
  t.columns.forEach((c) => {
    const fkMatch = t.fks.find((fk) => fk.column_name === c.name);
    const fkText = fkMatch ? `🔑 Links to [\`${fkMatch.foreign_table_name}.${fkMatch.foreign_column_name}\`](#${fkMatch.foreign_table_name.replace(/_/g, "")})` : "";
    md += `| \`${c.name}\` | \`${c.type}\` | ${c.nullable ? "✅ Yes" : "❌ No"} | ${fkText} |\n`;
  });
  md += "\n";
});

fs.writeFileSync("LIVE_DATABASE_SCHEMA_AND_ER.md", md);
console.log("Successfully generated LIVE_DATABASE_SCHEMA_AND_ER.md");
