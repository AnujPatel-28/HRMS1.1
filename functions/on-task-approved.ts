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
    const { submission_id } = body as { submission_id: string };

    if (!submission_id) {
      return new Response(JSON.stringify({ error: 'submission_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1. Get the submission row
    const { data: sub, error: subErr } = await client.database
      .from('task_submissions')
      .select('*')
      .eq('id', submission_id)
      .maybeSingle();

    if (subErr || !sub) {
      return new Response(JSON.stringify({ error: 'Submission not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    const { employee_id, task_id } = sub;

    // 2. Unlock punch-out in attendance
    await client.database
      .from('attendance')
      .update({ punch_out_allowed: true })
      .eq('employee_id', employee_id)
      .eq('date', today);

    // 3. Upsert calendar event as green (task approved)
    await client.database.from('calendar_events').upsert([{
      employee_id,
      date: today,
      type: 'green',
      task_id,
    }], { onConflict: 'employee_id,date' });

    // 4. Create notification for employee
    await client.database.from('notifications').insert([{
      employee_id,
      title: 'Task Approved! ✅',
      body: 'Your task has been approved. You can now punch out.',
      type: 'punch_unlock',
      reference_id: task_id,
    }]);

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('on-task-approved error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
