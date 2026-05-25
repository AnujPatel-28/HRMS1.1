// @ts-nocheck - Deno runtime file, not compiled by the Vite TypeScript toolchain
import { createClient } from "npm:@insforge/sdk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function monthRange(year: number, month: number) {
  const startDate = `${year}-${pad(month)}-01`;
  const endDate = `${year}-${pad(month)}-${pad(new Date(year, month, 0).getDate())}`;
  return { startDate, endDate };
}

export default async function(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  const userToken = authHeader ? authHeader.replace("Bearer ", "") : null;

  const client = createClient({
    baseUrl: Deno.env.get("INSFORGE_BASE_URL") as string,
    edgeFunctionToken: userToken,
  });

  try {
    const body = await req.json();
    const { tenant_id, employee_id, month, year } = body as {
      tenant_id: string;
      employee_id: string;
      month: number;
      year: number;
    };

    if (!tenant_id || !employee_id || !month || !year) {
      return new Response(JSON.stringify({ error: "tenant_id, employee_id, month, and year are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { startDate, endDate } = monthRange(year, month);

    const { data: attendanceRows, error: attendanceError } = await client.database
      .from("attendance")
      .select("id")
      .eq("tenant_id", tenant_id)
      .eq("employee_id", employee_id)
      .eq("is_late", true)
      .neq("status", "absent")
      .neq("status", "half_day")
      .gte("date", startDate)
      .lte("date", endDate);

    if (attendanceError) throw attendanceError;

    const { data: settingsRows, error: settingsError } = await client.database
      .from("tenant_settings")
      .select("key,value")
      .eq("tenant_id", tenant_id)
      .in("key", ["late_mark_threshold", "late_mark_deduction_hours"]);

    if (settingsError) throw settingsError;

    const settings = (settingsRows ?? []).reduce((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {} as Record<string, string>);

    const late_count = (attendanceRows ?? []).length;
    const threshold = parseInt(settings["late_mark_threshold"] || "3", 10);
    const late_mark_deduction_hours = parseFloat(settings["late_mark_deduction_hours"] || "0.5");
    const excess_late_marks = Math.max(0, late_count - threshold);
    const deduction_hours = excess_late_marks * late_mark_deduction_hours;

    return new Response(JSON.stringify({
      late_count,
      threshold,
      excess_late_marks,
      deduction_hours,
      has_deduction: deduction_hours > 0,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("calculate-late-marks error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
