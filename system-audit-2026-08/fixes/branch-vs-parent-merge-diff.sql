-- Generated 2026-08-12T09:43:21.379Z
-- ⚠️ MERGE BLOCKED: 15 conflict(s) detected. Resolve before applying.

-- [CONFLICT] table public.expenses
--   parent_t0_hash:  (absent)
--   parent_now_hash: 06e25bb0c2857a5341de9e018c5b8b0601813ea1ea0080b39aa48dc51397219f
--   branch_now_hash: 527902fd6602f1cc17592528ab9f5d9da10802d3aaf7f5c53fd57e5b4a0f6a2b
--   hint: Both parent and branch modified this object after branch creation. Resolve manually.

-- [CONFLICT] table public.projects
--   parent_t0_hash:  (absent)
--   parent_now_hash: f9fcecc9fdc815ef3b38208cb52bf4b4713cde5ea5872cf2ce79fddf557442f4
--   branch_now_hash: c797ec8e88e655857e4a5d7d42b10b2eac55193b74eed1303a1575d97ac30ed5
--   hint: Both parent and branch modified this object after branch creation. Resolve manually.

-- [CONFLICT] table public.exit_requests
--   parent_t0_hash:  (absent)
--   parent_now_hash: 0120dd4142d2b0a8ade446348bc55c14fd9ca6254d75d4bc06bf9940a2c2054f
--   branch_now_hash: c123201dd787b1e54de7b2d1a733a9ebb6d150eeddf9af7fdebbda869dd09c0e
--   hint: Both parent and branch modified this object after branch creation. Resolve manually.

-- [CONFLICT] table public.exit_clearances
--   parent_t0_hash:  (absent)
--   parent_now_hash: 2b81679e84d7e8ff55c43f51a3e956514b51cd3ea5a443e4f98e1a83ff0d29fa
--   branch_now_hash: 41906482dba0f63b33fc1cfd735779e3d51d00864daf0f6da4acc9b148340806
--   hint: Both parent and branch modified this object after branch creation. Resolve manually.

-- [CONFLICT] table public.insurance_policies
--   parent_t0_hash:  (absent)
--   parent_now_hash: d32cc1a393c94521d148b39fbf87ea74bd553fe7573e8823bef5fc1c45204d6e
--   branch_now_hash: 87b90456528040f967473f1b5905813a3b4b23d2119fda21c4fe300ef01ccd3c
--   hint: Both parent and branch modified this object after branch creation. Resolve manually.

-- [CONFLICT] table public.employee_onboarding_self
--   parent_t0_hash:  (absent)
--   parent_now_hash: 57d0221315f7645f654bce908fe18169c6a3cc734b3e6bfeafb551b3880e7de7
--   branch_now_hash: 26532750e906b946e46e131ad4e0f505ba56b26b13f32d17e4bb30dece22024b
--   hint: Both parent and branch modified this object after branch creation. Resolve manually.

-- [CONFLICT] table public.employee_reporting_relationships
--   parent_t0_hash:  (absent)
--   parent_now_hash: 29dfb6fa7a7e71c6f3e42c9be90288b3ca8ec3f3ac22242c105958dffddf49e0
--   branch_now_hash: 09d335cec33f17f933beae4c0f09e7182e42d858d788d536e7b09a3fa0d2f7e7
--   hint: Both parent and branch modified this object after branch creation. Resolve manually.

-- [CONFLICT] policy public.it_declarations.declarations_hr_all
--   parent_t0_hash:  (absent)
--   parent_now_hash: 70228c1fbcd7ec714d634986697eb5a217b14258c61a1a098ee368aca9417ef6
--   branch_now_hash: e3ecbe479d4f4fbb517d8047e025054a745ac3c2e12d6cd702ce74766f450dff
--   hint: Both parent and branch modified this object after branch creation. Resolve manually.

-- [CONFLICT] policy public.it_declarations.declarations_self_all
--   parent_t0_hash:  (absent)
--   parent_now_hash: aa7e9470cd7006ab80f9d04a2d4990808805d71e15ce3117ce6a5b9ebb602a9e
--   branch_now_hash: 1ed5f8fba78f3013e6ed65c7814942ef09d1cfb30da7d5cfe5cb508b84f48af8
--   hint: Both parent and branch modified this object after branch creation. Resolve manually.

-- [CONFLICT] policy public.insurance_policies.insurance_policies_hr_all
--   parent_t0_hash:  (absent)
--   parent_now_hash: 4ecac30be6c0c5c7f3f4e681ca24e428eb60c62dc34e37a3600f22ace7745e46
--   branch_now_hash: 8bbdcb4be86d76f5661b33f36a4b0f576ff636c3d47a65b02012be4768f5492a
--   hint: Both parent and branch modified this object after branch creation. Resolve manually.

-- [CONFLICT] policy public.it_declarations.declarations_tenant_isolation
--   parent_t0_hash:  (absent)
--   parent_now_hash: 56ca34a2fead6c37b0203543afb4c1cf29a49a3ea97072fcbbc9877afdf4cb8c
--   branch_now_hash: cbbf60cfb898c07a73a6083799c54c5fa73e350f4631662d95f4bc5ab698c790
--   hint: Both parent and branch modified this object after branch creation. Resolve manually.

-- [CONFLICT] policy public.it_declaration_windows.windows_tenant_isolation
--   parent_t0_hash:  (absent)
--   parent_now_hash: 1eca8af9bd34ae0bbae969b41515dd7a5f73c14c1ce4d79919fbe03b1e8438e5
--   branch_now_hash: 676813144764b3d28d6960dc47f893f01c9bcc923744e4a2b08f0731505a9e4c
--   hint: Both parent and branch modified this object after branch creation. Resolve manually.

-- [CONFLICT] edge_function edge_function.create-employee-user
--   parent_t0_hash:  48373c0b56ed57039c5ee9712dcb8e2ca893c4687245fff46f9271ddc4f12c99
--   parent_now_hash: 31a884d10a5478d6d6e38e64734cc77c055aa4dea984fab45b4561dca182d1b4
--   branch_now_hash: aa7873e7d6802de21fa9448f0cb492a37cfd6a05649e0607329d0da91e46365a
--   hint: Both parent and branch modified this object after branch creation. Resolve manually.

-- [CONFLICT] edge_function edge_function.verify-employee-code
--   parent_t0_hash:  690cfc139f06c49a434533d02bcd1108a2eb599837f6be8d4b42644ff3f46385
--   parent_now_hash: bea6c3beb7081f9320fc14769930788c22dc138bc2f009e0c95c6e3fefef0e71
--   branch_now_hash: 4a33eccac71e248c84300c731c7ed3cd409b8ee7b589fa02d5a671d9745846e3
--   hint: Both parent and branch modified this object after branch creation. Resolve manually.

-- [CONFLICT] migration system.migrations
--   parent_t0_hash:  20260513120000,20260513124500,20260513125500,20260513140331
--   parent_now_hash: 20260513120000,20260513124500,20260513125500,20260513140331,20260812140000
--   branch_now_hash: 20260513120000,20260513124500,20260513125500,20260513140331,20260630103000,20260630113000,20260703160000,20260703170000,20260703180000,20260703190000,20260703200000,20260704110000,20260706100000,20260706110000,20260706130000,20260706140000,20260706190000,20260706200000,20260706210000,20260706220000,20260706230000
--   hint: Both parent and branch added migrations after T0. Manually rebase the branch.

-- The SQL below is what would be applied if no conflicts existed; do NOT run as-is.

BEGIN;

