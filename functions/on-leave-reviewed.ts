// @ts-nocheck - Deno runtime file, not compiled by the Vite/Node TypeScript toolchain
import { createClient } from "npm:@insforge/sdk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const cur = new Date(start);
  const last = new Date(end);
  while (cur <= last) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

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
    const { leave_id } = body as { leave_id: string };

    if (!leave_id) {
      return new Response(JSON.stringify({ error: "leave_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: leave, error: leaveErr } = await client.database
      .from("leaves")
      .select("*")
      .eq("id", leave_id)
      .maybeSingle();

    if (leaveErr || !leave) {
      return new Response(JSON.stringify({ error: "Leave not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { employee_id, start_date, end_date, leave_type, status, rejection_reason, tenant_id } = leave;

    if (status === "approved") {
      const dates = dateRange(start_date, end_date);

      for (const date of dates) {
        await client.database.from("attendance").upsert(
          [
            {
              tenant_id,
              employee_id,
              date,
              status: "on_leave",
              punch_out_allowed: true,
            },
          ],
          { onConflict: "tenant_id,employee_id,date" },
        );

        await client.database.from("calendar_events").upsert(
          [
            {
              tenant_id,
              employee_id,
              date,
              type: "leave",
            },
          ],
          { onConflict: "tenant_id,employee_id,date" },
        );
      }

      await client.database.from("notifications").insert([
        {
          tenant_id,
          employee_id,
          title: "Leave Approved",
          body: `Your ${leave_type} leave from ${start_date} to ${end_date} has been approved.`,
          type: "leave_approved",
          reference_id: leave_id,
        },
      ]);
    } else if (status === "rejected") {
      await client.database.from("notifications").insert([
        {
          tenant_id,
          employee_id,
          title: "Leave Rejected",
          body: `Your leave request was rejected.${rejection_reason ? ` Reason: ${rejection_reason}` : ""}`,
          type: "leave_rejected",
          reference_id: leave_id,
        },
      ]);
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("on-leave-reviewed error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
