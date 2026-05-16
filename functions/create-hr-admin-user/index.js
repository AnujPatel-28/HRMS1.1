module.exports = async function (request) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const baseUrl = Deno.env.get("INSFORGE_BASE_URL") || Deno.env.get("INSFORGE_URL");
  const adminKey =
    Deno.env.get("INSFORGE_SERVICE_ROLE_KEY") ||
    Deno.env.get("INSFORGE_API_KEY") ||
    Deno.env.get("API_KEY");

  if (!baseUrl || !adminKey) {
    return json({ error: "Missing InsForge function environment variables." }, 500);
  }

  try {
    const authHeader = request.headers.get("Authorization") || "";
    const userToken = authHeader.replace(/^Bearer\s+/i, "");

    if (!userToken) {
      return json({ error: "Unauthorized" }, 401);
    }

    const currentUserRes = await fetch(`${baseUrl}/api/auth/sessions/current`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });

    if (!currentUserRes.ok) {
      return json({ error: "Unauthorized" }, 401);
    }

    await currentUserRes.json().catch(() => ({}));

    const platformRoleRes = await fetch(`${baseUrl}/api/database/rpc/get_my_platform_role`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({}),
    });
    const platformRole = platformRoleRes.ok ? await platformRoleRes.json().catch(() => null) : null;
    if (!platformRole) {
      return json({ error: "Forbidden" }, 403);
    }

    const body = await request.json();
    const { email, name, tenant_id, temp_password } = body;

    if (!email || !tenant_id || !temp_password) {
      return json({ error: "Missing required fields: email, tenant_id, temp_password" }, 400);
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: "Invalid HR admin email." }, 400);
    }

    if (!/^[A-Za-z0-9!@#$%^&*()_\-+=]{8,}$/.test(temp_password)) {
      return json({ error: "Temporary password must be at least 8 valid characters." }, 400);
    }

    const tenantRes = await fetch(`${baseUrl}/api/database/records/tenants?id=eq.${encodeURIComponent(tenant_id)}&select=id,status`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    const tenantRows = tenantRes.ok ? await tenantRes.json().catch(() => []) : [];
    if (!Array.isArray(tenantRows) || tenantRows.length !== 1) {
      return json({ error: "Tenant not found." }, 404);
    }
    if (tenantRows[0].status === "suspended" || tenantRows[0].status === "cancelled") {
      return json({ error: "Cannot create HR admin for a suspended or cancelled tenant." }, 400);
    }

    const createRes = await fetch(`${baseUrl}/api/auth/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminKey}`,
      },
      body: JSON.stringify({
        email,
        password: temp_password,
        name: name || email,
        autoConfirm: true,
        metadata: {
          role: "hr",
          tenant_id,
        },
      }),
    });

    const createData = await createRes.json().catch(() => ({}));

    if (!createRes.ok) {
      return json(
        { error: createData.message || createData.error || "Failed to create user" },
        createRes.status,
      );
    }

    const metadataRes = await fetch(`${baseUrl}/api/database/rpc/set_hr_user_metadata`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        user_email: email,
        tenant_uuid: tenant_id,
        user_name: name || email,
      }),
    });

    if (!metadataRes.ok) {
      const errBody = await metadataRes.text().catch(() => "");
      return json({ error: errBody || "Failed to set HR admin metadata" }, 500);
    }

    const userId = await metadataRes.json().catch(() => null);
    return json({ success: true, user_id: userId });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
};
