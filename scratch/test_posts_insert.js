import { createClient } from "@insforge/sdk";

const baseUrl = "https://rq3qmu8y-jx7.ap-southeast.insforge.app";
const anonKey = "ik_48f0f767d6c40717ba3112c9dca15a3b";
const defaultTenantId = "97da3641-d69e-4e7a-bdc9-760675be8d28"; // Anuj Patel's tenant ID from employee data

const db = createClient({ baseUrl, anonKey });

async function main() {
  console.log("Testing insert into posts...");
  const newPost = {
    tenant_id: defaultTenantId,
    author_id: "24ef7b09-f9c4-4a66-88e4-7e0f046ad62d", // Anuj Patel's employee ID
    content: "This is a test post to verify RLS and schema.",
    type: "general",
    is_pinned: false
  };

  const { data: insData, error: insErr } = await db.database
    .from("posts")
    .insert([newPost])
    .select();

  if (insErr) {
    console.error("Insert failed:", insErr);
    return;
  }

  console.log("Insert success! Inserted row:", insData?.[0]);
  const insertedId = insData?.[0]?.id;

  console.log("\nTesting select posts...");
  const { data: selData, error: selErr } = await db.database
    .from("posts")
    .select("*")
    .eq("id", insertedId);

  if (selErr) {
    console.error("Select failed:", selErr);
  } else {
    console.log("Select success! Selected count:", selData?.length, selData?.[0]);
  }

  console.log("\nTesting reaction insert...");
  const newReaction = {
    tenant_id: defaultTenantId,
    post_id: insertedId,
    employee_id: "24ef7b09-f9c4-4a66-88e4-7e0f046ad62d",
    reaction: "like"
  };
  const { data: reactData, error: reactErr } = await db.database
    .from("post_reactions")
    .insert([newReaction])
    .select();

  if (reactErr) {
    console.error("Reaction insert failed:", reactErr);
  } else {
    console.log("Reaction insert success:", reactData?.[0]);
  }

  console.log("\nCleaning up (deleting test reaction)...");
  const { error: delReactErr } = await db.database
    .from("post_reactions")
    .delete()
    .eq("post_id", insertedId);
  if (delReactErr) console.error("Clean up reaction failed:", delReactErr);

  console.log("\nCleaning up (deleting test post)...");
  const { error: delErr } = await db.database
    .from("posts")
    .delete()
    .eq("id", insertedId);
  if (delErr) {
    console.error("Clean up post failed:", delErr);
  } else {
    console.log("Clean up success!");
  }
}

main().catch(console.error);