-- ===== DATA =====
-- [DATA] config_row schedules.jobs (modify)
INSERT INTO "schedules"."jobs" ("id", "body", "name", "headers", "is_active", "created_at", "updated_at", "cron_job_id", "http_method", "function_url", "cron_schedule", "last_executed_at", "encrypted_headers") VALUES ('783bd585-731f-4dc4-bb6c-b508ccbddf15', '{}'::jsonb, 'auto-birthday-posts', '{"Content-Type":"application/json"}'::jsonb, TRUE, '2026-06-24T07:27:11.398683+00:00', '2026-08-12T00:01:00.012118+00:00', 9, 'POST', 'https://rq3qmu8y-jx7.functions.insforge.app/auto-birthday-posts', '1 0 * * *', '2026-08-12T00:01:00.012118+00:00', 'ww0EBwMCcKxiZaxjhJV80lUBHOiypyIE+94oNcVrrhyhDG+3LV9qHd3Frs4jVTPSKn7PHiz9r0e2
TutknPlTkWiVsq/fyXGvXRLskbOXHYa6EmVjcD5FgKu/Sl2TF6wYGPSN4Ywk')
  ON CONFLICT ("name") DO UPDATE SET "id" = EXCLUDED."id", "body" = EXCLUDED."body", "headers" = EXCLUDED."headers", "is_active" = EXCLUDED."is_active", "created_at" = EXCLUDED."created_at", "updated_at" = EXCLUDED."updated_at", "cron_job_id" = EXCLUDED."cron_job_id", "http_method" = EXCLUDED."http_method", "function_url" = EXCLUDED."function_url", "cron_schedule" = EXCLUDED."cron_schedule", "last_executed_at" = EXCLUDED."last_executed_at", "encrypted_headers" = EXCLUDED."encrypted_headers";

-- [DATA] edge_function edge_function.auto-birthday-posts (add)
INSERT INTO "functions"."definitions" ("id", "code", "name", "slug", "status", "created_at", "updated_at", "deployed_at", "description") VALUES ('20352a16-8f2c-44ea-b8a0-00e3da694cdd', '// @ts-nocheck - Deno runtime file, not compiled by the Vite TypeScript toolchain
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
', 'Auto Birthday Posts', 'auto-birthday-posts', 'active', '2026-06-24T07:18:56.292226+00:00', '2026-06-24T07:18:56.2997+00:00', '2026-06-24T07:18:56.2997+00:00', 'Generates daily birthday and work anniversary posts')
  ON CONFLICT ("slug") DO UPDATE SET "id" = EXCLUDED."id", "code" = EXCLUDED."code", "name" = EXCLUDED."name", "status" = EXCLUDED."status", "created_at" = EXCLUDED."created_at", "updated_at" = EXCLUDED."updated_at", "deployed_at" = EXCLUDED."deployed_at", "description" = EXCLUDED."description";

-- ===== DDL =====
-- [DDL] table public.hr_policies (modify)
-- not auto-applied: table modify diffs are not auto-applied — capture the change in a migration on branch.

-- [DDL] table public.posts (add)
CREATE TABLE IF NOT EXISTS public.posts (id uuid NOT NULL DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, author_id uuid NOT NULL, content text NOT NULL, image_url text, type text NOT NULL DEFAULT 'post'::text, is_pinned boolean NOT NULL DEFAULT false, created_at timestamp with time zone NOT NULL DEFAULT now(), updated_at timestamp with time zone NOT NULL DEFAULT now(), PRIMARY KEY (id), FOREIGN KEY (author_id) REFERENCES employees(id) ON DELETE CASCADE, FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS idx_posts_tenant_created ON public.posts USING btree (tenant_id, created_at DESC);

-- [DDL] table public.post_reactions (add)
CREATE TABLE IF NOT EXISTS public.post_reactions (id uuid NOT NULL DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, post_id uuid NOT NULL, employee_id uuid NOT NULL, reaction text NOT NULL DEFAULT 'like'::text, created_at timestamp with time zone NOT NULL DEFAULT now(), PRIMARY KEY (id), UNIQUE (post_id, employee_id), FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE, FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE, FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS idx_post_reactions_post ON public.post_reactions USING btree (post_id);

-- [DDL] table public.newsletter_rate_limits (add)
CREATE TABLE IF NOT EXISTS public.newsletter_rate_limits (ip_hash text NOT NULL, request_count integer NOT NULL DEFAULT 1, window_start timestamp with time zone NOT NULL DEFAULT now(), PRIMARY KEY (ip_hash));

-- [DDL] table public.newsletter_subscribers (add)
CREATE TABLE IF NOT EXISTS public.newsletter_subscribers (id uuid NOT NULL DEFAULT gen_random_uuid(), email text NOT NULL, status newsletter_status NOT NULL DEFAULT 'pending'::newsletter_status, source text NOT NULL DEFAULT 'footer'::text, interests text[], confirmation_token_hash text, confirmation_token_expires_at timestamp with time zone, confirmation_email_sent_at timestamp with time zone, confirmed_at timestamp with time zone, unsubscribe_token text NOT NULL, last_email_sent_at timestamp with time zone, created_at timestamp with time zone NOT NULL DEFAULT now(), updated_at timestamp with time zone NOT NULL DEFAULT now(), user_agent text, UNIQUE (email), PRIMARY KEY (id), UNIQUE (unsubscribe_token));
CREATE INDEX IF NOT EXISTS idx_newsletter_created_at ON public.newsletter_subscribers USING btree (created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_newsletter_email ON public.newsletter_subscribers USING btree (email);
CREATE INDEX IF NOT EXISTS idx_newsletter_status ON public.newsletter_subscribers USING btree (status);
CREATE INDEX IF NOT EXISTS idx_newsletter_token_hash ON public.newsletter_subscribers USING btree (confirmation_token_hash) WHERE (confirmation_token_hash IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_newsletter_unsub_token ON public.newsletter_subscribers USING btree (unsubscribe_token);

-- [DDL] table public.employee_policy_acknowledgements (add)
CREATE TABLE IF NOT EXISTS public.employee_policy_acknowledgements (id uuid NOT NULL DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, policy_id uuid NOT NULL, employee_id uuid NOT NULL, acknowledged_at timestamp with time zone NOT NULL DEFAULT now(), acknowledgement_text text, created_at timestamp with time zone NOT NULL DEFAULT now(), PRIMARY KEY (id), UNIQUE (tenant_id, policy_id, employee_id), FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE, FOREIGN KEY (policy_id) REFERENCES hr_policies(id) ON DELETE CASCADE, FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE);

-- [DDL] policy public.employees.tenant_isolation (drop)
DROP POLICY IF EXISTS "tenant_isolation" ON "public"."employees";

-- [DDL] policy public.attendance.attendance_hr_all (drop)
DROP POLICY IF EXISTS "attendance_hr_all" ON "public"."attendance";

-- [DDL] policy public.attendance.attendance_self_read (drop)
DROP POLICY IF EXISTS "attendance_self_read" ON "public"."attendance";

-- [DDL] policy public.attendance_breaks.breaks_hr_all (drop)
DROP POLICY IF EXISTS "breaks_hr_all" ON "public"."attendance_breaks";

-- [DDL] policy public.attendance.attendance_self_write (drop)
DROP POLICY IF EXISTS "attendance_self_write" ON "public"."attendance";

-- [DDL] policy public.attendance.attendance_self_update (drop)
DROP POLICY IF EXISTS "attendance_self_update" ON "public"."attendance";

-- [DDL] policy public.attendance_selfies.selfies_hr_all (drop)
DROP POLICY IF EXISTS "selfies_hr_all" ON "public"."attendance_selfies";

-- [DDL] policy public.attendance_breaks.breaks_self_read (drop)
DROP POLICY IF EXISTS "breaks_self_read" ON "public"."attendance_breaks";

-- [DDL] policy public.attendance_selfies.selfies_self_read (drop)
DROP POLICY IF EXISTS "selfies_self_read" ON "public"."attendance_selfies";

-- [DDL] policy public.attendance_selfies.selfies_self_insert (drop)
DROP POLICY IF EXISTS "selfies_self_insert" ON "public"."attendance_selfies";

-- [DDL] policy public.attendance_corrections.tenant_isolation (modify)
DROP POLICY IF EXISTS "tenant_isolation" ON "public"."attendance_corrections";
CREATE POLICY "tenant_isolation" ON "public"."attendance_corrections"
  AS RESTRICTIVE
  FOR ALL
  TO "authenticated"
  USING ((tenant_id = get_auth_tenant_id()))
  WITH CHECK ((tenant_id = get_auth_tenant_id()));

-- [DDL] policy public.attendance_corrections.attendance_corrections_hr_all (drop)
DROP POLICY IF EXISTS "attendance_corrections_hr_all" ON "public"."attendance_corrections";

-- [DDL] policy public.posts.posts_delete (add)
DROP POLICY IF EXISTS "posts_delete" ON "public"."posts";
CREATE POLICY "posts_delete" ON "public"."posts"
  AS PERMISSIVE
  FOR DELETE
  TO "authenticated"
  USING (((tenant_id = ( SELECT get_auth_tenant_id() AS get_auth_tenant_id)) AND ((author_id = ( SELECT employees.id
   FROM employees
  WHERE (employees.user_id = ( SELECT auth.uid() AS uid)))) OR ( SELECT is_hr() AS is_hr))));

-- [DDL] policy public.posts.posts_insert (add)
DROP POLICY IF EXISTS "posts_insert" ON "public"."posts";
CREATE POLICY "posts_insert" ON "public"."posts"
  AS PERMISSIVE
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((tenant_id = ( SELECT get_auth_tenant_id() AS get_auth_tenant_id)) AND (author_id = ( SELECT employees.id
   FROM employees
  WHERE (employees.user_id = ( SELECT auth.uid() AS uid)))) AND ((type <> 'announcement'::text) OR ( SELECT is_hr() AS is_hr))));

-- [DDL] policy public.posts.posts_select (add)
DROP POLICY IF EXISTS "posts_select" ON "public"."posts";
CREATE POLICY "posts_select" ON "public"."posts"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING ((tenant_id = ( SELECT get_auth_tenant_id() AS get_auth_tenant_id)));

-- [DDL] policy public.posts.posts_update (add)
DROP POLICY IF EXISTS "posts_update" ON "public"."posts";
CREATE POLICY "posts_update" ON "public"."posts"
  AS PERMISSIVE
  FOR UPDATE
  TO "authenticated"
  USING ((tenant_id = ( SELECT get_auth_tenant_id() AS get_auth_tenant_id)))
  WITH CHECK ((tenant_id = ( SELECT get_auth_tenant_id() AS get_auth_tenant_id)));

-- [DDL] policy public.expenses.expenses_hr_all (add)
DROP POLICY IF EXISTS "expenses_hr_all" ON "public"."expenses";
CREATE POLICY "expenses_hr_all" ON "public"."expenses"
  AS PERMISSIVE
  FOR ALL
  TO "authenticated"
  USING ((( SELECT is_hr() AS is_hr) AND (tenant_id = ( SELECT get_auth_tenant_id() AS get_auth_tenant_id))))
  WITH CHECK ((( SELECT is_hr() AS is_hr) AND (tenant_id = ( SELECT get_auth_tenant_id() AS get_auth_tenant_id))));

-- [DDL] policy public.locations.locations_hr_all (add)
DROP POLICY IF EXISTS "locations_hr_all" ON "public"."locations";
CREATE POLICY "locations_hr_all" ON "public"."locations"
  AS PERMISSIVE
  FOR ALL
  TO "authenticated"
  USING ((can_access_tenant(tenant_id) AND is_hr()))
  WITH CHECK ((can_access_tenant(tenant_id) AND is_hr()));

-- [DDL] policy public.org_units.org_units_hr_all (add)
DROP POLICY IF EXISTS "org_units_hr_all" ON "public"."org_units";
CREATE POLICY "org_units_hr_all" ON "public"."org_units"
  AS PERMISSIVE
  FOR ALL
  TO "authenticated"
  USING ((can_access_tenant(tenant_id) AND is_hr()))
  WITH CHECK ((can_access_tenant(tenant_id) AND is_hr()));

-- [DDL] policy public.expenses.expenses_select_own (add)
DROP POLICY IF EXISTS "expenses_select_own" ON "public"."expenses";
CREATE POLICY "expenses_select_own" ON "public"."expenses"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING (((employee_id = ( SELECT employees.id
   FROM employees
  WHERE (employees.user_id = ( SELECT auth.uid() AS uid)))) AND (tenant_id = ( SELECT get_auth_tenant_id() AS get_auth_tenant_id))));

-- [DDL] policy public.job_titles.job_titles_hr_all (add)
DROP POLICY IF EXISTS "job_titles_hr_all" ON "public"."job_titles";
CREATE POLICY "job_titles_hr_all" ON "public"."job_titles"
  AS PERMISSIVE
  FOR ALL
  TO "authenticated"
  USING ((can_access_tenant(tenant_id) AND is_hr()))
  WITH CHECK ((can_access_tenant(tenant_id) AND is_hr()));

-- [DDL] policy public.employees.employees_self_read (add)
DROP POLICY IF EXISTS "employees_self_read" ON "public"."employees";
CREATE POLICY "employees_self_read" ON "public"."employees"
  AS PERMISSIVE
  FOR SELECT
  TO "public"
  USING (((user_id = auth.uid()) AND (tenant_id = get_auth_tenant_id())));

-- [DDL] policy public.attendance.attendance_delete_hr (add)
DROP POLICY IF EXISTS "attendance_delete_hr" ON "public"."attendance";
CREATE POLICY "attendance_delete_hr" ON "public"."attendance"
  AS PERMISSIVE
  FOR DELETE
  TO "authenticated"
  USING (is_hr());

-- [DDL] policy public.attendance.attendance_insert_hr (add)
DROP POLICY IF EXISTS "attendance_insert_hr" ON "public"."attendance";
CREATE POLICY "attendance_insert_hr" ON "public"."attendance"
  AS PERMISSIVE
  FOR INSERT
  TO "authenticated"
  WITH CHECK (is_hr());

-- [DDL] policy public.attendance.attendance_select_hr (add)
DROP POLICY IF EXISTS "attendance_select_hr" ON "public"."attendance";
CREATE POLICY "attendance_select_hr" ON "public"."attendance"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING (is_hr());

-- [DDL] policy public.attendance.attendance_update_hr (add)
DROP POLICY IF EXISTS "attendance_update_hr" ON "public"."attendance";
CREATE POLICY "attendance_update_hr" ON "public"."attendance"
  AS PERMISSIVE
  FOR UPDATE
  TO "authenticated"
  USING (is_hr())
  WITH CHECK (is_hr());

-- [DDL] policy public.attendance.attendance_insert_self (add)
DROP POLICY IF EXISTS "attendance_insert_self" ON "public"."attendance";
CREATE POLICY "attendance_insert_self" ON "public"."attendance"
  AS PERMISSIVE
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = attendance.employee_id) AND (e.user_id = auth.uid())))));

-- [DDL] policy public.attendance.attendance_select_self (add)
DROP POLICY IF EXISTS "attendance_select_self" ON "public"."attendance";
CREATE POLICY "attendance_select_self" ON "public"."attendance"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = attendance.employee_id) AND (e.user_id = auth.uid())))));

-- [DDL] policy public.attendance.attendance_update_self (add)
DROP POLICY IF EXISTS "attendance_update_self" ON "public"."attendance";
CREATE POLICY "attendance_update_self" ON "public"."attendance"
  AS PERMISSIVE
  FOR UPDATE
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = attendance.employee_id) AND (e.user_id = auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = attendance.employee_id) AND (e.user_id = auth.uid())))));

-- [DDL] policy public.locations.locations_tenant_select (add)
DROP POLICY IF EXISTS "locations_tenant_select" ON "public"."locations";
CREATE POLICY "locations_tenant_select" ON "public"."locations"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING (can_access_tenant(tenant_id));

-- [DDL] policy public.org_units.org_units_tenant_select (add)
DROP POLICY IF EXISTS "org_units_tenant_select" ON "public"."org_units";
CREATE POLICY "org_units_tenant_select" ON "public"."org_units"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING (can_access_tenant(tenant_id));

-- [DDL] policy public.projects.projects_tenant_isolation (add)
DROP POLICY IF EXISTS "projects_tenant_isolation" ON "public"."projects";
CREATE POLICY "projects_tenant_isolation" ON "public"."projects"
  AS PERMISSIVE
  FOR ALL
  TO "authenticated"
  USING ((tenant_id = ( SELECT get_auth_tenant_id() AS get_auth_tenant_id)))
  WITH CHECK ((tenant_id = ( SELECT get_auth_tenant_id() AS get_auth_tenant_id)));

-- [DDL] policy public.job_titles.job_titles_tenant_select (add)
DROP POLICY IF EXISTS "job_titles_tenant_select" ON "public"."job_titles";
CREATE POLICY "job_titles_tenant_select" ON "public"."job_titles"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING (can_access_tenant(tenant_id));

-- [DDL] policy public.it_declaration_windows.windows_hr_all (add)
DROP POLICY IF EXISTS "windows_hr_all" ON "public"."it_declaration_windows";
CREATE POLICY "windows_hr_all" ON "public"."it_declaration_windows"
  AS PERMISSIVE
  FOR ALL
  TO "authenticated"
  USING (( SELECT is_hr() AS is_hr))
  WITH CHECK (( SELECT is_hr() AS is_hr));

-- [DDL] policy public.exit_clearances.exit_clearances_hr_all (add)
DROP POLICY IF EXISTS "exit_clearances_hr_all" ON "public"."exit_clearances";
CREATE POLICY "exit_clearances_hr_all" ON "public"."exit_clearances"
  AS PERMISSIVE
  FOR ALL
  TO "authenticated"
  USING ((can_access_tenant(tenant_id) AND is_hr()))
  WITH CHECK ((can_access_tenant(tenant_id) AND is_hr()));

-- [DDL] policy public.employment_types.employment_types_hr_all (add)
DROP POLICY IF EXISTS "employment_types_hr_all" ON "public"."employment_types";
CREATE POLICY "employment_types_hr_all" ON "public"."employment_types"
  AS PERMISSIVE
  FOR ALL
  TO "authenticated"
  USING ((can_access_tenant(tenant_id) AND is_hr()))
  WITH CHECK ((can_access_tenant(tenant_id) AND is_hr()));

-- [DDL] policy public.it_declaration_windows.windows_employee_read (add)
DROP POLICY IF EXISTS "windows_employee_read" ON "public"."it_declaration_windows";
CREATE POLICY "windows_employee_read" ON "public"."it_declaration_windows"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING (true);

-- [DDL] policy public.attendance_breaks.attendance_breaks_delete_hr (add)
DROP POLICY IF EXISTS "attendance_breaks_delete_hr" ON "public"."attendance_breaks";
CREATE POLICY "attendance_breaks_delete_hr" ON "public"."attendance_breaks"
  AS PERMISSIVE
  FOR DELETE
  TO "authenticated"
  USING (is_hr());

-- [DDL] policy public.attendance_breaks.attendance_breaks_insert_hr (add)
DROP POLICY IF EXISTS "attendance_breaks_insert_hr" ON "public"."attendance_breaks";
CREATE POLICY "attendance_breaks_insert_hr" ON "public"."attendance_breaks"
  AS PERMISSIVE
  FOR INSERT
  TO "authenticated"
  WITH CHECK (is_hr());

-- [DDL] policy public.attendance_breaks.attendance_breaks_select_hr (add)
DROP POLICY IF EXISTS "attendance_breaks_select_hr" ON "public"."attendance_breaks";
CREATE POLICY "attendance_breaks_select_hr" ON "public"."attendance_breaks"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING (is_hr());

-- [DDL] policy public.attendance_breaks.attendance_breaks_update_hr (add)
DROP POLICY IF EXISTS "attendance_breaks_update_hr" ON "public"."attendance_breaks";
CREATE POLICY "attendance_breaks_update_hr" ON "public"."attendance_breaks"
  AS PERMISSIVE
  FOR UPDATE
  TO "authenticated"
  USING (is_hr())
  WITH CHECK (is_hr());

