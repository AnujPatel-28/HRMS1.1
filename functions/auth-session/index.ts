import { createClient } from 'npm:@insforge/sdk';



function parseCookies(header: string | null) {
  if (!header) return {};
  return header.split(';').reduce((res, item) => {
    const parts = item.split('=');
    res[parts[0].trim()] = parts.slice(1).join('=');
    return res;
  }, {} as Record<string, string>);
}

export default async function handler(req: Request): Promise<Response> {
  const baseUrl = Deno.env.get('NEXT_PUBLIC_INSFORGE_URL') || Deno.env.get('INSFORGE_URL') || Deno.env.get('SUPABASE_URL') || req.headers.get('x-insforge-url')!;
  const anonKey = Deno.env.get('NEXT_PUBLIC_INSFORGE_ANON_KEY') || Deno.env.get('INSFORGE_ANON_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || req.headers.get('x-insforge-anon-key')!;
  const serviceKey = Deno.env.get('INSFORGE_SERVICE_KEY') || 
                     Deno.env.get('API_KEY') || 
                     Deno.env.get('INSFORGE_ADMIN_KEY') || 
                     Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || 
                     req.headers.get('x-insforge-service-key') || '';

  const origin = req.headers.get('Origin') || '*';
  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, x-insforge-url, x-insforge-anon-key, x-insforge-service-key',
    'Access-Control-Allow-Credentials': 'true',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      status: 204,
      headers: corsHeaders
    });
  }

  try {
    if (req.method === 'GET') {
      const cookies = parseCookies(req.headers.get('cookie'));
      const token = cookies['tm_access_token'] || req.headers.get('Authorization')?.split(' ')[1];

      if (!token) {
        return new Response(JSON.stringify({ error: 'Unauthorized, no token' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Decode JWT payload
      let payload;
      try {
        const payloadBase64 = token.split('.')[1];
        payload = JSON.parse(atob(payloadBase64.replace(/-/g, '+').replace(/_/g, '/')));
      } catch (e) {
        console.error('[auth-session] Invalid token format');
        return new Response(JSON.stringify({ error: 'Unauthorized, invalid token format' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const user = { id: payload.sub, email: payload.email };

      if (!user || !user.id || user.id === 'project-admin-with-api-key') {
        console.error('[auth-session] Invalid user or admin-key detected');
        return new Response(JSON.stringify({ error: 'Unauthorized, invalid token' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Verify the token signature by calling getCurrentUser()
      const userDb = createClient({ baseUrl, anonKey, edgeFunctionToken: token, isServerMode: true });
      const { data: authData, error: authError } = await userDb.auth.getCurrentUser();

      if (authError || !authData?.user) {
        console.error('[auth-session] Token verification failed:', authError?.message);
        return new Response(JSON.stringify({ error: 'Unauthorized, invalid token signature' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Use service key to fetch profile to bypass any RLS issues
      const adminDb = createClient({ baseUrl, anonKey: serviceKey, isServerMode: true });

      const { data: profile, error: profileError } = await adminDb.database
        .from('profiles')
        .select('id, email, role, name, avatar_url, company_id, created_at, mfa_enabled, completed_onboarding')
        .eq('id', user.id)
        .single();

      console.log("AUTH_SESSION_PROFILE", {
        userId: user.id,
        profileId: profile?.id,
        avatarUrl: profile?.avatar_url,
        email: profile?.email
      });

      console.log("AUTH_SESSION_PROFILE_QUERY_RESULT", profile);

      console.log("AUTH_SESSION_USER_ID_VERIFICATION", {
        authUserId: user.id,
        profileId: profile?.id,
        isEqual: user.id === profile?.id
      });

      if (profileError) {
        console.error('[auth-session] Error fetching profile:', profileError.message);
      }

      // Resolve display name: DB profile > OAuth metadata > email prefix
      const oauthName = (payload.user_metadata?.full_name || payload.user_metadata?.name || '') as string;
      const displayName = profile?.name && profile.name !== user.email?.split('@')[0]
        ? profile.name
        : oauthName.trim() || profile?.name || user.email?.split('@')[0] || 'User';

      const finalUser = {
        id: user.id,
        email: user.email,
        name: displayName,
        role: profile?.role || 'candidate',
        avatar_url: profile?.avatar_url || null,
        company_id: profile?.company_id,
        created_at: profile?.created_at,
        mfa_enabled: profile?.mfa_enabled || false,
        onboarding_completed: profile?.completed_onboarding === true,
        onboarding_step: 0,
      };

      const requiresMfa = (finalUser.role === 'admin' || finalUser.role === 'super_admin') ? finalUser.mfa_enabled : false;

      return new Response(JSON.stringify({ user: finalUser, requiresMfa }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (req.method === 'POST') {
      const body = await req.json();
      const { token, role, adminAccess } = body;

      if (!token || !role) {
        return new Response(JSON.stringify({ error: 'Missing required token or role' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const cookieOptions = `Path=/; HttpOnly; SameSite=None; Secure`;

      const headers = new Headers();
      headers.append('Set-Cookie', `tm_access_token=${token}; ${cookieOptions}`);
      headers.append('Set-Cookie', `tm_role=${role}; ${cookieOptions}`);
      if (adminAccess) {
        headers.append('Set-Cookie', `tm_admin_access=true; ${cookieOptions}`);
      }
      headers.append('Content-Type', 'application/json');
      Object.entries(corsHeaders).forEach(([k, v]) => headers.set(k, v));

      return new Response(JSON.stringify({ success: true }), { status: 200, headers });
    }

    if (req.method === 'DELETE') {
      const cookies = parseCookies(req.headers.get('cookie'));
      const token = cookies['tm_access_token'];

      if (token) {
        try {
          const insforge = createClient({ baseUrl, anonKey, edgeFunctionToken: token, isServerMode: true });
          await insforge.auth.signOut();
        } catch {
          // ignore
        }
      }

      const clearOptions = `Path=/; HttpOnly; SameSite=None; Secure; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
      const headers = new Headers();
      headers.append('Set-Cookie', `tm_access_token=; ${clearOptions}`);
      headers.append('Set-Cookie', `tm_role=; ${clearOptions}`);
      headers.append('Set-Cookie', `tm_admin_access=; ${clearOptions}`);
      headers.append('Set-Cookie', `mfa_verified=; ${clearOptions}`);
      headers.append('Content-Type', 'application/json');
      Object.entries(corsHeaders).forEach(([k, v]) => headers.set(k, v));

      return new Response(JSON.stringify({ success: true }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'Internal Server Error', details: err.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
}

