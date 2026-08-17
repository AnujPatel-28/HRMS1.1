import fs from "fs";
import pkg from "pg";
const { Client } = pkg;

const connectionString = "postgresql://postgres:f24232f87c1cf2717e4d5c002417a092@rq3qmu8y-jx7.ap-southeast.database.insforge.app:5432/insforge?sslmode=require";

const tables = [
  "employees",
  "employee_reporting_relationships",
  "exit_requests",
  "exit_clearances",
  "exit_clearance_templates",
  "audit_logs",
  "org_units",
  "job_titles",
  "office_locations",
  "employment_types"
];

const functions = [
  "create_employee_transaction",
  "update_employee_reporting_relationship",
  "update_exit_clearance_transaction",
  "complete_exit_transaction",
  "update_exit_interview_transaction"
];

async function main() {
  console.log("====================================================");
  console.log("          RUNNING PRE-PROD BACKUP & EXPORT          ");
  console.log("====================================================\n");

  const db = new Client({ connectionString });
  await db.connect();

  const backupData = {
    timestamp: new Date().toISOString(),
    policies: [],
    functions: {},
    tableData: {}
  };

  try {
    // 1. Export current RLS policies
    console.log("Exporting RLS policies from pg_policies...");
    const policiesRes = await db.query(`
      SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check 
      FROM pg_policies 
      WHERE schemaname = 'public' 
        AND tablename IN (${tables.map((_, i) => `$${i + 1}`).join(", ")});
    `, tables);
    backupData.policies = policiesRes.rows;
    console.log(`✅ Exported ${policiesRes.rows.length} policies.`);

    // 2. Export functions DDL
    console.log("\nExporting functions DDL...");
    for (const funcName of functions) {
      try {
        const funcRes = await db.query(`
          SELECT pg_get_functiondef(p.oid) AS definition
          FROM pg_proc p
          JOIN pg_namespace n ON p.pronamespace = n.oid
          WHERE n.nspname = 'public' AND p.proname = $1;
        `, [funcName]);

        if (funcRes.rows.length > 0) {
          backupData.functions[funcName] = funcRes.rows.map(r => r.definition).join("\n\n");
          console.log(`✅ Exported definition for function: ${funcName}`);
        } else {
          console.warn(`⚠️ Function ${funcName} not found.`);
        }
      } catch (err) {
        console.error(`❌ Failed to export function ${funcName}:`, err.message);
      }
    }

    // 3. Export table data
    console.log("\nExporting table data...");
    for (const table of tables) {
      try {
        const dataRes = await db.query(`SELECT * FROM public.${table};`);
        backupData.tableData[table] = dataRes.rows;
        console.log(`✅ Exported ${dataRes.rows.length} rows from table: ${table}`);
      } catch (err) {
        console.error(`❌ Failed to export table ${table}:`, err.message);
      }
    }

    // Write to file
    const backupFile = "scratch/preprod_backup_export.json";
    fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2));
    console.log(`\n🎉 Backup successfully written to ${backupFile}`);

  } finally {
    await db.end();
  }
}

main().catch(err => {
  console.error("Backup failed:", err);
  process.exit(1);
});
