// @ts-nocheck - Deno runtime file, not compiled by the Vite/Node TypeScript toolchain
import { createClient } from "npm:@insforge/sdk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  const userToken = authHeader ? authHeader.replace("Bearer ", "") : null;

  const client = createClient({
    baseUrl: Deno.env.get("INSFORGE_BASE_URL") as string,
    edgeFunctionToken: userToken,
  });

  try {
    const body = await req.json();
    const { submission_id } = body as { submission_id: string };

    if (!submission_id) {
      return new Response(JSON.stringify({ error: "submission_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: sub, error: subErr } = await client.database
      .from("task_submissions")
      .select("*")
      .eq("id", submission_id)
      .maybeSingle();

    if (subErr || !sub) {
      return new Response(JSON.stringify({ error: "Submission not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { employee_id, task_id, review_notes, tenant_id } = sub;

    await client.database
      .from("tasks")
      .update({ status: "assigned" })
      .eq("tenant_id", tenant_id)
      .eq("id", task_id);

    await client.database.from("notifications").insert([
      {
        tenant_id,
        employee_id,
        title: "Task Needs Revision",
        body: `HR has reviewed your task. ${review_notes ? `Reason: ${review_notes}. ` : ""}Please resubmit.`,
        type: "task_rejected",
        reference_id: task_id,
      },
    ]);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("on-task-rejected error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
