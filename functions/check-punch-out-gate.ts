// @ts-nocheck — Deno runtime file, not compiled by the Vite/Node TypeScript toolchain
import { createClient } from 'npm:@insforge/sdk';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default async function(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  const userToken = authHeader ? authHeader.replace('Bearer ', '') : null;

  const client = createClient({
    baseUrl: Deno.env.get('INSFORGE_BASE_URL') as string,
    edgeFunctionToken: userToken,
  });

  try {
    const body = await req.json();
    const { employee_id, date } = body as { employee_id: string; date: string };

    if (!employee_id || !date) {
      return new Response(JSON.stringify({ error: 'employee_id and date are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1. Check for any tasks today that are NOT approved
    const { data: pendingTasks } = await client.database
      .from('tasks')
      .select('id, title, status')
      .eq('assigned_to', employee_id)
      .eq('due_date', date)
      .not('status', 'eq', 'approved');

    const hasPendingTask = pendingTasks && pendingTasks.length > 0;

    // 2. Also check the DB-level punch_out_allowed flag
    const { data: att } = await client.database
      .from('attendance')
      .select('punch_out_allowed')
      .eq('employee_id', employee_id)
      .eq('date', date)
      .maybeSingle();

    // Both conditions must be satisfied: no pending tasks AND DB says allowed
    const dbAllowed = att ? att.punch_out_allowed : true;
    const punch_out_allowed = !hasPendingTask && dbAllowed;

    return new Response(JSON.stringify({
      punch_out_allowed,
      reason: !punch_out_allowed
        ? hasPendingTask
          ? 'Pending task approval — HR must approve your task before you can punch out.'
          : 'Punch-out is locked by HR.'
        : null,
      pending_tasks: pendingTasks ?? [],
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('check-punch-out-gate error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
