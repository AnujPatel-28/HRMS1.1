import { createClient } from 'npm:@insforge/sdk';
import { z } from 'npm:zod';

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

function normalizeRole(role: string | undefined | null, email: string): string {
  if (role) return role;
  if (email.endsWith('@talentmesh.com') || email === 'admin@talentmesh.com') {
    return 'super_admin';
  }
  return 'candidate';
}

const baseUrl = Deno.env.get('NEXT_PUBLIC_INSFORGE_URL') || Deno.env.get('INSFORGE_URL')!;
const anonKey = Deno.env.get('NEXT_PUBLIC_INSFORGE_ANON_KEY') || Deno.env.get('INSFORGE_ANON_KEY')!;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const validation = loginSchema.safeParse(payload);
  if (!validation.success) {
    const errors = validation.error.flatten().fieldErrors;
    return new Response(
      JSON.stringify({ error: errors.email?.[0] || errors.password?.[0] || 'Invalid login details.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const { email, password } = validation.data;
  const insforge = createClient({ baseUrl, anonKey });
  const { data, error } = await insforge.auth.signInWithPassword({ email, password });

  if (error || !data?.accessToken || !data.user?.id || !data.user.email) {
    if (error?.message?.includes('Email not confirmed') || error?.message?.includes('email_not_confirmed')) {
      return new Response(
        JSON.stringify({ error: 'Please verify your email address before logging in.', requiresVerification: true }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const message = error?.message?.includes('Invalid login credentials')
      ? 'Invalid email or password. Please try again.'
      : error?.message || 'Unable to sign in.';

    return new Response(JSON.stringify({ error: message }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const serviceKey = Deno.env.get('INSFORGE_SERVICE_KEY')!;
  const adminDb = createClient({
    baseUrl,
    anonKey: serviceKey,
    isServerMode: true
  });

  const { data: profile } = await adminDb.database
    .from('profiles')
    .select('role, mfa_enabled, is_active')
    .eq('id', data.user.id)
    .single();

  const role = normalizeRole(profile?.role, data.user.email);
  const isAdmin = role === 'admin' || role === 'super_admin';

  if (!isAdmin) {
    return new Response(
      JSON.stringify({ error: 'Access denied. You do not have administrator privileges.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (profile?.is_active === false) {
    return new Response(
      JSON.stringify({ error: 'This administrator account is suspended. Contact support.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const isSecure = Deno.env.get('NODE_ENV') === 'production';
  const cookieOptions = `Path=/; HttpOnly; SameSite=Lax${isSecure ? '; Secure' : ''}`;

  const headers = new Headers();
  headers.append('Set-Cookie', `tm_access_token=${data.accessToken}; ${cookieOptions}`);
  headers.append('Set-Cookie', `tm_role=${role}; ${cookieOptions}`);
  headers.append('Set-Cookie', `tm_admin_access=true; ${cookieOptions}`);
  headers.append('Set-Cookie', `mfa_verified=; ${cookieOptions}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
  headers.append('Content-Type', 'application/json');

  return new Response(JSON.stringify({
    success: true,
    requiresMfa: profile?.mfa_enabled === true,
    user: {
      id: data.user.id,
      email: data.user.email,
      role,
    },
  }), { status: 200, headers });
}
