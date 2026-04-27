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
    const { task_id } = body as { task_id: string };

    if (!task_id) {
      return new Response(JSON.stringify({ error: 'task_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1. Get the task row
    const { data: task, error: taskErr } = await client.database
      .from('tasks')
      .select('*')
      .eq('id', task_id)
      .maybeSingle();

    if (taskErr || !task) {
      return new Response(JSON.stringify({ error: 'Task not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { title, assigned_to, due_date } = task;

    // 2. Notify the assigned employee
    await client.database.from('notifications').insert([{
      employee_id: assigned_to,
      title: 'New Task Assigned 📋',
      body: `You have a new task: "${title}".${due_date ? ` Due: ${due_date}.` : ''}`,
      type: 'task_assigned',
      reference_id: task_id,
    }]);

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('on-task-assigned error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
