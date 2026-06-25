// @ts-nocheck - Deno runtime file, not compiled by the Vite TypeScript toolchain
import { createClient } from "npm:@insforge/sdk";

const BASE_URL = Deno.env.get("INSFORGE_BASE_URL") || Deno.env.get("INSFORGE_URL");
const ADMIN_KEY = Deno.env.get("INSFORGE_ADMIN_KEY") || Deno.env.get("API_KEY");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  if (!BASE_URL || !ADMIN_KEY) {
    return new Response(JSON.stringify({ error: "Missing INSFORGE_BASE_URL or INSFORGE_ADMIN_KEY secrets." }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const client = createClient({ baseUrl: BASE_URL, anonKey: ADMIN_KEY });

  try {
    let targetDate = new Date();
    try {
      const body = await req.json().catch(() => ({}));
      if (body.date) {
        targetDate = new Date(body.date);
      }
    } catch {
      // Ignore parsing errors
    }

    const pad = (num: number) => String(num).padStart(2, "0");
    const targetYear = targetDate.getUTCFullYear();
    const targetMonthStr = pad(targetDate.getUTCMonth() + 1);
    const targetDayStr = pad(targetDate.getUTCDate());
    const targetDateStr = `${targetYear}-${targetMonthStr}-${targetDayStr}`;

    console.log(`Running auto-birthday-posts for target date: ${targetDateStr}`);

    // 1. Fetch active tenants
    const { data: tenants, error: tenantsError } = await client.database
      .from("tenants")
      .select("id, company_name");

    if (tenantsError) throw tenantsError;

    let postsCreated = 0;

    // 2. Iterate through tenants
    for (const tenant of tenants || []) {
      const tenantId = tenant.id;

      // Fetch active employees for this tenant
      const { data: employees, error: empError } = await client.database
        .from("employees")
        .select("id, full_name, role, status, date_of_birth, date_of_joining")
        .eq("tenant_id", tenantId)
        .eq("status", "active");

      if (empError) {
        console.error(`Failed to fetch employees for tenant ${tenantId}:`, empError);
        continue;
      }

      if (!employees || employees.length === 0) continue;

      // Find author: first active HR or fallback to first active employee
      const hrAuthor = employees.find((emp) => emp.role === "hr") ?? employees[0];
      const authorId = hrAuthor.id;

      // Process each employee
      for (const emp of employees) {
        // Birthday Check
        if (emp.date_of_birth) {
          const parts = emp.date_of_birth.split("-");
          const dobMonth = parts[1];
          const dobDay = parts[2];

          if (dobMonth === targetMonthStr && dobDay === targetDayStr) {
            // Check for existing post
            const { data: dupPosts, error: dupErr } = await client.database
              .from("posts")
              .select("id")
              .eq("tenant_id", tenantId)
              .eq("type", "birthday")
              .gte("created_at", `${targetDateStr}T00:00:00Z`)
              .lte("created_at", `${targetDateStr}T23:59:59Z`)
              .like("content", `%@${emp.full_name}%`);

            if (dupErr) {
              console.error(`Error checking duplicate birthday post for ${emp.full_name}:`, dupErr);
              continue;
            }

            if (!dupPosts || dupPosts.length === 0) {
              const content = `🎂 Happy Birthday @${emp.full_name}! Wishing you a wonderful day filled with joy and celebrations. From the entire family! 🎉`;
              const { error: insErr } = await client.database.from("posts").insert([{
                tenant_id: tenantId,
                author_id: authorId,
                content,
                type: "birthday",
                is_pinned: false
              }]);

              if (insErr) {
                console.error(`Failed to insert birthday post for ${emp.full_name}:`, insErr);
              } else {
                console.log(`[Success] Posted birthday wish for ${emp.full_name} (${tenant.company_name})`);
                postsCreated++;
              }
            } else {
              console.log(`Birthday wish for ${emp.full_name} already posted today.`);
            }
          }
        }

        // Work Anniversary Check
        if (emp.date_of_joining) {
          const parts = emp.date_of_joining.split("-");
          const joinYear = parseInt(parts[0], 10);
          const joinMonth = parts[1];
          const joinDay = parts[2];

          if (joinMonth === targetMonthStr && joinDay === targetDayStr && targetYear - joinYear > 0) {
            const yearsCompleted = targetYear - joinYear;

            // Check for existing post
            const { data: dupPosts, error: dupErr } = await client.database
              .from("posts")
              .select("id")
              .eq("tenant_id", tenantId)
              .eq("type", "anniversary")
              .gte("created_at", `${targetDateStr}T00:00:00Z`)
              .lte("created_at", `${targetDateStr}T23:59:59Z`)
              .like("content", `%@${emp.full_name}%`);

            if (dupErr) {
              console.error(`Error checking duplicate anniversary post for ${emp.full_name}:`, dupErr);
              continue;
            }

            if (!dupPosts || dupPosts.length === 0) {
              const content = `🎊 Happy Work Anniversary to @${emp.full_name}! Thank you for completing ${yearsCompleted} year${yearsCompleted > 1 ? "s" : ""} of dedication and hard work with us. We are proud to have you in our team! 🥳`;
              const { error: insErr } = await client.database.from("posts").insert([{
                tenant_id: tenantId,
                author_id: authorId,
                content,
                type: "anniversary",
                is_pinned: false
              }]);

              if (insErr) {
                console.error(`Failed to insert anniversary post for ${emp.full_name}:`, insErr);
              } else {
                console.log(`[Success] Posted anniversary wish for ${emp.full_name} (${tenant.company_name})`);
                postsCreated++;
              }
            } else {
              console.log(`Anniversary wish for ${emp.full_name} already posted today.`);
            }
          }
        }
      }
    }

    return new Response(JSON.stringify({ success: true, posts_created: postsCreated, target_date: targetDateStr }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("auto-birthday-posts execution error:", err);
    return new Response(JSON.stringify({ error: err.message || err.toString() }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
}