-- [DDL] policy public.exit_clearances.exit_clearances_tenant_select (add)
DROP POLICY IF EXISTS "exit_clearances_tenant_select" ON "public"."exit_clearances";
CREATE POLICY "exit_clearances_tenant_select" ON "public"."exit_clearances"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING (can_access_tenant(tenant_id));

-- [DDL] policy public.post_reactions.post_reactions_tenant_isolation (add)
DROP POLICY IF EXISTS "post_reactions_tenant_isolation" ON "public"."post_reactions";
CREATE POLICY "post_reactions_tenant_isolation" ON "public"."post_reactions"
  AS PERMISSIVE
  FOR ALL
  TO "authenticated"
  USING ((tenant_id = ( SELECT get_auth_tenant_id() AS get_auth_tenant_id)))
  WITH CHECK ((tenant_id = ( SELECT get_auth_tenant_id() AS get_auth_tenant_id)));

-- [DDL] policy public.attendance_breaks.attendance_breaks_select_self (add)
DROP POLICY IF EXISTS "attendance_breaks_select_self" ON "public"."attendance_breaks";
CREATE POLICY "attendance_breaks_select_self" ON "public"."attendance_breaks"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = attendance_breaks.employee_id) AND (e.user_id = auth.uid())))));

-- [DDL] policy public.attendance_selfies.attendance_selfies_delete_hr (add)
DROP POLICY IF EXISTS "attendance_selfies_delete_hr" ON "public"."attendance_selfies";
CREATE POLICY "attendance_selfies_delete_hr" ON "public"."attendance_selfies"
  AS PERMISSIVE
  FOR DELETE
  TO "authenticated"
  USING (is_hr());

-- [DDL] policy public.attendance_selfies.attendance_selfies_insert_hr (add)
DROP POLICY IF EXISTS "attendance_selfies_insert_hr" ON "public"."attendance_selfies";
CREATE POLICY "attendance_selfies_insert_hr" ON "public"."attendance_selfies"
  AS PERMISSIVE
  FOR INSERT
  TO "authenticated"
  WITH CHECK (is_hr());

-- [DDL] policy public.attendance_selfies.attendance_selfies_select_hr (add)
DROP POLICY IF EXISTS "attendance_selfies_select_hr" ON "public"."attendance_selfies";
CREATE POLICY "attendance_selfies_select_hr" ON "public"."attendance_selfies"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING (is_hr());

-- [DDL] policy public.attendance_selfies.attendance_selfies_update_hr (add)
DROP POLICY IF EXISTS "attendance_selfies_update_hr" ON "public"."attendance_selfies";
CREATE POLICY "attendance_selfies_update_hr" ON "public"."attendance_selfies"
  AS PERMISSIVE
  FOR UPDATE
  TO "authenticated"
  USING (is_hr())
  WITH CHECK (is_hr());

-- [DDL] policy public.employment_types.employment_types_tenant_select (add)
DROP POLICY IF EXISTS "employment_types_tenant_select" ON "public"."employment_types";
CREATE POLICY "employment_types_tenant_select" ON "public"."employment_types"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING (can_access_tenant(tenant_id));

-- [DDL] policy public.insurance_policies.insurance_policies_select_own (add)
DROP POLICY IF EXISTS "insurance_policies_select_own" ON "public"."insurance_policies";
CREATE POLICY "insurance_policies_select_own" ON "public"."insurance_policies"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING (((employee_id = ( SELECT employees.id
   FROM employees
  WHERE (employees.user_id = ( SELECT auth.uid() AS uid)))) AND (tenant_id = ( SELECT get_auth_tenant_id() AS get_auth_tenant_id))));

-- [DDL] policy public.attendance_selfies.attendance_selfies_insert_self (add)
DROP POLICY IF EXISTS "attendance_selfies_insert_self" ON "public"."attendance_selfies";
CREATE POLICY "attendance_selfies_insert_self" ON "public"."attendance_selfies"
  AS PERMISSIVE
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (attendance a
     JOIN employees e ON ((e.id = a.employee_id)))
  WHERE ((a.id = attendance_selfies.attendance_id) AND (e.user_id = auth.uid())))));

-- [DDL] policy public.attendance_selfies.attendance_selfies_select_self (add)
DROP POLICY IF EXISTS "attendance_selfies_select_self" ON "public"."attendance_selfies";
CREATE POLICY "attendance_selfies_select_self" ON "public"."attendance_selfies"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING ((employee_id = ( SELECT employees.id
   FROM employees
  WHERE (employees.user_id = auth.uid()))));

-- [DDL] policy public.employee_policy_acknowledgements.tenant_isolation (add)
DROP POLICY IF EXISTS "tenant_isolation" ON "public"."employee_policy_acknowledgements";
CREATE POLICY "tenant_isolation" ON "public"."employee_policy_acknowledgements"
  AS PERMISSIVE
  FOR ALL
  TO "authenticated"
  USING ((tenant_id = get_auth_tenant_id()))
  WITH CHECK ((tenant_id = get_auth_tenant_id()));

-- [DDL] policy public.attendance_corrections.attendance_corrections_delete_hr (add)
DROP POLICY IF EXISTS "attendance_corrections_delete_hr" ON "public"."attendance_corrections";
CREATE POLICY "attendance_corrections_delete_hr" ON "public"."attendance_corrections"
  AS PERMISSIVE
  FOR DELETE
  TO "authenticated"
  USING (is_hr());

-- [DDL] policy public.attendance_corrections.attendance_corrections_insert_hr (add)
DROP POLICY IF EXISTS "attendance_corrections_insert_hr" ON "public"."attendance_corrections";
CREATE POLICY "attendance_corrections_insert_hr" ON "public"."attendance_corrections"
  AS PERMISSIVE
  FOR INSERT
  TO "authenticated"
  WITH CHECK (is_hr());

-- [DDL] policy public.attendance_corrections.attendance_corrections_select_hr (add)
DROP POLICY IF EXISTS "attendance_corrections_select_hr" ON "public"."attendance_corrections";
CREATE POLICY "attendance_corrections_select_hr" ON "public"."attendance_corrections"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING (is_hr());

-- [DDL] policy public.attendance_corrections.attendance_corrections_update_hr (add)
DROP POLICY IF EXISTS "attendance_corrections_update_hr" ON "public"."attendance_corrections";
CREATE POLICY "attendance_corrections_update_hr" ON "public"."attendance_corrections"
  AS PERMISSIVE
  FOR UPDATE
  TO "authenticated"
  USING (is_hr())
  WITH CHECK (is_hr());

-- [DDL] policy public.employee_policy_acknowledgements.acknowledgements_hr_all (add)
DROP POLICY IF EXISTS "acknowledgements_hr_all" ON "public"."employee_policy_acknowledgements";
CREATE POLICY "acknowledgements_hr_all" ON "public"."employee_policy_acknowledgements"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING (is_hr());

-- [DDL] policy public.exit_clearance_templates.exit_clearance_templates_hr_all (add)
DROP POLICY IF EXISTS "exit_clearance_templates_hr_all" ON "public"."exit_clearance_templates";
CREATE POLICY "exit_clearance_templates_hr_all" ON "public"."exit_clearance_templates"
  AS PERMISSIVE
  FOR ALL
  TO "authenticated"
  USING ((can_access_tenant(tenant_id) AND is_hr()))
  WITH CHECK ((can_access_tenant(tenant_id) AND is_hr()));

-- [DDL] policy public.employee_policy_acknowledgements.tenant_active_restrictive (add)
DROP POLICY IF EXISTS "tenant_active_restrictive" ON "public"."employee_policy_acknowledgements";
CREATE POLICY "tenant_active_restrictive" ON "public"."employee_policy_acknowledgements"
  AS RESTRICTIVE
  FOR ALL
  TO "public"
  USING (can_access_tenant(tenant_id))
  WITH CHECK (can_access_tenant(tenant_id));

-- [DDL] policy public.employee_reporting_relationships.employee_reporting_hr_all (add)
DROP POLICY IF EXISTS "employee_reporting_hr_all" ON "public"."employee_reporting_relationships";
CREATE POLICY "employee_reporting_hr_all" ON "public"."employee_reporting_relationships"
  AS PERMISSIVE
  FOR ALL
  TO "authenticated"
  USING ((can_access_tenant(tenant_id) AND is_hr()))
  WITH CHECK ((can_access_tenant(tenant_id) AND is_hr()));

-- [DDL] policy public.employee_policy_acknowledgements.acknowledgements_employee_self (add)
DROP POLICY IF EXISTS "acknowledgements_employee_self" ON "public"."employee_policy_acknowledgements";
CREATE POLICY "acknowledgements_employee_self" ON "public"."employee_policy_acknowledgements"
  AS PERMISSIVE
  FOR ALL
  TO "authenticated"
  USING ((employee_id IN ( SELECT e.id
   FROM employees e
  WHERE ((e.user_id = auth.uid()) AND (e.tenant_id = e.tenant_id)))))
  WITH CHECK ((employee_id IN ( SELECT e.id
   FROM employees e
  WHERE ((e.user_id = auth.uid()) AND (e.tenant_id = e.tenant_id)))));

-- [DDL] policy public.exit_clearance_templates.exit_clearance_templates_tenant_select (add)
DROP POLICY IF EXISTS "exit_clearance_templates_tenant_select" ON "public"."exit_clearance_templates";
CREATE POLICY "exit_clearance_templates_tenant_select" ON "public"."exit_clearance_templates"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING (can_access_tenant(tenant_id));

-- [DDL] policy public.employee_reporting_relationships.employee_reporting_tenant_select (add)
DROP POLICY IF EXISTS "employee_reporting_tenant_select" ON "public"."employee_reporting_relationships";
CREATE POLICY "employee_reporting_tenant_select" ON "public"."employee_reporting_relationships"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING (can_access_tenant(tenant_id));

-- [DDL] function public.set_updated_at() (add)
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

-- [DDL] function public.seed_exit_clearances() (add)
CREATE OR REPLACE FUNCTION public.seed_exit_clearances()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO public.exit_clearances (
    tenant_id,
    exit_request_id,
    template_id,
    department,
    label
  )
  SELECT
    NEW.tenant_id,
    NEW.id,
    t.id,
    t.department,
    t.label
  FROM public.exit_clearance_templates t
  WHERE t.tenant_id = NEW.tenant_id
    AND t.is_active = true
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$;

-- [DDL] function public.cleanup_exit_clearances_on_cancel() (add)
CREATE OR REPLACE FUNCTION public.cleanup_exit_clearances_on_cancel()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.status IN ('rejected', 'withdrawn') AND OLD.status NOT IN ('rejected', 'withdrawn') THEN
    UPDATE public.exit_clearances
    SET status = 'cancelled',
        remarks = COALESCE(remarks, 'Exit request was ' || NEW.status),
        updated_at = now()
    WHERE exit_request_id = NEW.id
      AND status <> 'approved';
  END IF;
  RETURN NEW;
END;
$function$;

-- [DDL] function public.enforce_employee_update_restrictions() (add)
CREATE OR REPLACE FUNCTION public.enforce_employee_update_restrictions()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
  -- If there is no authenticated user (e.g. system/postgres session), allow the update
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- If actor is HR, allow the update to proceed
  IF public.is_hr() THEN
    RETURN NEW;
  END IF;

  -- Otherwise, verify that the employee is only updating their own row
  IF OLD.user_id IS DISTINCT FROM auth.uid() OR NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Forbidden: employees can only update their own profile';
  END IF;

  -- Verify that restricted columns have not changed
  IF OLD.id IS DISTINCT FROM NEW.id OR
     OLD.user_id IS DISTINCT FROM NEW.user_id OR
     OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR
     OLD.email IS DISTINCT FROM NEW.email OR
     OLD.full_name IS DISTINCT FROM NEW.full_name OR
     OLD.role IS DISTINCT FROM NEW.role OR
     OLD.status IS DISTINCT FROM NEW.status OR
     OLD.grade IS DISTINCT FROM NEW.grade OR
     OLD.manager_id IS DISTINCT FROM NEW.manager_id OR
     OLD.secondary_manager_id IS DISTINCT FROM NEW.secondary_manager_id OR
     OLD.org_unit_id IS DISTINCT FROM NEW.org_unit_id OR
     OLD.job_title_id IS DISTINCT FROM NEW.job_title_id OR
     OLD.location_id IS DISTINCT FROM NEW.location_id OR
     OLD.employment_type_id IS DISTINCT FROM NEW.employment_type_id OR
     OLD.date_of_joining IS DISTINCT FROM NEW.date_of_joining OR
     OLD.department IS DISTINCT FROM NEW.department OR
     OLD.designation IS DISTINCT FROM NEW.designation OR
     OLD.employment_confirmed_at IS DISTINCT FROM NEW.employment_confirmed_at OR
     OLD.probation_end_date IS DISTINCT FROM NEW.probation_end_date OR
     OLD.probation_status IS DISTINCT FROM NEW.probation_status OR
     OLD.created_by IS DISTINCT FROM NEW.created_by OR
     OLD.created_at IS DISTINCT FROM NEW.created_at
  THEN
    RAISE EXCEPTION 'Forbidden: employees cannot modify administrative profile fields (role, tenant, manager, status, grade, job details)';
  END IF;

  RETURN NEW;
END;
$function$;

