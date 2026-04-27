// @ts-nocheck — Deno runtime file, not compiled by the Vite/Node TypeScript toolchain
import { createClient } from 'npm:@insforge/sdk';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default async function(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

  // This function runs on a schedule (cron) or can be triggered manually.
  // The InsForge platform calls it daily at 11:30 PM.
  const client = createClient({
    baseUrl: Deno.env.get('INSFORGE_BASE_URL') as string,
    anonKey: Deno.env.get('ANON_KEY') as string,
  });

  try {
    const today = new Date().toISOString().slice(0, 10);

    // 1. Get all tasks due today that are NOT approved
    const { data: tasks } = await client.database
      .from('tasks')
      .select('id, assigned_to, status')
      .eq('due_date', today)
      .not('status', 'eq', 'approved');

    if (!tasks || tasks.length === 0) {
      return new Response(JSON.stringify({ success: true, processed: 0 }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let processed = 0;

    for (const task of tasks) {
      const empId = task.assigned_to;
      if (!empId) continue;

      // 2. Check if the employee punched in today (i.e., they worked)
      const { data: att } = await client.database
        .from('attendance')
        .select('id, punch_out_allowed')
        .eq('employee_id', empId)
        .eq('date', today)
        .not('punch_in', 'is', null)
        .maybeSingle();

      if (!att) continue; // Employee didn't work today, skip

      // 3. Mark calendar event as red (task incomplete)
      await client.database.from('calendar_events').upsert([{
        employee_id: empId,
        date: today,
        type: 'red',
        task_id: task.id,
      }], { onConflict: 'employee_id,date' });

      // Punch-out lock stays as-is — if punch_out_allowed is false, it remains false
      // (employee MUST wait for HR to approve the task even after EOD)

      processed++;
    }

    return new Response(JSON.stringify({ success: true, processed }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('daily-incomplete-task-marker error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
