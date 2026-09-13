import { createClient } from 'npm:@insforge/sdk';

const baseUrl = Deno.env.get('INSFORGE_URL') || Deno.env.get('NEXT_PUBLIC_INSFORGE_URL')!;
const anonKey = Deno.env.get('INSFORGE_ANON_KEY') || Deno.env.get('NEXT_PUBLIC_INSFORGE_ANON_KEY')!;

export default async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get('Origin') || 'http://localhost:3000';
  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info',
    'Access-Control-Allow-Credentials': 'true',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { 
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    const { email, password, role, name } = await req.json();

    if (!email || !password || !role || !name) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Prevent privilege escalation: Only allow 'candidate' or 'recruiter' roles during public signup
    let safeRole = role;
    if (safeRole === 'admin' || safeRole === 'super_admin') {
      safeRole = 'candidate';
    }

    // Recruiter portal is not yet open — block self-signup
    if (safeRole === 'recruiter') {
      return new Response(JSON.stringify({ 
        error: 'Recruiter registration is currently by invite only. Please check back soon or contact us at info@talentmeshsolutions.com.' 
      }), { 
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const serviceKey = Deno.env.get('INSFORGE_SERVICE_KEY') || 
                       Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || 
                       Deno.env.get('SERVICE_ROLE_KEY') || 
                       Deno.env.get('INSFORGE_ADMIN_KEY') || 
                       Deno.env.get('API_KEY') || '';

    const insforge = createClient({ baseUrl, anonKey });
    const insforgeAdmin = createClient({ baseUrl, anonKey: serviceKey || anonKey });

    // 1. Sign up the user
    const { data, error: signupError } = await insforge.auth.signUp({
      email,
      password,
      name,
    });

    if (signupError) {
      return new Response(JSON.stringify({ error: signupError.message }), { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const user = data?.user || (data as any)?.session?.user;
    const accessToken = data?.accessToken || (data as any)?.session?.access_token;

    if (user) {
      // 2. Create the profile record
      const { error: profileError } = await insforgeAdmin.database
        .from('profiles')
        .insert([{
          id: user.id,
          user_id: user.id,
          email: user.email,
          role: safeRole,
          name,
        }]);
      if (profileError) {
        return new Response(JSON.stringify({ error: profileError.message }), { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // 3. Send welcome email (fire-and-forget — don't block signup)
      const siteUrl = Deno.env.get('NEXT_PUBLIC_SITE_URL') || 'http://localhost:3000';
      const template = safeRole === 'recruiter' ? 'recruiter-welcome' : 'candidate-welcome';
      try {
        fetch(`${siteUrl}/api/email/send`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-service-key': serviceKey,
          },
          body: JSON.stringify({
            to: user.email,
            template,
            data: { name, email: user.email },
          }),
        }).catch((e: any) => console.error('[auth-signup] Welcome email fire-and-forget failed:', e.message));
      } catch (emailErr: any) {
        console.error('[auth-signup] Welcome email error:', emailErr.message);
      }
    }

    return new Response(JSON.stringify({ 
      requireEmailVerification: data?.requireEmailVerification,
      user,
      accessToken
    }), { 
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('Signup API Error:', err);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), { 
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}