-- [DDL] function public.complete_exit_transaction(p_request_id uuid) (add)
CREATE OR REPLACE FUNCTION public.complete_exit_transaction(p_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_request public.exit_requests%ROWTYPE;
  v_actor_employee_id uuid;
  v_blocking_clearance_count integer;
  v_employee_status text;
  v_new_employee_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF NOT public.is_hr() THEN
    RAISE EXCEPTION 'Forbidden: only HR can complete offboarding';
  END IF;

  SELECT *
  INTO v_request
  FROM public.exit_requests
  WHERE id = p_request_id
    AND tenant_id = public.get_auth_tenant_id()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exit request not found';
  END IF;

  IF v_request.status = 'completed' THEN
    RAISE EXCEPTION 'Exit request is already completed';
  END IF;

  IF v_request.status NOT IN ('notice_period', 'clearance_pending') THEN
    RAISE EXCEPTION 'Exit request must be in notice period or clearance pending before completion';
  END IF;

  SELECT id
  INTO v_actor_employee_id
  FROM public.employees
  WHERE user_id = auth.uid()
    AND tenant_id = v_request.tenant_id
  LIMIT 1;

  -- Block on required, non-cancelled clearance rows (from Release 6A)
  SELECT COUNT(*)
  INTO v_blocking_clearance_count
  FROM public.exit_clearances
  WHERE exit_request_id = p_request_id
    AND is_required = true
    AND status NOT IN ('approved', 'cancelled');

  IF v_blocking_clearance_count > 0 THEN
    RAISE EXCEPTION 'Cannot complete exit: % required clearance item(s) are still pending or rejected', v_blocking_clearance_count;
  END IF;

  -- Block on exit interview: require structured data to be present
  -- Old rows backfilled from exit_feedback are compatible.
  IF NOT (
    v_request.exit_interview_done = true
    AND coalesce(v_request.exit_interview_data, '{}'::jsonb) <> '{}'::jsonb
  ) THEN
    RAISE EXCEPTION 'Cannot complete exit: exit interview must be completed before final offboarding';
  END IF;

  -- Check employee's current status and update
  SELECT status INTO v_employee_status
  FROM public.employees
  WHERE id = v_request.employee_id
    AND tenant_id = v_request.tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee record not found';
  END IF;

  v_new_employee_status := v_employee_status;

  IF v_employee_status = 'active' THEN
    UPDATE public.employees
    SET status = 'inactive',
        updated_at = now()
    WHERE id = v_request.employee_id
      AND tenant_id = v_request.tenant_id;
    v_new_employee_status := 'inactive';
  END IF;

  UPDATE public.exit_requests
  SET status = 'completed',
      updated_at = now()
  WHERE id = p_request_id
    AND tenant_id = v_request.tenant_id;

  INSERT INTO public.audit_logs (
    tenant_id,
    actor_id,
    actor_role,
    action,
    target_type,
    target_id,
    details,
    status
  )
  VALUES (
    v_request.tenant_id,
    v_actor_employee_id,
    'hr',
    'offboarding.completed',
    'exit_requests',
    p_request_id,
    jsonb_build_object(
      'employee_id', v_request.employee_id,
      'previous_exit_status', v_request.status,
      'previous_employee_status', v_employee_status,
      'new_employee_status', v_new_employee_status,
      'employee_already_inactive', (v_employee_status = 'inactive'),
      'employee_already_terminated', (v_employee_status = 'terminated'),
      'warning', CASE
        WHEN v_employee_status = 'terminated'
        THEN 'Employee was already terminated before offboarding completion; exit request was completed for workflow reconciliation.'
        ELSE NULL
      END
    ),
    'success'
  );
END;
$function$;

-- [DDL] function public.acknowledge_policy_transaction(p_policy_id uuid) (add)
CREATE OR REPLACE FUNCTION public.acknowledge_policy_transaction(p_policy_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_employee_id uuid;
  v_visible boolean := false;
  v_new_ack_id uuid;
BEGIN
  -- Auth check
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Unauthorized';
  END IF;

  v_tenant_id := public.get_auth_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Tenant scope missing';
  END IF;

  -- Get current employee's info
  SELECT e.id
  INTO v_employee_id
  FROM public.employees e
  WHERE e.user_id = auth.uid()
    AND e.tenant_id = v_tenant_id
  LIMIT 1;

  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Employee profile not found';
  END IF;

  -- Verify policy visibility to this employee
  SELECT EXISTS (
    SELECT 1
    FROM public.hr_policies p
    JOIN public.employees e ON e.id = v_employee_id
    WHERE p.id = p_policy_id
      AND p.tenant_id = v_tenant_id
      AND (
        p.visible_to = 'all'
        OR (
          p.visible_to = 'department-specific'
          AND (
            (p.org_unit_id IS NOT NULL AND p.org_unit_id = e.org_unit_id)
            OR
            (p.org_unit_id IS NULL AND p.department_filter = e.department)
          )
        )
      )
  ) INTO v_visible;

  IF NOT v_visible THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Policy not visible to this employee';
  END IF;

  -- Insert acknowledgement with duplicate check
  INSERT INTO public.employee_policy_acknowledgements (
    tenant_id,
    policy_id,
    employee_id,
    acknowledged_at,
    acknowledgement_text
  ) VALUES (
    v_tenant_id,
    p_policy_id,
    v_employee_id,
    now(),
    'Acknowledged electronically'
  )
  ON CONFLICT (tenant_id, policy_id, employee_id) DO NOTHING
  RETURNING id INTO v_new_ack_id;

  IF v_new_ack_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_POLICY_VALUE: Policy already acknowledged';
  END IF;

  -- Log action
  INSERT INTO public.audit_logs (
    tenant_id,
    action,
    target_type,
    target_id,
    actor_id,
    metadata
  ) VALUES (
    v_tenant_id,
    'policy.acknowledged',
    'hr_policy',
    p_policy_id,
    v_employee_id,
    jsonb_build_object('policy_id', p_policy_id)
  );

  RETURN jsonb_build_object('acknowledged', true);
END;
$function$;

-- [DDL] function public.initialize_leave_balances_transaction(p_year integer) (add)
CREATE OR REPLACE FUNCTION public.initialize_leave_balances_transaction(p_year integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_auth_tenant_id uuid;
  v_actor_id uuid;
  v_now timestamptz := now();
  v_timezone text;
  v_balances_created integer := 0;
  
  v_emp_row record;
  v_lt_row record;
  v_prorated_balance numeric;
BEGIN
  -- 1. Auth check
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Unauthorized';
  END IF;

  IF NOT public.is_hr() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Only HR can initialize leave balances';
  END IF;

  -- 2. Tenant scope check
  v_auth_tenant_id := public.get_auth_tenant_id();
  IF v_auth_tenant_id IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Tenant scope missing';
  END IF;

  -- 3. Get actor employee id for audit log
  SELECT id INTO v_actor_id
  FROM public.employees e
  WHERE e.user_id = auth.uid()
    AND e.tenant_id = v_auth_tenant_id
  LIMIT 1;

  -- 4. Get tenant timezone
  SELECT timezone INTO v_timezone
  FROM public.tenants
  WHERE id = v_auth_tenant_id;

  -- 5. Seed missing combinations
  FOR v_lt_row IN
    SELECT id, days_per_year, accrual_type
    FROM public.leave_types
    WHERE tenant_id = v_auth_tenant_id AND is_active = true
  LOOP
    v_prorated_balance := public.compute_initial_leave_balance(v_lt_row.days_per_year, v_lt_row.accrual_type, p_year, v_timezone);
    
    FOR v_emp_row IN
      SELECT id FROM public.employees
      WHERE tenant_id = v_auth_tenant_id AND status = 'active'
    LOOP
      -- Check if balance already exists
      IF NOT EXISTS (
        SELECT 1 FROM public.leave_balances
        WHERE tenant_id = v_auth_tenant_id
          AND employee_id = v_emp_row.id
          AND leave_type_id = v_lt_row.id
          AND year = p_year
      ) THEN
        INSERT INTO public.leave_balances (
          tenant_id, employee_id, leave_type_id, year,
          total_allocated, carried_forward, used_days, pending_days, balance, updated_at
        ) VALUES (
          v_auth_tenant_id,
          v_emp_row.id,
          v_lt_row.id,
          p_year,
          v_lt_row.days_per_year,
          0.00,
          0.00,
          0.00,
          v_prorated_balance,
          v_now
        );
        v_balances_created := v_balances_created + 1;
      END IF;
    END LOOP;
  END LOOP;

  -- Write Audit Log
  INSERT INTO public.audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details, status)
  VALUES (
    v_auth_tenant_id,
    v_actor_id,
    'hr',
    'leave_balances.initialized',
    'tenant',
    v_auth_tenant_id,
    jsonb_build_object('year', p_year, 'balances_created', v_balances_created),
    'success'
  );

  RETURN jsonb_build_object(
    'balances_created', v_balances_created
  );
END;
$function$;

-- [DDL] function public.create_policy_notifications_transaction(p_policy_id uuid) (add)
CREATE OR REPLACE FUNCTION public.create_policy_notifications_transaction(p_policy_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_actor_id uuid;
  v_policy_title text;
  v_visible_to text;
  v_department_filter text;
  v_org_unit_id uuid;
  v_org_unit_name text;
  v_title_prefix text;
  v_inserted_count integer := 0;
BEGIN
  -- Auth check
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Unauthorized';
  END IF;

  IF NOT public.is_hr() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Only HR can trigger notifications';
  END IF;

  v_tenant_id := public.get_auth_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Tenant scope missing';
  END IF;

  -- Get policy metadata
  SELECT p.title, p.visible_to, p.department_filter, p.org_unit_id, ou.name
  INTO v_policy_title, v_visible_to, v_department_filter, v_org_unit_id, v_org_unit_name
  FROM public.hr_policies p
  LEFT JOIN public.org_units ou ON p.org_unit_id = ou.id
  WHERE p.id = p_policy_id AND p.tenant_id = v_tenant_id;

  IF v_policy_title IS NULL THEN
    RAISE EXCEPTION 'INVALID_POLICY_VALUE: Policy not found';
  END IF;

  -- Get actor employee id for audit log
  SELECT e.id INTO v_actor_id
  FROM public.employees e
  WHERE e.user_id = auth.uid() AND e.tenant_id = v_tenant_id
  LIMIT 1;

  -- Determine title prefix
  IF v_visible_to = 'all' THEN
    v_title_prefix := 'New Company Policy:';
  ELSIF v_visible_to = 'hr_only' THEN
    v_title_prefix := 'New HR-Only Policy:';
  ELSE
    IF v_org_unit_id IS NOT NULL THEN
      v_title_prefix := 'New Policy for ' || coalesce(v_org_unit_name, 'Org Unit') || ':';
    ELSE
      v_title_prefix := 'New Policy for ' || coalesce(v_department_filter, 'Department') || ':';
    END IF;
  END IF;

  -- Insert notifications in a server-side batch
  WITH inserted_rows AS (
    INSERT INTO public.notifications (tenant_id, employee_id, title, body, type)
    SELECT 
      v_tenant_id,
      e.id,
      'New HR Policy Document',
      v_title_prefix || ' ' || v_policy_title,
      'new_policy'
    FROM public.employees e
    WHERE e.tenant_id = v_tenant_id
      AND e.status = 'active'
      AND (
        v_visible_to = 'all'
        OR (v_visible_to = 'hr_only' AND e.department = 'operations')
        OR (
          v_visible_to = 'department-specific'
          AND (
            (v_org_unit_id IS NOT NULL AND e.org_unit_id = v_org_unit_id)
            OR
            (v_org_unit_id IS NULL AND v_department_filter IS NOT NULL AND e.department = v_department_filter)
          )
        )
      )
    RETURNING id
  )
  SELECT count(*) INTO v_inserted_count FROM inserted_rows;

  -- Log action
  INSERT INTO public.audit_logs (
    tenant_id,
    action,
    target_type,
    target_id,
    actor_id,
    metadata
  ) VALUES (
    v_tenant_id,
    'policy.notified',
    'hr_policy',
    p_policy_id,
    v_actor_id,
    jsonb_build_object('policy_id', p_policy_id, 'notification_count', v_inserted_count)
  );

  RETURN jsonb_build_object('count', v_inserted_count);
END;
$function$;

-- [DDL] function public.get_employee_visible_hr_policies(p_search text, p_limit integer, p_offset integer) (add)
CREATE OR REPLACE FUNCTION public.get_employee_visible_hr_policies(p_search text DEFAULT NULL::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, tenant_id uuid, title text, description text, file_url text, file_name text, visible_to text, department_filter text, org_unit_id uuid, org_unit_name text, storage_path text, version_number integer, effective_date date, expires_at timestamp with time zone, requires_acknowledgement boolean, supersedes_policy_id uuid, created_at timestamp with time zone, updated_at timestamp with time zone, acknowledged_at timestamp with time zone, total_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_employee_department text;
  v_employee_org_unit_id uuid;
  v_employee_id uuid;
BEGIN
  -- Get active tenant context
  v_tenant_id := public.get_auth_tenant_id();
  IF v_tenant_id IS NULL THEN
    RETURN;
  END IF;

  -- Get current employee's info
  SELECT e.id, e.department, e.org_unit_id
  INTO v_employee_id, v_employee_department, v_employee_org_unit_id
  FROM public.employees e
  WHERE e.user_id = auth.uid()
    AND e.tenant_id = v_tenant_id
  LIMIT 1;

  RETURN QUERY
  WITH visible_policies AS (
    SELECT 
      p.id,
      p.tenant_id,
      p.title,
      p.description,
      p.file_url,
      p.file_name,
      p.visible_to,
      p.department_filter,
      p.org_unit_id,
      ou.name AS org_unit_name,
      p.storage_path,
      p.version_number,
      p.effective_date,
      p.expires_at,
      p.requires_acknowledgement,
      p.supersedes_policy_id,
      p.created_at,
      p.updated_at
    FROM public.hr_policies p
    LEFT JOIN public.org_units ou ON p.org_unit_id = ou.id
    WHERE p.tenant_id = v_tenant_id
      AND (
        p.visible_to = 'all'
        OR (
          p.visible_to = 'department-specific'
          AND (
            (p.org_unit_id IS NOT NULL AND p.org_unit_id = v_employee_org_unit_id)
            OR
            (p.org_unit_id IS NULL AND p.department_filter = v_employee_department)
          )
        )
      )
      AND (p_search IS NULL OR p_search = '' OR p.title ILIKE '%' || p_search || '%')
  ),
  count_total AS (
    SELECT count(*) AS total FROM visible_policies
  )
  SELECT 
    vp.id,
    vp.tenant_id,
    vp.title,
    vp.description,
    vp.file_url,
    vp.file_name,
    vp.visible_to,
    vp.department_filter,
    vp.org_unit_id,
    vp.org_unit_name,
    vp.storage_path,
    vp.version_number,
    vp.effective_date,
    vp.expires_at,
    vp.requires_acknowledgement,
    vp.supersedes_policy_id,
    vp.created_at,
    vp.updated_at,
    epa.acknowledged_at,
    ct.total
  FROM visible_policies vp
  LEFT JOIN public.employee_policy_acknowledgements epa 
    ON vp.id = epa.policy_id AND epa.employee_id = v_employee_id
  CROSS JOIN count_total ct
  ORDER BY vp.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$;

-- [DDL] function public.get_hr_policy_library(p_search text, p_visibility text, p_limit integer, p_offset integer) (add)
CREATE OR REPLACE FUNCTION public.get_hr_policy_library(p_search text DEFAULT NULL::text, p_visibility text DEFAULT NULL::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, tenant_id uuid, title text, description text, file_url text, file_name text, visible_to text, department_filter text, org_unit_id uuid, org_unit_name text, storage_path text, version_number integer, effective_date date, expires_at timestamp with time zone, requires_acknowledgement boolean, supersedes_policy_id uuid, created_at timestamp with time zone, updated_at timestamp with time zone, acknowledged_count bigint, total_targeted bigint, total_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant_id uuid;
BEGIN
  -- Auth check
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Unauthorized';
  END IF;

  IF NOT public.is_hr() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Only HR can view policy library';
  END IF;

  v_tenant_id := public.get_auth_tenant_id();
  IF v_tenant_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH filtered_policies AS (
    SELECT 
      p.id,
      p.tenant_id,
      p.title,
      p.description,
      p.file_url,
      p.file_name,
      p.visible_to,
      p.department_filter,
      p.org_unit_id,
      ou.name AS org_unit_name,
      p.storage_path,
      p.version_number,
      p.effective_date,
      p.expires_at,
      p.requires_acknowledgement,
      p.supersedes_policy_id,
      p.created_at,
      p.updated_at
    FROM public.hr_policies p
    LEFT JOIN public.org_units ou ON p.org_unit_id = ou.id
    WHERE p.tenant_id = v_tenant_id
      AND (p_search IS NULL OR p_search = '' OR p.title ILIKE '%' || p_search || '%')
      AND (p_visibility IS NULL OR p_visibility = '' OR p_visibility = 'all_types' OR p.visible_to = p_visibility)
  ),
  stats AS (
    SELECT 
      fp.id,
      (
        SELECT count(*) 
        FROM public.employee_policy_acknowledgements epa 
        WHERE epa.policy_id = fp.id AND epa.tenant_id = v_tenant_id
      ) AS ack_count,
      (
        SELECT count(*)
        FROM public.employees e
        WHERE e.tenant_id = v_tenant_id
          AND e.status = 'active'
          AND (
            fp.visible_to = 'all'
            OR (fp.visible_to = 'hr_only' AND e.department = 'operations')
            OR (
              fp.visible_to = 'department-specific'
              AND (
                (fp.org_unit_id IS NOT NULL AND e.org_unit_id = fp.org_unit_id)
                OR
                (fp.org_unit_id IS NULL AND fp.department_filter IS NOT NULL AND e.department = fp.department_filter)
              )
            )
          )
      ) AS target_count
    FROM filtered_policies fp
  ),
  count_total AS (
    SELECT count(*) AS total FROM filtered_policies
  )
  SELECT 
    fp.id,
    fp.tenant_id,
    fp.title,
    fp.description,
    fp.file_url,
    fp.file_name,
    fp.visible_to,
    fp.department_filter,
    fp.org_unit_id,
    fp.org_unit_name,
    fp.storage_path,
    fp.version_number,
    fp.effective_date,
    fp.expires_at,
    fp.requires_acknowledgement,
    fp.supersedes_policy_id,
    fp.created_at,
    fp.updated_at,
    s.ack_count,
    s.target_count,
    ct.total
  FROM filtered_policies fp
  JOIN stats s ON fp.id = s.id
  CROSS JOIN count_total ct
  ORDER BY fp.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$;

-- [DDL] function public.deactivate_leave_type_transaction(p_leave_type_id uuid, p_expected_updated_at timestamp with time zone) (add)
CREATE OR REPLACE FUNCTION public.deactivate_leave_type_transaction(p_leave_type_id uuid, p_expected_updated_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_auth_tenant_id uuid;
  v_actor_id uuid;
  v_now timestamptz := now();
  v_existing_updated_at timestamptz;
BEGIN
  -- 1. Auth check
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Unauthorized';
  END IF;

  IF NOT public.is_hr() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Only HR can deactivate leave types';
  END IF;

  -- 2. Tenant scope check
  v_auth_tenant_id := public.get_auth_tenant_id();
  IF v_auth_tenant_id IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Tenant scope missing';
  END IF;

  -- 3. Get actor employee id for audit log
  SELECT id INTO v_actor_id
  FROM public.employees e
  WHERE e.user_id = auth.uid()
    AND e.tenant_id = v_auth_tenant_id
  LIMIT 1;

  -- 4. Lock row and stale check
  SELECT updated_at INTO v_existing_updated_at
  FROM public.leave_types
  WHERE id = p_leave_type_id AND tenant_id = v_auth_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_POLICY_VALUE: Leave type not found';
  END IF;

  IF p_expected_updated_at IS NOT NULL AND v_existing_updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_WRITE: Leave type was modified by another session. Please refresh.';
  END IF;

  -- 5. Update leave type
  UPDATE public.leave_types
  SET is_active = false,
      updated_at = v_now
  WHERE id = p_leave_type_id AND tenant_id = v_auth_tenant_id;

  -- Write Audit Log
  INSERT INTO public.audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details, status)
  VALUES (
    v_auth_tenant_id,
    v_actor_id,
    'hr',
    'leave_type.deactivated',
    'leave_type',
    p_leave_type_id,
    jsonb_build_object('id', p_leave_type_id),
    'success'
  );

  RETURN jsonb_build_object(
    'leave_type_id', p_leave_type_id,
    'updated_at', v_now
  );
END;
$function$;

-- [DDL] function public.update_exit_interview_transaction(p_request_id uuid, p_exit_interview_data jsonb, p_exit_feedback text) (add)
CREATE OR REPLACE FUNCTION public.update_exit_interview_transaction(p_request_id uuid, p_exit_interview_data jsonb, p_exit_feedback text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_request public.exit_requests%ROWTYPE;
  v_actor_employee_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF NOT public.is_hr() THEN
    RAISE EXCEPTION 'Forbidden: only HR can submit exit interviews';
  END IF;

  SELECT *
  INTO v_request
  FROM public.exit_requests
  WHERE id = p_request_id
    AND tenant_id = public.get_auth_tenant_id()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exit request not found';
  END IF;

  IF v_request.status IN ('completed', 'rejected', 'withdrawn') THEN
    RAISE EXCEPTION 'Cannot update exit interview: request status is %', v_request.status;
  END IF;

  SELECT id
  INTO v_actor_employee_id
  FROM public.employees
  WHERE user_id = auth.uid()
    AND tenant_id = v_request.tenant_id
  LIMIT 1;

  UPDATE public.exit_requests
  SET exit_interview_data       = p_exit_interview_data,
      exit_feedback             = p_exit_feedback,
      exit_interview_done       = true,
      exit_interview_completed_at = now(),
      exit_interview_completed_by = v_actor_employee_id,
      updated_at                = now()
  WHERE id = p_request_id
    AND tenant_id = v_request.tenant_id;

  INSERT INTO public.audit_logs (
    tenant_id,
    actor_id,
    actor_role,
    action,
    target_type,
    target_id,
    details,
    status
  )
  VALUES (
    v_request.tenant_id,
    v_actor_employee_id,
    'hr',
    'offboarding.exit_interview_completed',
    'exit_requests',
    p_request_id,
    jsonb_build_object(
      'employee_id', v_request.employee_id,
      'primary_reason', p_exit_interview_data ->> 'primary_reason',
      'risk_level', p_exit_interview_data ->> 'risk_level',
      'rehire_eligible', p_exit_interview_data -> 'rehire_eligible'
    ),
    'success'
  );
END;
$function$;

-- [DDL] function public.update_exit_clearance_transaction(p_request_id uuid, p_department text, p_approved boolean, p_remarks text) (add)
CREATE OR REPLACE FUNCTION public.update_exit_clearance_transaction(p_request_id uuid, p_department text, p_approved boolean, p_remarks text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_request public.exit_requests%ROWTYPE;
  v_updated_request public.exit_requests%ROWTYPE;
  v_actor_employee_id uuid;
  v_department text;
  v_template public.exit_clearance_templates%ROWTYPE;
  v_pending_clearance_count integer;
  v_new_status text;
  v_clearances jsonb;
  v_is_required boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF NOT public.is_hr() THEN
    RAISE EXCEPTION 'Forbidden: only HR can update exit clearances';
  END IF;

  v_department := lower(trim(p_department));

  IF v_department NOT IN ('assets', 'it', 'finance', 'hr', 'admin') THEN
    RAISE EXCEPTION 'Unsupported clearance department: %', p_department;
  END IF;

  SELECT *
  INTO v_request
  FROM public.exit_requests
  WHERE id = p_request_id
    AND tenant_id = public.get_auth_tenant_id()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exit request not found';
  END IF;

  IF v_request.status NOT IN ('notice_period', 'clearance_pending') THEN
    RAISE EXCEPTION 'Exit request must be in notice period or clearance pending before clearances can be updated';
  END IF;

  SELECT id
  INTO v_actor_employee_id
  FROM public.employees
  WHERE user_id = auth.uid()
    AND tenant_id = v_request.tenant_id
  LIMIT 1;

  SELECT *
  INTO v_template
  FROM public.exit_clearance_templates
  WHERE tenant_id = v_request.tenant_id
    AND department = v_department
  ORDER BY is_active DESC, sort_order ASC, created_at ASC
  LIMIT 1;

  -- Snapshot is_required from template; default true if no template found
  v_is_required := COALESCE(v_template.is_required, true);

  INSERT INTO public.exit_clearances (
    tenant_id,
    exit_request_id,
    template_id,
    department,
    label,
    status,
    approved_by,
    approved_at,
    remarks,
    is_required
  )
  VALUES (
    v_request.tenant_id,
    p_request_id,
    v_template.id,
    v_department,
    COALESCE(v_template.label, initcap(v_department || ' clearance')),
    CASE WHEN p_approved THEN 'approved' ELSE 'pending' END,
    CASE WHEN p_approved THEN v_actor_employee_id ELSE NULL END,
    CASE WHEN p_approved THEN now() ELSE NULL END,
    p_remarks,
    v_is_required
  )
  ON CONFLICT (exit_request_id, department)
  DO UPDATE SET
    status = EXCLUDED.status,
    approved_by = EXCLUDED.approved_by,
    approved_at = EXCLUDED.approved_at,
    remarks = COALESCE(EXCLUDED.remarks, public.exit_clearances.remarks),
    template_id = COALESCE(public.exit_clearances.template_id, EXCLUDED.template_id),
    label = COALESCE(public.exit_clearances.label, EXCLUDED.label),
    -- Preserve existing is_required snapshot; do not overwrite if row already exists
    is_required = COALESCE(public.exit_clearances.is_required, EXCLUDED.is_required),
    updated_at = now();

  UPDATE public.exit_requests
  SET clearance_assets = CASE WHEN v_department = 'assets' THEN p_approved ELSE clearance_assets END,
      clearance_it = CASE WHEN v_department = 'it' THEN p_approved ELSE clearance_it END,
      clearance_finance = CASE WHEN v_department = 'finance' THEN p_approved ELSE clearance_finance END,
      clearance_hr = CASE WHEN v_department = 'hr' THEN p_approved ELSE clearance_hr END,
      clearance_admin = CASE WHEN v_department = 'admin' THEN p_approved ELSE clearance_admin END,
      updated_at = now()
  WHERE id = p_request_id
    AND tenant_id = v_request.tenant_id
  RETURNING * INTO v_updated_request;

  -- Count pending using only required, non-cancelled rows
  SELECT COUNT(*)
  INTO v_pending_clearance_count
  FROM public.exit_clearances
  WHERE exit_request_id = p_request_id
    AND is_required = true
    AND status NOT IN ('approved', 'cancelled');

  IF v_pending_clearance_count = 0 THEN
    v_new_status := 'clearance_pending';
  ELSIF v_updated_request.status = 'clearance_pending' THEN
    v_new_status := 'notice_period';
  ELSE
    v_new_status := v_updated_request.status;
  END IF;

  IF v_new_status <> v_updated_request.status THEN
    UPDATE public.exit_requests
    SET status = v_new_status,
        updated_at = now()
    WHERE id = p_request_id
      AND tenant_id = v_request.tenant_id
    RETURNING * INTO v_updated_request;
  END IF;

  INSERT INTO public.audit_logs (
    tenant_id,
    actor_id,
    actor_role,
    action,
    target_type,
    target_id,
    details,
    status
  )
  VALUES (
    v_request.tenant_id,
    v_actor_employee_id,
    'hr',
    'offboarding.clearance_updated',
    'exit_requests',
    p_request_id,
    jsonb_build_object(
      'department', v_department,
      'approved', p_approved,
      'is_required', v_is_required,
      'previous_exit_status', v_request.status,
      'new_exit_status', v_updated_request.status
    ),
    'success'
  );

  SELECT COALESCE(jsonb_agg(to_jsonb(ec) ORDER BY ec.created_at ASC), '[]'::jsonb)
  INTO v_clearances
  FROM public.exit_clearances ec
  WHERE ec.exit_request_id = p_request_id
    AND ec.tenant_id = v_request.tenant_id;

  RETURN jsonb_build_object(
    'exit_request', to_jsonb(v_updated_request),
    'clearances', v_clearances
  );
END;
$function$;

-- [DDL] function public.save_leave_type_transaction(p_leave_type_id uuid, p_expected_updated_at timestamp with time zone, p_payload jsonb) (add)
CREATE OR REPLACE FUNCTION public.save_leave_type_transaction(p_leave_type_id uuid, p_expected_updated_at timestamp with time zone, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_auth_tenant_id uuid;
  v_actor_id uuid;
  v_now timestamptz := now();
  v_old_updated_at timestamptz;
  v_old_days_per_year numeric;
  v_old_accrual_type text;
  v_new_id uuid;
  v_new_updated_at timestamptz;
  
  v_name text;
  v_code text;
  v_days_per_year numeric;
  v_accrual_type text;
  v_carry_forward_enabled boolean;
  v_carry_forward_max_days numeric;
  v_encashment_enabled boolean;
  v_applicable_from_day integer;
  v_probation_restricted boolean;
  v_requires_document boolean;
  v_min_notice_days integer;
  v_max_consecutive_days integer;
  v_is_active boolean;
  v_is_paid boolean;
  
  v_timezone text;
  v_target_year integer;
  v_prorated_balance numeric;
  v_balances_created integer := 0;
  v_balances_updated integer := 0;
  
  v_emp_row record;
  v_bal_row record;
  v_new_balance numeric;
BEGIN
  -- 1. Auth check
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Unauthorized';
  END IF;

  IF NOT public.is_hr() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Only HR can save leave types';
  END IF;

  -- 2. Tenant scope check
  v_auth_tenant_id := public.get_auth_tenant_id();
  IF v_auth_tenant_id IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Tenant scope missing';
  END IF;

  -- 3. Get actor employee id for audit log
  SELECT id INTO v_actor_id
  FROM public.employees e
  WHERE e.user_id = auth.uid()
    AND e.tenant_id = v_auth_tenant_id
  LIMIT 1;

  -- 4. Get tenant timezone
  SELECT timezone INTO v_timezone
  FROM public.tenants
  WHERE id = v_auth_tenant_id;

  v_target_year := extract(year from timezone(v_timezone, now()))::integer;

  -- 5. Extract and Validate payload fields
  v_name := trim(p_payload->>'name');
  v_code := upper(trim(p_payload->>'code'));
  v_days_per_year := (p_payload->>'days_per_year')::numeric;
  v_accrual_type := p_payload->>'accrual_type';
  v_carry_forward_enabled := (p_payload->>'carry_forward_enabled')::boolean;
  v_carry_forward_max_days := coalesce((p_payload->>'carry_forward_max_days')::numeric, 0);
  v_encashment_enabled := (p_payload->>'encashment_enabled')::boolean;
  v_applicable_from_day := coalesce((p_payload->>'applicable_from_day')::integer, 0);
  v_probation_restricted := (p_payload->>'probation_restricted')::boolean;
  v_requires_document := (p_payload->>'requires_document')::boolean;
  v_min_notice_days := coalesce((p_payload->>'min_notice_days')::integer, 0);
  v_max_consecutive_days := (p_payload->>'max_consecutive_days')::integer;
  v_is_active := (p_payload->>'is_active')::boolean;
  v_is_paid := (p_payload->>'is_paid')::boolean;

  IF v_name = '' THEN
    RAISE EXCEPTION 'INVALID_POLICY_VALUE: Name cannot be empty';
  END IF;

  IF v_code = '' OR length(v_code) > 5 THEN
    RAISE EXCEPTION 'INVALID_POLICY_VALUE: Code must be non-empty and max 5 characters';
  END IF;

  IF v_days_per_year < 0 THEN
    RAISE EXCEPTION 'INVALID_POLICY_VALUE: Days per year must be non-negative';
  END IF;

  IF v_accrual_type NOT IN ('lump_sum', 'monthly') THEN
    RAISE EXCEPTION 'INVALID_POLICY_VALUE: Accrual type must be lump_sum or monthly';
  END IF;

  IF v_applicable_from_day < 0 THEN
    RAISE EXCEPTION 'INVALID_POLICY_VALUE: Applicable after days must be non-negative';
  END IF;

  IF v_min_notice_days < 0 THEN
    RAISE EXCEPTION 'INVALID_POLICY_VALUE: Minimum notice days must be non-negative';
  END IF;

  IF v_carry_forward_max_days < 0 THEN
    RAISE EXCEPTION 'INVALID_POLICY_VALUE: Carry forward max days must be non-negative';
  END IF;

  -- Enforce active duplicate name/code check
  IF v_is_active THEN
    IF EXISTS (
      SELECT 1 FROM public.leave_types
      WHERE tenant_id = v_auth_tenant_id
        AND is_active = true
        AND (lower(name) = lower(v_name) OR lower(code) = lower(v_code))
        AND (p_leave_type_id IS NULL OR id <> p_leave_type_id)
    ) THEN
      RAISE EXCEPTION 'INVALID_POLICY_VALUE: An active leave type with this name or code already exists';
    END IF;
  END IF;

  -- 6. Lock row and check stale versions if editing
  IF p_leave_type_id IS NOT NULL THEN
    SELECT updated_at, days_per_year, accrual_type 
    INTO v_old_updated_at, v_old_days_per_year, v_old_accrual_type
    FROM public.leave_types
    WHERE id = p_leave_type_id AND tenant_id = v_auth_tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'INVALID_POLICY_VALUE: Leave type not found';
    END IF;

    IF p_expected_updated_at IS NOT NULL AND v_old_updated_at IS DISTINCT FROM p_expected_updated_at THEN
      RAISE EXCEPTION 'STALE_WRITE: Leave type was modified by another session. Please refresh.';
    END IF;
  END IF;

  -- 7. Insert or Update leave type
  IF p_leave_type_id IS NULL THEN
    INSERT INTO public.leave_types (
      tenant_id, name, code, days_per_year, accrual_type,
      carry_forward_enabled, carry_forward_max_days, encashment_enabled,
      applicable_from_day, probation_restricted, requires_document,
      min_notice_days, max_consecutive_days, is_active, is_paid, sort_order, updated_at
    ) VALUES (
      v_auth_tenant_id,
      v_name,
      v_code,
      v_days_per_year,
      v_accrual_type,
      v_carry_forward_enabled,
      v_carry_forward_max_days,
      v_encashment_enabled,
      v_applicable_from_day,
      v_probation_restricted,
      v_requires_document,
      v_min_notice_days,
      v_max_consecutive_days,
      v_is_active,
      v_is_paid,
      coalesce((SELECT max(sort_order) FROM public.leave_types WHERE tenant_id = v_auth_tenant_id), 0) + 1,
      v_now
    ) RETURNING id, updated_at INTO v_new_id, v_new_updated_at;

    -- If creating an active leave type, auto-initialize balances
    IF v_is_active THEN
      v_prorated_balance := public.compute_initial_leave_balance(v_days_per_year, v_accrual_type, v_target_year, v_timezone);
      
      FOR v_emp_row IN 
        SELECT id FROM public.employees 
        WHERE tenant_id = v_auth_tenant_id AND status = 'active'
      LOOP
        INSERT INTO public.leave_balances (
          tenant_id, employee_id, leave_type_id, year,
          total_allocated, carried_forward, used_days, pending_days, balance, updated_at
        ) VALUES (
          v_auth_tenant_id,
          v_emp_row.id,
          v_new_id,
          v_target_year,
          v_days_per_year,
          0.00,
          0.00,
          0.00,
          v_prorated_balance,
          v_now
        ) ON CONFLICT (tenant_id, employee_id, leave_type_id, year) DO NOTHING;
        
        IF FOUND THEN
          v_balances_created := v_balances_created + 1;
        END IF;
      END LOOP;
    END IF;

    -- Write Audit Log
    INSERT INTO public.audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details, status)
    VALUES (
      v_auth_tenant_id,
      v_actor_id,
      'hr',
      'leave_type.created',
      'leave_type',
      v_new_id,
      jsonb_build_object('name', v_name),
      'success'
    );

  ELSE
    UPDATE public.leave_types
    SET
      name = v_name,
      code = v_code,
      days_per_year = v_days_per_year,
      accrual_type = v_accrual_type,
      carry_forward_enabled = v_carry_forward_enabled,
      carry_forward_max_days = v_carry_forward_max_days,
      encashment_enabled = v_encashment_enabled,
      applicable_from_day = v_applicable_from_day,
      probation_restricted = v_probation_restricted,
      requires_document = v_requires_document,
      min_notice_days = v_min_notice_days,
      max_consecutive_days = v_max_consecutive_days,
      is_active = v_is_active,
      is_paid = v_is_paid,
      updated_at = v_now
    WHERE id = p_leave_type_id AND tenant_id = v_auth_tenant_id
    RETURNING id, updated_at INTO v_new_id, v_new_updated_at;

    -- If editing days_per_year or accrual_type, recalculate current year balances
    IF v_old_days_per_year IS DISTINCT FROM v_days_per_year OR v_old_accrual_type IS DISTINCT FROM v_accrual_type THEN
      v_prorated_balance := public.compute_initial_leave_balance(v_days_per_year, v_accrual_type, v_target_year, v_timezone);
      
      FOR v_bal_row IN
        SELECT id, used_days, pending_days, carried_forward
        FROM public.leave_balances
        WHERE tenant_id = v_auth_tenant_id
          AND leave_type_id = p_leave_type_id
          AND year = v_target_year
      LOOP
        v_new_balance := greatest(0.00, round((v_prorated_balance - coalesce(v_bal_row.used_days, 0) - coalesce(v_bal_row.pending_days, 0) + coalesce(v_bal_row.carried_forward, 0)), 2));
        
        UPDATE public.leave_balances
        SET
          total_allocated = v_days_per_year,
          balance = v_new_balance,
          updated_at = v_now
        WHERE id = v_bal_row.id;
        
        v_balances_updated := v_balances_updated + 1;
      END LOOP;
    END IF;

    -- Write Audit Log
    INSERT INTO public.audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details, status)
    VALUES (
      v_auth_tenant_id,
      v_actor_id,
      'hr',
      'leave_type.updated',
      'leave_type',
      p_leave_type_id,
      jsonb_build_object('name', v_name),
      'success'
    );
  END IF;

  RETURN jsonb_build_object(
    'leave_type_id', v_new_id,
    'updated_at', v_new_updated_at,
    'balances_created', v_balances_created,
    'balances_updated', v_balances_updated
  );
END;
$function$;

-- [DDL] function public.update_employee_reporting_relationship(p_employee_id uuid, p_primary_manager_id uuid, p_secondary_manager_id uuid) (add)
CREATE OR REPLACE FUNCTION public.update_employee_reporting_relationship(p_employee_id uuid, p_primary_manager_id uuid, p_secondary_manager_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_employee_id uuid;
  v_tenant_id uuid;
  v_old_primary_manager_id uuid;
  v_old_secondary_manager_id uuid;
  v_today date := CURRENT_DATE;
BEGIN
  -- Security check: user must be authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Security check: user must be HR
  IF NOT public.is_hr() THEN
    RAISE EXCEPTION 'Forbidden: only HR can update reporting relationships';
  END IF;

  -- Resolve tenant ID and check matching tenant scope
  SELECT tenant_id, manager_id, secondary_manager_id
  INTO v_tenant_id, v_old_primary_manager_id, v_old_secondary_manager_id
  FROM public.employees
  WHERE id = p_employee_id
    AND tenant_id = public.get_auth_tenant_id()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  -- Get active employee ID of the actor (HR specialist)
  SELECT id
  INTO v_actor_employee_id
  FROM public.employees
  WHERE user_id = auth.uid()
    AND tenant_id = v_tenant_id
  LIMIT 1;

  -- Basic self-reports validations:
  IF p_primary_manager_id = p_employee_id THEN
    RAISE EXCEPTION 'An employee cannot be their own primary manager';
  END IF;

  IF p_secondary_manager_id = p_employee_id THEN
    RAISE EXCEPTION 'An employee cannot be their own secondary manager';
  END IF;

  IF p_primary_manager_id IS NOT NULL AND p_secondary_manager_id IS NOT NULL AND p_primary_manager_id = p_secondary_manager_id THEN
    RAISE EXCEPTION 'Primary and secondary managers cannot be the same person';
  END IF;

  -- Verify manager tenants
  IF p_primary_manager_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_primary_manager_id AND tenant_id = v_tenant_id) THEN
      RAISE EXCEPTION 'Primary manager must belong to the same tenant';
    END IF;
  END IF;

  IF p_secondary_manager_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_secondary_manager_id AND tenant_id = v_tenant_id) THEN
      RAISE EXCEPTION 'Secondary manager must belong to the same tenant';
    END IF;
  END IF;

  -- Cycle check for primary manager
  IF p_primary_manager_id IS NOT NULL THEN
    DECLARE
      current_id uuid := p_primary_manager_id;
      visited uuid[] := ARRAY[p_employee_id];
      mgr_id uuid;
    BEGIN
      WHILE current_id IS NOT NULL LOOP
        IF current_id = p_employee_id THEN
          RAISE EXCEPTION 'Circular reporting line detected for primary manager';
        END IF;

        IF current_id = any(visited) THEN
          EXIT;
        END IF;

        visited := array_append(visited, current_id);

        SELECT manager_id INTO mgr_id
        FROM public.employees
        WHERE id = current_id;

        current_id := mgr_id;
      END LOOP;
    END;
  END IF;

  -- Cycle check for secondary manager
  IF p_secondary_manager_id IS NOT NULL THEN
    DECLARE
      current_id uuid := p_secondary_manager_id;
      visited uuid[] := ARRAY[p_employee_id];
      mgr_id uuid;
    BEGIN
      WHILE current_id IS NOT NULL LOOP
        IF current_id = p_employee_id THEN
          RAISE EXCEPTION 'Circular reporting line detected for secondary manager';
        END IF;

        IF current_id = any(visited) THEN
          EXIT;
        END IF;

        visited := array_append(visited, current_id);

        SELECT manager_id INTO mgr_id
        FROM public.employees
        WHERE id = current_id;

        current_id := mgr_id;
      END LOOP;
    END;
  END IF;

  -- Perform update on employees table
  UPDATE public.employees
  SET manager_id = p_primary_manager_id,
      secondary_manager_id = p_secondary_manager_id,
      updated_at = now()
  WHERE id = p_employee_id;

  -- Sync primary relationships in employee_reporting_relationships
  IF COALESCE(p_primary_manager_id, '00000000-0000-0000-0000-000000000000'::uuid) <> COALESCE(v_old_primary_manager_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
    IF v_old_primary_manager_id IS NOT NULL THEN
      UPDATE public.employee_reporting_relationships
      SET is_active = false,
          effective_to = v_today,
          updated_at = now()
      WHERE employee_id = p_employee_id
        AND manager_id = v_old_primary_manager_id
        AND relationship_type = 'primary'
        AND is_active = true;
    END IF;

    IF p_primary_manager_id IS NOT NULL THEN
      INSERT INTO public.employee_reporting_relationships (
        tenant_id,
        employee_id,
        manager_id,
        relationship_type,
        effective_from,
        is_active
      )
      VALUES (
        v_tenant_id,
        p_employee_id,
        p_primary_manager_id,
        'primary',
        v_today,
        true
      );
    END IF;

    INSERT INTO public.audit_logs (
      tenant_id, actor_id, actor_role, action, target_type, target_id, details, status
    )
    VALUES (
      v_tenant_id,
      v_actor_employee_id,
      'hr',
      'employee.manager_changed',
      'employees',
      p_employee_id,
      jsonb_build_object(
        'from', v_old_primary_manager_id,
        'to', p_primary_manager_id,
        'relationship_type', 'primary'
      ),
      'success'
    );
  END IF;

  -- Sync secondary relationships in employee_reporting_relationships
  IF COALESCE(p_secondary_manager_id, '00000000-0000-0000-0000-000000000000'::uuid) <> COALESCE(v_old_secondary_manager_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
    IF v_old_secondary_manager_id IS NOT NULL THEN
      UPDATE public.employee_reporting_relationships
      SET is_active = false,
          effective_to = v_today,
          updated_at = now()
      WHERE employee_id = p_employee_id
        AND manager_id = v_old_secondary_manager_id
        AND relationship_type = 'secondary'
        AND is_active = true;
    END IF;

    IF p_secondary_manager_id IS NOT NULL THEN
      INSERT INTO public.employee_reporting_relationships (
        tenant_id,
        employee_id,
        manager_id,
        relationship_type,
        effective_from,
        is_active
      )
      VALUES (
        v_tenant_id,
        p_employee_id,
        p_secondary_manager_id,
        'secondary',
        v_today,
        true
      );
    END IF;

    INSERT INTO public.audit_logs (
      tenant_id, actor_id, actor_role, action, target_type, target_id, details, status
    )
    VALUES (
      v_tenant_id,
      v_actor_employee_id,
      'hr',
      'employee.manager_changed',
      'employees',
      p_employee_id,
      jsonb_build_object(
        'from', v_old_secondary_manager_id,
        'to', p_secondary_manager_id,
        'relationship_type', 'secondary'
      ),
      'success'
    );
  END IF;

END;
$function$;

-- [DDL] function public.compute_initial_leave_balance(p_days_per_year numeric, p_accrual_type text, p_target_year integer, p_timezone text) (add)
CREATE OR REPLACE FUNCTION public.compute_initial_leave_balance(p_days_per_year numeric, p_accrual_type text, p_target_year integer, p_timezone text)
 RETURNS numeric
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_current_year integer;
  v_elapsed_months integer;
BEGIN
  v_current_year := extract(year from timezone(p_timezone, now()))::integer;
  IF p_accrual_type = 'monthly' THEN
    IF p_target_year = v_current_year THEN
      v_elapsed_months := extract(month from timezone(p_timezone, now()))::integer;
      RETURN round(((p_days_per_year / 12.0) * v_elapsed_months), 2);
    ELSIF p_target_year > v_current_year THEN
      RETURN 0.00;
    END IF;
  END IF;
  RETURN p_days_per_year;
END;
$function$;

-- [DDL] function public.save_task_policy_transaction(p_tenant_id uuid, p_expected_tenant_updated_at timestamp with time zone, p_expected_setting_versions jsonb, p_policy jsonb) (add)
CREATE OR REPLACE FUNCTION public.save_task_policy_transaction(p_tenant_id uuid, p_expected_tenant_updated_at timestamp with time zone, p_expected_setting_versions jsonb, p_policy jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_auth_tenant_id uuid;
  v_actor_id uuid;
  v_tenant_updated_at timestamptz;
  v_new_tenant_updated_at timestamptz;
  v_now timestamptz := now();
  v_setting_versions jsonb := '{}'::jsonb;
  v_setting_key text;
  v_setting_existing_updated_at timestamptz;
  v_eod_time text;
  v_grace_minutes text;

  v_task_setting_keys text[] := ARRAY[
    'task_eod_redmark_time',
    'task_grace_period_minutes'
  ];
BEGIN
  -- 1. Auth check
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Unauthorized';
  END IF;

  IF NOT public.is_hr() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Only HR can update task policy';
  END IF;

  -- 2. Tenant scope check
  v_auth_tenant_id := public.get_auth_tenant_id();
  IF v_auth_tenant_id IS NULL OR v_auth_tenant_id <> p_tenant_id THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Tenant scope mismatch';
  END IF;

  -- 3. Get actor employee id for audit log
  SELECT id INTO v_actor_id
  FROM public.employees e
  WHERE e.user_id = auth.uid()
    AND e.tenant_id = v_auth_tenant_id
  LIMIT 1;

  -- 4. Lock tenant row and stale-write check
  SELECT t.updated_at INTO v_tenant_updated_at
  FROM public.tenants t
  WHERE t.id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_POLICY_VALUE: Tenant not found';
  END IF;

  IF p_expected_tenant_updated_at IS NOT NULL
     AND v_tenant_updated_at IS DISTINCT FROM p_expected_tenant_updated_at THEN
    RAISE EXCEPTION 'STALE_WRITE: Tenant was modified by another session. Please refresh.';
  END IF;

  -- 5. Validate task settings values
  v_eod_time := coalesce(p_policy->>'task_eod_redmark_time', '23:30');
  v_grace_minutes := coalesce(p_policy->>'task_grace_period_minutes', '0');

  -- Validate time format HH:MM
  IF v_eod_time !~ '^\d{2}:\d{2}$' THEN
    RAISE EXCEPTION 'INVALID_POLICY_VALUE: task_eod_redmark_time must be in HH:MM format';
  END IF;

  -- Validate grace minutes is a non-negative integer
  BEGIN
    IF v_grace_minutes::integer < 0 THEN
      RAISE EXCEPTION 'INVALID_POLICY_VALUE: task_grace_period_minutes must be non-negative';
    END IF;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'INVALID_POLICY_VALUE: task_grace_period_minutes must be a valid integer';
  END;

  -- 6. Check stale setting versions
  IF p_expected_setting_versions IS NOT NULL THEN
    FOR v_setting_key IN SELECT jsonb_object_keys(p_expected_setting_versions)
    LOOP
      SELECT ts.updated_at INTO v_setting_existing_updated_at
      FROM public.tenant_settings ts
      WHERE ts.tenant_id = p_tenant_id
        AND ts.key = v_setting_key;

      IF FOUND AND v_setting_existing_updated_at IS DISTINCT FROM
         (p_expected_setting_versions->>v_setting_key)::timestamptz THEN
        RAISE EXCEPTION 'STALE_WRITE: Setting "%" was modified by another session. Please refresh.', v_setting_key;
      END IF;
    END LOOP;
  END IF;

  -- 7. Update tenants.punch_out_gate_enabled atomically
  UPDATE public.tenants
  SET
    punch_out_gate_enabled = coalesce((p_policy->>'punch_out_gate_enabled')::boolean, punch_out_gate_enabled),
    updated_at = v_now
  WHERE id = p_tenant_id
  RETURNING updated_at INTO v_new_tenant_updated_at;

  -- 8. Upsert task settings
  FOR v_setting_key IN SELECT unnest(v_task_setting_keys)
  LOOP
    INSERT INTO public.tenant_settings (tenant_id, key, value, updated_at)
    VALUES (
      p_tenant_id,
      v_setting_key,
      coalesce(p_policy->>v_setting_key, ''),
      v_now
    )
    ON CONFLICT (tenant_id, key) DO UPDATE
      SET value = EXCLUDED.value,
          updated_at = EXCLUDED.updated_at;

    v_setting_versions := jsonb_set(
      v_setting_versions,
      ARRAY[v_setting_key],
      to_jsonb(v_now::text)
    );
  END LOOP;

  -- 9. Write audit log
  INSERT INTO public.audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details, status)
  VALUES (
    p_tenant_id,
    v_actor_id,
    'hr',
    'settings.updated',
    'tenant',
    p_tenant_id,
    jsonb_build_object('section', 'task-policy'),
    'success'
  );

  -- 10. Return updated version tokens
  RETURN jsonb_build_object(
    'tenant_updated_at', v_new_tenant_updated_at,
    'setting_versions', v_setting_versions
  );
END;
$function$;

-- [DDL] function public.save_attendance_policy_transaction(p_tenant_id uuid, p_expected_tenant_updated_at timestamp with time zone, p_expected_setting_versions jsonb, p_policy jsonb) (add)
CREATE OR REPLACE FUNCTION public.save_attendance_policy_transaction(p_tenant_id uuid, p_expected_tenant_updated_at timestamp with time zone, p_expected_setting_versions jsonb, p_policy jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_auth_tenant_id uuid;
  v_actor_id uuid;
  v_tenant_updated_at timestamptz;
  v_new_tenant_updated_at timestamptz;
  v_now timestamptz := now();
  v_setting_versions jsonb := '{}'::jsonb;
  v_setting_key text;
  v_setting_existing_updated_at timestamptz;
  v_geofence_enabled boolean;
  v_office_lat text;
  v_office_lng text;
  v_geofence_radius text;
  v_geofence_mode text;

  -- Attendance settings keys to upsert
  v_attendance_setting_keys text[] := ARRAY[
    'late_mark_enabled',
    'late_mark_grace_minutes',
    'late_mark_threshold',
    'late_mark_deduction_hours',
    'overtime_enabled',
    'overtime_rate',
    'geofence_enabled',
    'office_lat',
    'office_lng',
    'geofence_radius_meters',
    'geofence_mode',
    'regularization_enabled',
    'regularization_window_days',
    'payroll_lock_date',
    'break_tracking_enabled',
    'break_deduction_mode',
    'short_break_limit_minutes',
    'remote_work_handling',
    'gps_verification_mode',
    'attendance_selfie_mode',
    'selfie_retention_days',
    'high_confidence_max',
    'medium_confidence_max',
    'low_confidence_max'
  ];
BEGIN
  -- 1. Auth check
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Unauthorized';
  END IF;

  IF NOT public.is_hr() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Only HR can update attendance policy';
  END IF;

  -- 2. Tenant scope check
  v_auth_tenant_id := public.get_auth_tenant_id();
  IF v_auth_tenant_id IS NULL OR v_auth_tenant_id <> p_tenant_id THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Tenant scope mismatch';
  END IF;

  -- 3. Get actor employee id for audit log
  SELECT id INTO v_actor_id
  FROM public.employees e
  WHERE e.user_id = auth.uid()
    AND e.tenant_id = v_auth_tenant_id
  LIMIT 1;

  -- 4. Lock tenant row and check for stale write
  SELECT t.updated_at INTO v_tenant_updated_at
  FROM public.tenants t
  WHERE t.id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_POLICY_VALUE: Tenant not found';
  END IF;

  IF p_expected_tenant_updated_at IS NOT NULL
     AND v_tenant_updated_at IS DISTINCT FROM p_expected_tenant_updated_at THEN
    RAISE EXCEPTION 'STALE_WRITE: Tenant was modified by another session. Please refresh.';
  END IF;

  -- 5. Validate required settings values
  v_geofence_enabled := (p_policy->>'geofence_enabled')::boolean;
  v_office_lat := coalesce(p_policy->>'office_lat', '');
  v_office_lng := coalesce(p_policy->>'office_lng', '');
  v_geofence_radius := coalesce(p_policy->>'geofence_radius_meters', '500');
  v_geofence_mode := coalesce(p_policy->>'geofence_mode', 'warn');

  IF v_geofence_enabled THEN
    IF trim(v_office_lat) = '' OR trim(v_office_lng) = '' THEN
      RAISE EXCEPTION 'INVALID_POLICY_VALUE: Geofence is enabled but office lat/lng are missing';
    END IF;
    BEGIN
      PERFORM v_office_lat::numeric;
      PERFORM v_office_lng::numeric;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'INVALID_POLICY_VALUE: office_lat and office_lng must be valid numbers';
    END;
  END IF;

  IF v_geofence_mode NOT IN ('warn', 'strict') THEN
    RAISE EXCEPTION 'INVALID_POLICY_VALUE: geofence_mode must be warn or strict';
  END IF;

  -- Validate enum: remote_work_handling
  IF coalesce(p_policy->>'remote_work_handling', 'hr_approved_exceptions')
     NOT IN ('disabled', 'hr_approved_exceptions', 'always_allowed') THEN
    RAISE EXCEPTION 'INVALID_POLICY_VALUE: remote_work_handling has invalid value';
  END IF;

  -- Validate enum: gps_verification_mode
  IF coalesce(p_policy->>'gps_verification_mode', 'warn')
     NOT IN ('disabled', 'warn', 'strict') THEN
    RAISE EXCEPTION 'INVALID_POLICY_VALUE: gps_verification_mode has invalid value';
  END IF;

  -- Validate enum: attendance_selfie_mode
  IF coalesce(p_policy->>'attendance_selfie_mode', 'disabled')
     NOT IN ('disabled', 'punch_in', 'punch_out', 'both') THEN
    RAISE EXCEPTION 'INVALID_POLICY_VALUE: attendance_selfie_mode has invalid value';
  END IF;

  -- Validate enum: break_deduction_mode
  IF coalesce(p_policy->>'break_deduction_mode', 'fixed')
     NOT IN ('fixed', 'actual') THEN
    RAISE EXCEPTION 'INVALID_POLICY_VALUE: break_deduction_mode has invalid value';
  END IF;

  -- 6. Check stale setting versions provided by client
  IF p_expected_setting_versions IS NOT NULL THEN
    FOR v_setting_key IN SELECT jsonb_object_keys(p_expected_setting_versions)
    LOOP
      SELECT ts.updated_at INTO v_setting_existing_updated_at
      FROM public.tenant_settings ts
      WHERE ts.tenant_id = p_tenant_id
        AND ts.key = v_setting_key;

      IF FOUND AND v_setting_existing_updated_at IS DISTINCT FROM
         (p_expected_setting_versions->>v_setting_key)::timestamptz THEN
        RAISE EXCEPTION 'STALE_WRITE: Setting "%" was modified by another session. Please refresh.', v_setting_key;
      END IF;
    END LOOP;
  END IF;

  -- 7. Update tenant row (punch times, work hours)
  UPDATE public.tenants
  SET
    punch_in_start = coalesce(p_policy->>'punch_in_start', punch_in_start::text)::time,
    punch_in_cutoff = coalesce(p_policy->>'punch_in_cutoff', punch_in_cutoff::text)::time,
    work_hours_per_day = coalesce((p_policy->>'work_hours_per_day')::numeric, work_hours_per_day),
    lunch_break_minutes = coalesce((p_policy->>'lunch_break_minutes')::integer, lunch_break_minutes),
    updated_at = v_now
  WHERE id = p_tenant_id
  RETURNING updated_at INTO v_new_tenant_updated_at;

  -- 8. Upsert all attendance setting keys
  FOR v_setting_key IN SELECT unnest(v_attendance_setting_keys)
  LOOP
    INSERT INTO public.tenant_settings (tenant_id, key, value, updated_at)
    VALUES (
      p_tenant_id,
      v_setting_key,
      coalesce(p_policy->>v_setting_key, ''),
      v_now
    )
    ON CONFLICT (tenant_id, key) DO UPDATE
      SET value = EXCLUDED.value,
          updated_at = EXCLUDED.updated_at;

    v_setting_versions := jsonb_set(
      v_setting_versions,
      ARRAY[v_setting_key],
      to_jsonb(v_now::text)
    );
  END LOOP;

  -- 9. Write audit log
  INSERT INTO public.audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details, status)
  VALUES (
    p_tenant_id,
    v_actor_id,
    'hr',
    'settings.updated',
    'tenant',
    p_tenant_id,
    jsonb_build_object('section', 'attendance-policy'),
    'success'
  );

  -- 10. Return updated version tokens
  RETURN jsonb_build_object(
    'tenant_updated_at', v_new_tenant_updated_at,
    'setting_versions', v_setting_versions
  );
END;
$function$;

-- [DDL] function public.create_employee_transaction(p_user_id uuid, p_full_name text, p_email text, p_phone text, p_date_of_birth date, p_gender text, p_address text, p_city text, p_state text, p_pincode text, p_department text, p_org_unit_id uuid, p_designation text, p_job_title_id uuid, p_employee_code text, p_date_of_joining date, p_employment_type text, p_employment_type_id uuid, p_aadhaar_number text, p_pan_number text, p_bank_name text, p_account_number text, p_ifsc_code text, p_emergency_contact_name text, p_emergency_contact_phone text, p_emergency_contact_relation text, p_work_mode text, p_grade text, p_work_location text, p_location_id uuid, p_manager_id uuid, p_secondary_manager_id uuid, p_probation_period integer) (add)
CREATE OR REPLACE FUNCTION public.create_employee_transaction(p_user_id uuid, p_full_name text, p_email text, p_phone text, p_date_of_birth date, p_gender text, p_address text, p_city text, p_state text, p_pincode text, p_department text, p_org_unit_id uuid, p_designation text, p_job_title_id uuid, p_employee_code text, p_date_of_joining date, p_employment_type text, p_employment_type_id uuid, p_aadhaar_number text, p_pan_number text, p_bank_name text, p_account_number text, p_ifsc_code text, p_emergency_contact_name text, p_emergency_contact_phone text, p_emergency_contact_relation text, p_work_mode text, p_grade text, p_work_location text, p_location_id uuid, p_manager_id uuid, p_secondary_manager_id uuid, p_probation_period integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_new_id uuid;
  v_tenant_id uuid;
  v_actor_employee_id uuid;
  v_today date := CURRENT_DATE;
  v_calculated_probation_end_date date := NULL;
  v_probation_status text := 'not_applicable';
  v_tz text;
  v_tenant_now timestamp;
  v_target_year integer;
  v_current_year integer;
  v_elapsed_months integer;
  v_lt RECORD;
  v_initial_balance numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF NOT public.is_hr() THEN
    RAISE EXCEPTION 'Forbidden: only HR can create employees';
  END IF;

  v_tenant_id := public.get_auth_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid tenant context';
  END IF;

  SELECT id
  INTO v_actor_employee_id
  FROM public.employees
  WHERE user_id = auth.uid()
    AND tenant_id = v_tenant_id
  LIMIT 1;

  IF EXISTS (
    SELECT 1
    FROM public.employees
    WHERE tenant_id = v_tenant_id
      AND lower(email) = lower(trim(p_email))
  ) THEN
    RAISE EXCEPTION 'Email % is already registered in the system', trim(p_email);
  END IF;

  IF p_employee_code IS NOT NULL AND trim(p_employee_code) <> '' THEN
    IF EXISTS (
      SELECT 1
      FROM public.employees
      WHERE tenant_id = v_tenant_id
        AND lower(employee_code) = lower(trim(p_employee_code))
    ) THEN
      RAISE EXCEPTION 'Employee Code % is already in use', trim(p_employee_code);
    END IF;
  END IF;

  IF p_manager_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_manager_id AND tenant_id = v_tenant_id) THEN
      RAISE EXCEPTION 'Primary manager must belong to the same tenant';
    END IF;
  END IF;

  IF p_secondary_manager_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_secondary_manager_id AND tenant_id = v_tenant_id) THEN
      RAISE EXCEPTION 'Secondary manager must belong to the same tenant';
    END IF;
  END IF;

  IF p_manager_id IS NOT NULL AND p_secondary_manager_id IS NOT NULL AND p_manager_id = p_secondary_manager_id THEN
    RAISE EXCEPTION 'Primary and secondary managers cannot be the same person';
  END IF;

  IF p_probation_period IS NOT NULL AND p_probation_period > 0 THEN
    v_probation_status := 'on_probation';
    IF p_date_of_joining IS NOT NULL THEN
      v_calculated_probation_end_date := p_date_of_joining + p_probation_period;
    END IF;
  END IF;

  INSERT INTO public.employees (
    user_id,
    tenant_id,
    full_name,
    email,
    phone,
    date_of_birth,
    gender,
    address,
    city,
    state,
    pincode,
    department,
    org_unit_id,
    designation,
    job_title_id,
    employee_code,
    date_of_joining,
    employment_type,
    employment_type_id,
    aadhaar_number,
    pan_number,
    bank_name,
    account_number,
    ifsc_code,
    emergency_contact_name,
    emergency_contact_phone,
    emergency_contact_relation,
    status,
    work_mode,
    grade,
    work_location,
    location_id,
    manager_id,
    secondary_manager_id,
    probation_status,
    probation_end_date,
    created_at,
    updated_at
  )
  VALUES (
    p_user_id,
    v_tenant_id,
    trim(p_full_name),
    lower(trim(p_email)),
    trim(p_phone),
    p_date_of_birth,
    p_gender,
    trim(p_address),
    trim(p_city),
    trim(p_state),
    trim(p_pincode),
    p_department,
    p_org_unit_id,
    trim(p_designation),
    p_job_title_id,
    trim(p_employee_code),
    p_date_of_joining,
    p_employment_type,
    p_employment_type_id,
    trim(p_aadhaar_number),
    trim(p_pan_number),
    trim(p_bank_name),
    trim(p_account_number),
    trim(p_ifsc_code),
    trim(p_emergency_contact_name),
    trim(p_emergency_contact_phone),
    trim(p_emergency_contact_relation),
    'active',
    p_work_mode,
    trim(p_grade),
    p_work_location,
    p_location_id,
    p_manager_id,
    p_secondary_manager_id,
    v_probation_status,
    v_calculated_probation_end_date,
    now(),
    now()
  )
  RETURNING id INTO v_new_id;

  INSERT INTO public.employee_onboarding_self (
    tenant_id,
    employee_id,
    personal_details_completed,
    bank_details_completed,
    documents_completed,
    emergency_contact_completed,
    created_at,
    updated_at
  )
  VALUES (
    v_tenant_id,
    v_new_id,
    false,
    false,
    false,
    false,
    now(),
    now()
  );

  IF p_manager_id IS NOT NULL THEN
    INSERT INTO public.employee_reporting_relationships (
      tenant_id,
      employee_id,
      manager_id,
      relationship_type,
      effective_from,
      is_active,
      created_at,
      updated_at
    )
    VALUES (
      v_tenant_id,
      v_new_id,
      p_manager_id,
      'primary',
      COALESCE(p_date_of_joining, v_today),
      true,
      now(),
      now()
    );
  END IF;

  IF p_secondary_manager_id IS NOT NULL THEN
    INSERT INTO public.employee_reporting_relationships (
      tenant_id,
      employee_id,
      manager_id,
      relationship_type,
      effective_from,
      is_active,
      created_at,
      updated_at
    )
    VALUES (
      v_tenant_id,
      v_new_id,
      p_secondary_manager_id,
      'secondary',
      COALESCE(p_date_of_joining, v_today),
      true,
      now(),
      now()
    );
  END IF;

  SELECT COALESCE(timezone, 'UTC')
  INTO v_tz
  FROM public.tenant_settings
  WHERE tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    v_tz := 'UTC';
  END IF;

  v_tenant_now := timezone(v_tz, now());
  v_target_year := date_part('year', v_tenant_now)::integer;
  v_current_year := date_part('year', now())::integer;
  v_elapsed_months := date_part('month', now())::integer;

  FOR v_lt IN
    SELECT id, days_per_year, accrual_type
    FROM public.leave_types
    WHERE tenant_id = v_tenant_id
      AND is_active = true
  LOOP
    v_initial_balance := v_lt.days_per_year;

    IF v_lt.accrual_type = 'monthly' THEN
      IF v_target_year = v_current_year THEN
        v_initial_balance := round(((v_lt.days_per_year::numeric / 12.0) * v_elapsed_months::numeric), 2);
      ELSIF v_target_year > v_current_year THEN
        v_initial_balance := 0;
      END IF;
    END IF;

    INSERT INTO public.leave_balances (
      tenant_id,
      employee_id,
      leave_type_id,
      year,
      total_allocated,
      used_days,
      carried_forward,
      balance,
      created_at,
      updated_at
    )
    VALUES (
      v_tenant_id,
      v_new_id,
      v_lt.id,
      v_target_year,
      v_lt.days_per_year,
      0,
      0,
      v_initial_balance,
      now(),
      now()
    )
    ON CONFLICT (tenant_id, employee_id, leave_type_id, year)
    DO NOTHING;
  END LOOP;

  INSERT INTO public.audit_logs (
    tenant_id, actor_id, actor_role, action, target_type, target_id, details, status
  )
  VALUES (
    v_tenant_id,
    v_actor_employee_id,
    'hr',
    'employee.created',
    'employees',
    v_new_id,
    jsonb_build_object('full_name', p_full_name, 'email', p_email),
    'success'
  );

  IF p_manager_id IS NOT NULL THEN
    INSERT INTO public.audit_logs (
      tenant_id, actor_id, actor_role, action, target_type, target_id, details, status
    )
    VALUES (
      v_tenant_id,
      v_actor_employee_id,
      'hr',
      'employee.manager_changed',
      'employees',
      v_new_id,
      jsonb_build_object(
        'from', NULL,
        'to', p_manager_id,
        'relationship_type', 'primary'
      ),
      'success'
    );
  END IF;

  RETURN v_new_id;
END;
$function$;

COMMIT;