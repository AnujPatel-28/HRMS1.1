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
          // First-admin metadata is identity/navigation compatibility only. Authority is the
          // server-owned Owner + Company Admin membership written below; "hr" would satisfy the
          // broad legacy is_hr() gate and silently grant operational HR workflows.
          role: "employee",
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

    let createdUserId =
      createData.id ||
      createData.user?.id ||
      createData.data?.id ||
      createData.data?.user?.id;
    if (!createdUserId) {
      // Backend versions differ in whether admin-create returns the user object. Resolve the
      // server-created identity by its unique email rather than trusting a response envelope.
      const lookupRes = await fetch(`${baseUrl}/api/database/rpc/get_user_id_by_email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminKey}`,
        },
        body: JSON.stringify({ user_email: email }),
      });
      createdUserId = lookupRes.ok ? await lookupRes.json().catch(() => null) : null;
    }
    if (!createdUserId) {
      return json({ error: "Created user response did not include an id." }, 500);
    }

    const bootstrapRes = await fetch(`${baseUrl}/api/database/rpc/bootstrap_first_tenant_admin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        p_tenant_id: tenant_id,
        p_target_user_id: createdUserId,
      }),
    });

    if (!bootstrapRes.ok) {
      const errBody = await bootstrapRes.text().catch(() => "");
      // Creation and membership provisioning cross two services. Compensate a failed bootstrap
      // so retry cannot leave an orphan auth principal that looks provisioned.
      await fetch(`${baseUrl}/api/auth/users`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminKey}` },
        body: JSON.stringify({ userIds: [createdUserId] }),
      }).catch(() => null);
      return json({ error: errBody || "Failed to bootstrap tenant ownership and access" }, 500);
    }

    const access = await bootstrapRes.json().catch(() => null);
    return json({ success: true, user_id: createdUserId, access });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
};
