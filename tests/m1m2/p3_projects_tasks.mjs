#!/usr/bin/env node
// P3-02 owns its disposable fixtures. --before-only records the unchanged-schema
// employee self-approval before the migration is applied.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@insforge/sdk";
import { guardedMutation, runSql } from "./_harness.mjs";
import { TB_M1M2 } from "./_target.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const password = readFileSync(join(here, "persona-password.local"), "utf8").trim();
const companyA = "a0000000-0000-4000-8000-000000000001";
const companyB = "b0000000-0000-4000-8000-000000000002";
const employeeA = { email: "employee.a@m1m2.test", userId: "a0000000-0000-4000-8001-000000000001", employeeId: "a0000000-0000-4000-8001-000000000002" };
const hrA = { email: "hr-employee.a@m1m2.test", userId: "a0000000-0000-4000-8002-000000000001", employeeId: "a0000000-0000-4000-8002-000000000002" };
const employeeB = { email: "employee.b@m1m2.test", userId: "b0000000-0000-4000-8001-000000000001" };
const beforeTask = "a3020000-0000-4000-8000-000000000001";
const beforeSubmission = "a3020000-0000-4000-8000-000000000002";
const rows = (result) => result?.rows ?? result?.data?.rows ?? [];
const q = (value) => `'${String(value).replace(/'/g, "''")}'`;
const membershipId = (userId) => {
  const hex=createHash("md5").update(`${companyA}:${userId}`).digest("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
};
const manager = { email: "p302-manager.a@m1m2.test", userId: "a3020000-0000-4000-8000-000000001001", employeeId: "a3020000-0000-4000-8000-000000001002" };
manager.membershipId=membershipId(manager.userId);
const projectManager = { email: "p302-project-manager.a@m1m2.test", userId: "a3020000-0000-4000-8000-000000002001", employeeId: "a3020000-0000-4000-8000-000000002002" };
projectManager.membershipId=membershipId(projectManager.userId);
const projectA1 = "a3020000-0000-4000-8000-000000003001";
const projectA2 = "a3020000-0000-4000-8000-000000003002";
const taskA1 = "a3020000-0000-4000-8000-000000004001";
const taskA2 = "a3020000-0000-4000-8000-000000004002";
const taskNull = "a3020000-0000-4000-8000-000000004003";
const taskB = "a3020000-0000-4000-8000-000000004004";
const taskHr = "a3020000-0000-4000-8000-000000004005";
const taskGate = "a3020000-0000-4000-8000-000000004006";
const allTaskIds = [taskA1, taskA2, taskNull, taskB, taskHr];

function anonKey() {
  const cli = join(root, "node_modules", "@insforge", "cli", "dist", "index.js");
  const result = spawnSync(process.execPath, [cli, "secrets", "get", "ANON_KEY", "--json"], {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(result.status, 0, "Could not read TB-M1M2 anon key; raw CLI output suppressed");
  return JSON.parse(result.stdout.slice(result.stdout.indexOf("{"))).value;
}

async function signIn(persona, key) {
  const client = createClient({ baseUrl: TB_M1M2.baseUrl, functionsUrl: TB_M1M2.functionsUrl, anonKey: key });
  const { data, error } = await client.auth.signInWithPassword({ email: persona.email, password });
  assert.equal(error, null, `${persona.email} login: ${error?.message}`);
  assert.equal(data?.user?.id, persona.userId);
  return client;
}

async function rlsInvariant(clients) {
  const counts = {};
  for (const [name, client] of Object.entries(clients)) {
    const { data, error } = await client.database.from("employees").select("id").eq("tenant_id", companyA);
    assert.equal(error, null, `${name} employees: ${error?.message}`);
    counts[name] = data.length;
  }
  assert.deepEqual(counts, { employee: 1, hr: 2, crossTenant: 0 });
  console.log(`RLS Company A employees (${Object.keys(counts).join(" / ")}): ${Object.values(counts).join(" / ")}`);
}

async function selfApprovalPatch(clients, expectAllowed) {
  runSql(`INSERT INTO public.tasks (id,tenant_id,title,assigned_to,assigned_by,status)
    VALUES ('${beforeTask}'::uuid,'${companyA}'::uuid,'P3-02 before self approval',
      '${employeeA.employeeId}'::uuid,'${hrA.employeeId}'::uuid,'submitted')`);
  try {
    runSql(`INSERT INTO public.task_submissions (id,tenant_id,task_id,employee_id,notes,status)
      VALUES ('${beforeSubmission}'::uuid,'${companyA}'::uuid,'${beforeTask}'::uuid,
        '${employeeA.employeeId}'::uuid,'Before self approval','pending')`);
    const response = await clients.employee.database.from("tasks")
      .update({ status: "approved" }).eq("id", beforeTask).select("id,status");
    const status = rows(runSql(`SELECT status FROM public.tasks WHERE id='${beforeTask}'::uuid`))[0]?.status;
    console.log(`${expectAllowed ? "BEFORE" : "AFTER"} self-approval PATCH: ${JSON.stringify(response)}; stored status=${status}`);
    if (expectAllowed) {
      assert.equal(response.error, null, `Before PATCH unexpectedly failed: ${response.error?.message}`);
      assert.equal(status, "approved", "Before PATCH did not approve own task");
    } else {
      assert.ok(response.error, "After PATCH unexpectedly succeeded");
      assert.equal(status, "submitted", "After PATCH changed task status");
    }
  } finally {
    runSql(`DELETE FROM public.task_submissions WHERE id='${beforeSubmission}'::uuid`);
    runSql(`DELETE FROM public.tasks WHERE id='${beforeTask}'::uuid`);
  }
}

function setupFullFixture() {
  // One admin query is a single transaction. The two new people and every record they own
  // are deleted by teardownFullFixture even when a later assertion fails.
  const sql = `
    INSERT INTO auth.users(id,email,password,email_verified,metadata) VALUES
      ('${manager.userId}'::uuid,${q(manager.email)},crypt(${q(password)},gen_salt('bf',10)),true,
       ${q(JSON.stringify({role:"employee",tenant_id:companyA}))}::jsonb),
      ('${projectManager.userId}'::uuid,${q(projectManager.email)},crypt(${q(password)},gen_salt('bf',10)),true,
       ${q(JSON.stringify({role:"employee",tenant_id:companyA}))}::jsonb);
    INSERT INTO public.employees(id,user_id,tenant_id,full_name,email) VALUES
      ('${manager.employeeId}'::uuid,'${manager.userId}'::uuid,'${companyA}'::uuid,'P3-02 Reporting Manager',${q(manager.email)}),
      ('${projectManager.employeeId}'::uuid,'${projectManager.userId}'::uuid,'${companyA}'::uuid,'P3-02 Project Manager',${q(projectManager.email)});
    INSERT INTO public.tenant_memberships(tenant_id,user_id,employee_id,status) VALUES
      ('${companyA}'::uuid,'${manager.userId}'::uuid,'${manager.employeeId}'::uuid,'active'),
      ('${companyA}'::uuid,'${projectManager.userId}'::uuid,'${projectManager.employeeId}'::uuid,'active');
    INSERT INTO public.membership_template_assignments(membership_id,tenant_id,template_key,is_active) VALUES
      ('${manager.membershipId}'::uuid,'${companyA}'::uuid,'employee',true),
      ('${manager.membershipId}'::uuid,'${companyA}'::uuid,'manager',true),
      ('${projectManager.membershipId}'::uuid,'${companyA}'::uuid,'employee',true),
      ('${projectManager.membershipId}'::uuid,'${companyA}'::uuid,'project_manager',true);
    INSERT INTO public.employee_reporting_relationships(id,tenant_id,employee_id,manager_id,relationship_type,effective_from,is_active) VALUES
      ('a3020000-0000-4000-8000-000000006001'::uuid,'${companyA}'::uuid,'${employeeA.employeeId}'::uuid,'${manager.employeeId}'::uuid,'primary','2026-01-01',true),
      ('a3020000-0000-4000-8000-000000006002'::uuid,'${companyA}'::uuid,'${employeeA.employeeId}'::uuid,'${projectManager.employeeId}'::uuid,'mentor','2026-01-01',true);
    INSERT INTO public.projects(id,tenant_id,name,status,manager_id,created_by) VALUES
      ('${projectA1}'::uuid,'${companyA}'::uuid,'P3-02 A1','active','${projectManager.employeeId}'::uuid,'${projectManager.employeeId}'::uuid),
      ('${projectA2}'::uuid,'${companyA}'::uuid,'P3-02 A2','active',NULL,'${hrA.employeeId}'::uuid);
    INSERT INTO public.project_memberships(tenant_id,project_id,employee_id,role) VALUES
      ('${companyA}'::uuid,'${projectA1}'::uuid,'${projectManager.employeeId}'::uuid,'manager'),
      ('${companyA}'::uuid,'${projectA1}'::uuid,'${employeeA.employeeId}'::uuid,'member'),
      ('${companyA}'::uuid,'${projectA2}'::uuid,'${employeeA.employeeId}'::uuid,'member');
    INSERT INTO public.tasks(id,tenant_id,title,assigned_to,assigned_by,project_id,status,due_date) VALUES
      ('${taskA1}'::uuid,'${companyA}'::uuid,'P3-02 A1 review','${employeeA.employeeId}'::uuid,'${projectManager.employeeId}'::uuid,'${projectA1}'::uuid,'submitted','2099-01-01'),
      ('${taskA2}'::uuid,'${companyA}'::uuid,'P3-02 A2 review','${employeeA.employeeId}'::uuid,'${hrA.employeeId}'::uuid,'${projectA2}'::uuid,'submitted','2099-01-01'),
      ('${taskNull}'::uuid,'${companyA}'::uuid,'P3-02 null project','${employeeA.employeeId}'::uuid,'${manager.employeeId}'::uuid,NULL,'submitted','2099-01-03'),
      ('${taskB}'::uuid,'${companyB}'::uuid,'P3-02 Company B','b0000000-0000-4000-8001-000000000002'::uuid,'b0000000-0000-4000-8001-000000000002'::uuid,NULL,'submitted',NULL),
      ('${taskHr}'::uuid,'${companyA}'::uuid,'P3-02 HR self','${hrA.employeeId}'::uuid,'${manager.employeeId}'::uuid,NULL,'submitted',NULL);
    INSERT INTO public.task_submissions(id,tenant_id,task_id,employee_id,notes,status) VALUES
      ('a3020000-0000-4000-8000-000000005001'::uuid,'${companyA}'::uuid,'${taskA1}'::uuid,'${employeeA.employeeId}'::uuid,'A1','pending'),
      ('a3020000-0000-4000-8000-000000005002'::uuid,'${companyA}'::uuid,'${taskA2}'::uuid,'${employeeA.employeeId}'::uuid,'A2','pending'),
      ('a3020000-0000-4000-8000-000000005003'::uuid,'${companyA}'::uuid,'${taskNull}'::uuid,'${employeeA.employeeId}'::uuid,'null','pending'),
      ('a3020000-0000-4000-8000-000000005004'::uuid,'${companyB}'::uuid,'${taskB}'::uuid,'b0000000-0000-4000-8001-000000000002'::uuid,'B','pending'),
      ('a3020000-0000-4000-8000-000000005005'::uuid,'${companyA}'::uuid,'${taskHr}'::uuid,'${hrA.employeeId}'::uuid,'HR','pending');
  `;
  try {
    runSql(sql);
  } catch (error) {
    // The shared harness suppresses CLI errors because some CLI responses include secrets.
    // Repeat only this failed, transactional fixture setup and expose a redacted error.
    const cli = join(root, "node_modules", "@insforge", "cli", "dist", "index.js");
    const debug = spawnSync(process.execPath,[cli,"db","query",sql,"--json"],
      {cwd:root,encoding:"utf8",stdio:["ignore","pipe","pipe"]});
    const message = (debug.stderr || debug.stdout || "fixture SQL failed")
      .replaceAll(password,"[redacted]").slice(0,1000);
    throw new Error(`Fixture setup failed: ${message}`,{cause:error});
  }
}

function teardownFullFixture() {
  // Only P3-02-owned rows are removed. Dynamic RPC-created projects/tasks carry the P3-02
  // title prefix, so failures before a returned id cannot strand them.
  runSql(`
    DELETE FROM public.calendar_events WHERE task_id IN
      (SELECT id FROM public.tasks WHERE title LIKE 'P3-02%');
    DELETE FROM public.notifications WHERE reference_id IN
      (SELECT id FROM public.tasks WHERE title LIKE 'P3-02%');
    DELETE FROM public.task_submissions WHERE task_id IN
      (SELECT id FROM public.tasks WHERE title LIKE 'P3-02%');
    DELETE FROM public.tasks WHERE title LIKE 'P3-02%';
    DELETE FROM public.project_memberships WHERE project_id IN
      (SELECT id FROM public.projects WHERE name LIKE 'P3-02%');
    DELETE FROM public.projects WHERE name LIKE 'P3-02%';
    DELETE FROM public.employee_reporting_relationships WHERE id IN
      ('a3020000-0000-4000-8000-000000006001'::uuid,'a3020000-0000-4000-8000-000000006002'::uuid);
    DELETE FROM public.membership_template_assignments WHERE membership_id IN
      ('${manager.membershipId}'::uuid,'${projectManager.membershipId}'::uuid);
    DELETE FROM public.tenant_memberships WHERE id IN
      ('${manager.membershipId}'::uuid,'${projectManager.membershipId}'::uuid);
    DELETE FROM public.employees WHERE id IN
      ('${manager.employeeId}'::uuid,'${projectManager.employeeId}'::uuid);
    DELETE FROM auth.users WHERE id IN ('${manager.userId}'::uuid,'${projectManager.userId}'::uuid);
  `);
}

const fingerprint = (error) => [error?.code,error?.message,error?.details].filter(Boolean).join(" | ");
function denied(result,label,pattern=/P1003|denied|unavailable|permission/i) {
  assert.ok(result.error, `${label}: unexpectedly succeeded`);
  assert.match(fingerprint(result.error),pattern,`${label}: ${fingerprint(result.error)}`);
  console.log(`${label}: DENIED ${fingerprint(result.error)}`);
}
function allowed(result,label) {
  assert.equal(result.error,null,`${label}: ${fingerprint(result.error)}`);
  console.log(`${label}: ALLOWED ${JSON.stringify(result.data)}`);
  return result.data;
}
async function taskIds(client,ids) {
  const result=await client.database.from("tasks").select("id").in("id",ids);
  assert.equal(result.error,null,fingerprint(result.error));
  return (result.data??[]).map((r)=>r.id).sort();
}

async function fullSuite(clients,key) {
  try {
    setupFullFixture();
    clients.manager=await signIn(manager,key);
    clients.projectManager=await signIn(projectManager,key);
    const mid={};
    for (const [label,client] of Object.entries(clients)) {
      const {data,error}=await client.database.from("employees").select("id").eq("tenant_id",companyA);
      assert.equal(error,null,`${label}: ${fingerprint(error)}`);
      mid[label]=data.length;
    }
    console.log(`RLS during fixture: ${JSON.stringify(mid)}`);
    assert.deepEqual([mid.employee,mid.hr,mid.crossTenant],[1,4,0]);

    // Server read policies: project-less task remains reachable through self, HR/company,
    // and effective primary manager only. A mentor/project manager gets no manager scope.
    for (const [label,client,expected] of [
      ["employee",clients.employee,[taskA1,taskA2,taskNull]],
      ["HR",clients.hr,[taskA1,taskA2,taskNull,taskHr]],
      ["primary manager",clients.manager,[taskA1,taskA2,taskNull]],
      ["project manager mentor",clients.projectManager,[taskA1]],
      ["Company B",clients.crossTenant,[taskB]],
    ]) {
      const found=await taskIds(client,allTaskIds);
      assert.deepEqual(found,expected.sort(),`${label} task scope`);
      console.log(`${label} task read: ${found.join(",")}`);
    }
    const mentor=await clients.projectManager.database.rpc("is_manager_of",{p_employee_id:employeeA.employeeId});
    assert.equal(mentor.data,false,"mentor gained direct reports");
    console.log("project manager mentor direct-report read: DENIED (is_manager_of=false)");

    denied(await clients.employee.database.rpc("approve_task_request",{p_task_id:taskA1}),
      "employee.a self review",/P1001.*SELF_APPROVAL_DENIED/);
    denied(await clients.hr.database.rpc("approve_task_request",{p_task_id:taskHr}),
      "HR self review",/P1001.*SELF_APPROVAL_DENIED/);
    denied(await clients.hr.database.rpc("approve_task_request",{p_task_id:taskB}),"HR out of company");
    denied(await clients.manager.database.rpc("approve_task_request",{p_task_id:taskHr}),"Manager non-direct report");
    denied(await clients.projectManager.database.rpc("approve_task_request",{p_task_id:taskA2}),"Project Manager other project");
    denied(await clients.projectManager.database.rpc("approve_task_request",{p_task_id:taskNull}),"Project Manager null project");
    const calendarBefore=rows(runSql(`SELECT date,type,task_id FROM public.calendar_events WHERE tenant_id='${companyA}'::uuid AND employee_id='${employeeA.employeeId}'::uuid AND date='2099-01-01'`));
    assert.equal(calendarBefore.length,0,"test calendar date already occupied");
    console.log(`Calendar before approval: ${JSON.stringify(calendarBefore)}`);
    allowed(await clients.projectManager.database.rpc("p3_review_task",{p_task_id:taskA1,p_approved:true,p_reason:"A1 complete"}),"Project Manager A1 review");
    const calendarFirst=rows(runSql(`SELECT date,type,task_id FROM public.calendar_events WHERE tenant_id='${companyA}'::uuid AND employee_id='${employeeA.employeeId}'::uuid AND date='2099-01-01'`));
    assert.deepEqual(calendarFirst.map(r=>[r.type,r.task_id]),[["green",taskA1]]);
    console.log(`Calendar after first approval: ${JSON.stringify(calendarFirst)}`);
    allowed(await clients.manager.database.rpc("p3_review_task",{p_task_id:taskNull,p_approved:true,p_reason:"Direct report complete"}),"Manager null-project review");
    allowed(await clients.hr.database.rpc("p3_review_task",{p_task_id:taskA2,p_approved:true,p_reason:"HR company review"}),"HR company review");
    const calendarConflict=rows(runSql(`SELECT date,type,task_id FROM public.calendar_events WHERE tenant_id='${companyA}'::uuid AND employee_id='${employeeA.employeeId}'::uuid AND date='2099-01-01'`));
    assert.deepEqual(calendarConflict.map(r=>[r.type,r.task_id]),[["green",taskA2]]);
    console.log(`Calendar same-day conflict: ${JSON.stringify(calendarConflict)}`);

    const hrAssigned=allowed(await clients.hr.database.rpc("p3_assign_task",{p_assigned_to:employeeA.employeeId,p_title:"P3-02 HR null assignment",p_due_date:"2099-01-04"}),"HR null assignment");
    allowed(await clients.manager.database.rpc("p3_assign_task",{p_assigned_to:employeeA.employeeId,p_title:"P3-02 manager assignment"}),"Manager direct assignment");
    const pmAssigned=allowed(await clients.projectManager.database.rpc("p3_assign_task",{p_assigned_to:employeeA.employeeId,p_title:"P3-02 PM A1 assignment",p_project_id:projectA1}),"Project Manager A1 assignment");
    denied(await clients.manager.database.rpc("p3_assign_task",{p_assigned_to:hrA.employeeId,p_title:"P3-02 denied manager"}),"Manager non-direct assignment");
    denied(await clients.projectManager.database.rpc("p3_assign_task",{p_assigned_to:employeeA.employeeId,p_title:"P3-02 denied PM",p_project_id:projectA2}),"Project Manager A2 assignment");

    const projectSubmit=allowed(await clients.employee.database.rpc("submit_task_request",{p_task_id:pmAssigned,p_notes:"project done",p_attachment_url:null,p_attachment_name:null}),"Employee project task submit");
    const projectRecipients=rows(runSql(`SELECT employee_id FROM public.notifications WHERE tenant_id='${companyA}'::uuid AND reference_id='${pmAssigned}'::uuid AND type='general' ORDER BY employee_id`)).map(r=>r.employee_id);
    assert.deepEqual(projectRecipients,[hrA.employeeId,manager.employeeId,projectManager.employeeId].sort());
    assert.equal(projectSubmit.notified,3);
    console.log(`Project submit reviewers notified: ${projectRecipients.join(",")}`);

    const submitted=allowed(await clients.employee.database.rpc("submit_task_request",{p_task_id:hrAssigned,p_notes:"done",p_attachment_url:null,p_attachment_name:null}),"Employee null-project submit");
    assert.equal(submitted.duplicate,false);
    const noticesBefore=rows(runSql(`SELECT count(*)::integer AS count FROM public.notifications WHERE tenant_id='${companyA}'::uuid AND reference_id='${hrAssigned}'::uuid AND type='general'`))[0].count;
    assert.equal(noticesBefore,submitted.notified);
    const retry=allowed(await clients.employee.database.rpc("submit_task_request",{p_task_id:hrAssigned,p_notes:"done",p_attachment_url:null,p_attachment_name:null}),"Employee submit retry");
    assert.equal(retry.submission_id,submitted.submission_id);
    assert.equal(retry.notified,0);
    const noticesAfter=rows(runSql(`SELECT count(*)::integer AS count FROM public.notifications WHERE tenant_id='${companyA}'::uuid AND reference_id='${hrAssigned}'::uuid AND type='general'`))[0].count;
    assert.equal(noticesAfter,noticesBefore);
    console.log(`Submit retry: submission ${submitted.submission_id}, notifications ${noticesBefore} -> ${noticesAfter}`);
    allowed(await clients.hr.database.rpc("p3_review_task",{p_task_id:hrAssigned,p_approved:false,p_reason:"Please revise"}),"HR reject with reason");
    allowed(await clients.employee.database.rpc("submit_task_request",{p_task_id:hrAssigned,p_notes:"revised",p_attachment_url:null,p_attachment_name:null}),"Employee resubmit");
    allowed(await clients.hr.database.rpc("p3_review_task",{p_task_id:hrAssigned,p_approved:true,p_reason:"Accepted revision"}),"HR approve resubmission");
    allowed(await clients.hr.database.rpc("p3_archive_task",{p_task_id:hrAssigned}),"HR archive task");
    assert.equal((await taskIds(clients.employee,[hrAssigned])).length,0,"archived task still visible");

    const created=allowed(await clients.projectManager.database.rpc("p3_create_project",{p_name:"P3-02 RPC created",p_description:"disposable"}),"Project Manager project create");
    allowed(await clients.projectManager.database.rpc("p3_set_project_member",{p_project_id:created,p_employee_id:employeeA.employeeId,p_role:"member"}),"Project Manager add member");
    allowed(await clients.projectManager.database.rpc("p3_update_project",{p_project_id:created,p_name:"P3-02 RPC updated",p_description:"updated",p_status:"active"}),"Project Manager project update");
    allowed(await clients.projectManager.database.rpc("p3_archive_project",{p_project_id:created}),"Project Manager project archive");
    const projectRead=await clients.employee.database.from("projects").select("id").eq("id",created);
    assert.equal(projectRead.error,null);
    assert.equal(projectRead.data.length,1,"explicit member cannot read project");
    console.log("Employee explicit project membership: ALLOWED");

    // Projects remain available with Tasks disabled; the P2-owned punch-out gate
    // must let an employee leave even when an unapproved task is due today.
    const settings=rows(runSql(`SELECT tm.enabled AS tasks_enabled,t.punch_out_gate_enabled AS gate_enabled
      FROM public.tenant_modules tm JOIN public.tenants t ON t.id=tm.tenant_id
      WHERE tm.tenant_id='${companyA}'::uuid AND tm.module_key='tasks'`))[0];
    assert.equal(settings.tasks_enabled,true);
    const today=rows(runSql(`SELECT public.tenant_business_date('${companyA}'::uuid,now()) AS today`))[0].today.slice(0,10);
    const attendanceIds=[];
    try {
      runSql(`INSERT INTO public.tasks(id,tenant_id,title,assigned_to,assigned_by,due_date,status)
        VALUES('${taskGate}'::uuid,'${companyA}'::uuid,'P3-02 punch-out gate','${employeeA.employeeId}'::uuid,'${hrA.employeeId}'::uuid,'${today}'::date,'assigned');
        UPDATE public.tenant_modules SET enabled=false WHERE tenant_id='${companyA}'::uuid AND module_key='tasks';
        UPDATE public.tenants SET punch_out_gate_enabled=true WHERE id='${companyA}'::uuid`);
      const projectsOnly=await clients.projectManager.database.from("projects").select("id").eq("id",projectA1);
      assert.equal(projectsOnly.error,null);
      assert.equal(projectsOnly.data.length,1,"Projects-only lost project access");
      assert.equal((await taskIds(clients.employee,[taskGate])).length,0,"Tasks disabled still exposed task");
      console.log("Projects-only: project visible; Tasks disabled: task hidden");
      const punchedIn=allowed(await clients.employee.database.rpc("punch_in_attendance",{
        p_tenant_id:companyA,p_employee_id:employeeA.employeeId,p_lat:null,p_lng:null,p_acc:null,
        p_loc_status:"gps_unavailable",p_confidence:null,p_ip:null,p_remote_exception_id:null,
        p_verification_snapshot:{test:"P3-02"},
      }),"P3-02 punch in with Tasks disabled");
      const attendanceId=punchedIn.attendance_id??punchedIn.id;
      assert.ok(attendanceId);
      attendanceIds.push(attendanceId);
      const punchedOut=allowed(await clients.employee.database.rpc("punch_out_attendance",{
        p_attendance_id:attendanceId,p_tenant_id:companyA,p_lat:null,p_lng:null,p_acc:null,
        p_loc_status:"gps_unavailable",p_confidence:null,p_remote_exception_id:null,
        p_verification_snapshot:{test:"P3-02"},
      }),"P3-02 punch out with Tasks disabled");
      assert.equal(punchedOut.success,true,"Tasks-disabled punch-out blocked");
      console.log("AC6 punch-out with Tasks disabled and due unapproved task: success=true");
    } finally {
      if (attendanceIds.length) runSql(`DELETE FROM public.overtime_records WHERE attendance_id IN (${attendanceIds.map(id=>q(id)+"::uuid").join(",")});
        DELETE FROM public.attendance_events WHERE attendance_id IN (${attendanceIds.map(id=>q(id)+"::uuid").join(",")});
        DELETE FROM public.attendance WHERE id IN (${attendanceIds.map(id=>q(id)+"::uuid").join(",")})`);
      runSql(`UPDATE public.tenant_modules SET enabled=${settings.tasks_enabled} WHERE tenant_id='${companyA}'::uuid AND module_key='tasks';
        UPDATE public.tenants SET punch_out_gate_enabled=${settings.gate_enabled} WHERE id='${companyA}'::uuid;
        DELETE FROM public.tasks WHERE id='${taskGate}'::uuid`);
    }

    // Deep links must recheck membership on each request, without relying on the summary.
    denied(await clients.projectManager.database.rpc("p3_set_project_member",{p_project_id:projectA1,p_employee_id:projectManager.employeeId,p_role:"manager",p_active:false}),"Project Manager self removal");
    allowed(await clients.projectManager.database.rpc("p3_set_project_member",{p_project_id:projectA1,p_employee_id:employeeA.employeeId,p_role:"member",p_active:false}),"Project Manager remove employee.a");
    assert.equal((await taskIds(clients.employee,[taskA1])).length,0,"revoked member retained task deep-link read");
    const afterRevocation=await clients.employee.database.from("projects").select("id").eq("id",projectA1);
    assert.equal(afterRevocation.error,null);
    assert.equal(afterRevocation.data.length,0,"revoked member retained project deep-link read");
    console.log("Employee.a after project membership removal: project and task deep links DENIED");
  } finally {
    teardownFullFixture();
    await rlsInvariant({employee:clients.employee,hr:clients.hr,crossTenant:clients.crossTenant});
  }
}

await guardedMutation("P3-02 disposable fixture", async () => {
  const key = anonKey();
  const clients = {
    employee: await signIn(employeeA, key),
    hr: await signIn(hrA, key),
    crossTenant: await signIn(employeeB, key),
  };
  await rlsInvariant(clients);
  if (process.argv.includes("--before-only")) {
    await selfApprovalPatch(clients, true);
    await rlsInvariant(clients);
  } else if (process.argv.includes("--after-self")) {
    await selfApprovalPatch(clients, false);
    await rlsInvariant(clients);
  } else {
    await fullSuite(clients,key);
  }
});
