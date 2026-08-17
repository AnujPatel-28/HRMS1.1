import pkg from "pg";
import fs from "fs";

const { Client } = pkg;

const connectionString = "postgresql://postgres:f24232f87c1cf2717e4d5c002417a092@rq3qmu8y-jx7.ap-southeast.database.insforge.app:5432/insforge?sslmode=require";

async function main() {
  console.log("Connecting to branched database...");
  const client = new Client({ connectionString });
  await client.connect();
  
  try {
    console.log("Reading seed-qa.sql file...");
    const sql = fs.readFileSync("scratch/seed-qa.sql", "utf-8");
    
    console.log("Running seeding SQL script...");
    await client.query(sql);
    
    console.log("✓ Seeding completed successfully on the branched database!");
  } catch (err) {
    console.error("✗ Seeding failed:", err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
