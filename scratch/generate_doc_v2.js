import fs from "fs";

const raw = fs.readFileSync("scratch/schema_dump.json", "utf-8");
const data = JSON.parse(raw);

const tableDescriptions = {
  "activity": "Logs user activity history.",
  "admin_users": "Internal table syncing admin roles for policy assessments.",
  "ai_suggestion_cache": "Cache storage for AI suggestions.",
  "announcement_dismissals": "Records which users dismissed specific announcements.",
  "announcements": "Company-wide announcements created by HR.",
  "attendance": "Main clock-in/out records, locations, and verification status.",
  "attendance_audit_logs": "Audit trail of changes made to attendance logs.",
  "attendance_breaks": "Tracks break start/end times and durations for employees.",
  "attendance_corrections": "Requests by employees to correct past punch records.",
  "attendance_location_exceptions": "Pre-approved permissions for remote/out-of-office punches.",
  "attendance_selfies": "Stores paths to photos taken at punch-in/out for identity verification.",
  "audit_logs": "General application audit log.",
  "calendar_events": "Internal calendar events.",
  "chat_channel_members": "Links employees to chat channels.",
  "chat_channels": "Group or direct chat channels.",
  "chat_messages": "Chat messages within channels.",
  "employee_documents": "Document repository for employees (contracts, IDs, etc.).",
  "employee_onboarding": "Status tracking for employee onboarding workflows.",
  "employee_shifts": "Assigns shifts to employees for specific timeframes.",
  "employees": "Main employee records including payroll, contact, bio and directory fields.",
  "expenses": "Employee expense claims with status and payroll references.",
  "holidays": "Gazetted/company holiday list.",
  "hr_policies": "Policy documents uploaded by HR.",
  "insurance_policies": "Employee group health/life insurance policy detail records.",
  "it_declaration_windows": "Open/closed window periods for tax declarations.",
  "it_declarations": "Detailed tax investment declarations submitted by employees.",
  "leave_balances": "Available/accrued leave counts per type per employee.",
  "leave_types": "Categories of leaves (Casual, Sick, Paid).",
  "leaves": "Leave requests and approval status.",
  "notifications": "In-app user notifications.",
  "office_locations": "Registered office coordinates for geofenced attendance checks.",
  "overtime_records": "Approved employee overtime work logs.",
  "payroll_runs": "Monthly payroll processing records.",
  "payslips": "Generated PDF salary statements linked to payroll runs.",
  "platform_admins": "Platform-level superadmin users.",
  "platform_audit_logs": "Audit logs for system/tenant setup changes.",
  "platform_settings": "Global configuration variables.",
  "profiles": "Core user profile identities.",
  "projects": "Project definitions under which tasks are organized.",
  "rate_limits": "API endpoint call rate limiting logs.",
  "salary_structures": "Salary templates and basic/allowance breakdown settings.",
  "shifts": "Shift timing profiles.",
  "task_submissions": "Uploaded completions for tasks.",
  "tasks": "Task assignments with status, priority, and project links.",
  "tenant_settings": "Configuration variables scoped to specific tenants.",
  "tenants": "Customer tenant entities under the SaaS system.",
  "test_log": "Useless test table.",
  "test_mcp_sync": "Useless test table.",
  "applications": "Recruitment Module (Unused): Candidate job applications.",
  "application_events": "Recruitment Module (Unused): Log events for job applications.",
  "application_status_history": "Recruitment Module (Unused): History of state transitions for applications.",
  "candidate_profiles": "Recruitment Module (Unused): Profile details of candidates.",
  "candidate_resumes": "Recruitment Module (Unused): Stored resumes of candidates.",
  "company_profiles": "Recruitment Module (Unused): Recruiter company details.",
  "custom_proposals": "Recruitment Module (Unused): Proposal templates for job offers.",
  "job_alerts": "Recruitment Module (Unused): Alert settings for matching jobs.",
  "jobs": "Recruitment Module (Unused): Job listings.",
  "nvites": "Recruitment Module (Unused): Invitation records for recruiters/candidates.",
  "recruiter_profiles": "Recruitment Module (Unused): Profile data for recruiter users.",
  "resume_access_log": "Recruitment Module (Unused): Logging details when candidate resumes are accessed.",
  "subscription_events": "Recruitment Module (Unused): Transaction logs for recruitment SaaS billing.",
  "subscriptions": "Recruitment Module (Unused): Active subscription plans for recruiter companies."
};

const tables = {};
data.columns.forEach((row) => {
  if (!tables[row.table_name]) {
    tables[row.table_name] = {
      name: row.table_name,
      columns: [],
      fks: [],
      referencedBy: []
    };
  }
  tables[row.table_name].columns.push({
    name: row.column_name,
    type: row.data_type,
    nullable: row.is_nullable === "YES"
  });
});

data.fks.forEach((fk) => {
  if (tables[fk.table_name]) {
    tables[fk.table_name].fks.push(fk);
  }
  if (tables[fk.foreign_table_name]) {
    tables[fk.foreign_table_name].referencedBy.push(fk);
  }
});

// Build ER diagram (Mermaid)
let mermaid = "```mermaid\nerDiagram\n";
const relations = new Set();
data.fks.forEach((fk) => {
  const relStr = `    ${fk.table_name} }|--|| ${fk.foreign_table_name} : "${fk.column_name} -> ${fk.foreign_column_name}"`;
  relations.add(relStr);
});
relations.forEach((rel) => {
  mermaid += rel + "\n";
});
mermaid += "```\n";

// Recruitment related tables identified for cleanup
const recruitmentTables = [
  "applications",
  "application_events",
  "application_status_history",
  "candidate_profiles",
  "candidate_resumes",
  "company_profiles",
  "custom_proposals",
  "job_alerts",
  "jobs",
  "nvites",
  "recruiter_profiles",
  "resume_access_log",
  "subscription_events",
  "subscriptions"
];

// Identify isolated/cleanup tables that still exist in the database
const existingRecruitmentTables = recruitmentTables.filter(t => tables[t]);
const hasTestLog = !!tables["test_log"];
const hasTestMcpSync = !!tables["test_mcp_sync"];

// Write markdown content
let md = `# Live Database Schema and ER Diagram (updateSuggestion Branch)
This document is automatically generated from the active PostgreSQL database instance on the \`updateSuggestion\` preview backend (\`https://rq3qmu8y-jx7.ap-southeast.insforge.app\`).

---

## 📊 Entity Relationship Diagram

${mermaid}

---

## 🔍 Isolated & Useless Tables (Targeted for Cleanup)
The following tables are isolated from the core HRMS product and are candidates for cleanup or have been successfully removed:

| Table Name | Description | Status |
|------------|-------------|--------|
${existingRecruitmentTables.map((t) => `| \`${t}\` | ${tableDescriptions[t]} | ⚠️ **Unused / Candidate for Deletion** |`).join("\n")}
${existingRecruitmentTables.length === 0 ? "| *None* | All recruitment module tables have been successfully deleted. | ✅ **Cleaned** |" : ""}
${hasTestLog ? `| \`test_log\` | Useless test table. | ⚠️ **Unused / Candidate for Deletion** |` : ""}
${hasTestMcpSync ? `| \`test_mcp_sync\` | Useless test table. | ⚠️ **Unused / Candidate for Deletion** |` : ""}

---

## 🗄️ Core Tables and Columns Documentation

`;

Object.keys(tables).sort().forEach((tableName) => {
  const t = tables[tableName];
  const isRecruitment = recruitmentTables.includes(tableName);
  const isTest = tableName === "test_log" || tableName === "test_mcp_sync";
  const categoryHeader = isRecruitment ? "⚠️ Unused Recruitment Table" : (isTest ? "⚠️ Unused Test Table" : "✅ Core HRMS Table");

  md += `### \`${tableName}\` (${categoryHeader})
*Description: ${tableDescriptions[tableName] || "No description provided."}*

**Columns:**
| Column Name | Data Type | Nullable? | Foreign Key? |
|-------------|-----------|-----------|--------------|
`;
  t.columns.forEach((c) => {
    const fkMatch = t.fks.find((fk) => fk.column_name === c.name);
    const fkText = fkMatch ? `🔑 Links to [\`${fkMatch.foreign_table_name}.${fkMatch.foreign_column_name}\`](#${fkMatch.foreign_table_name.replace(/_/g, "")})` : "";
    md += `| \`${c.name}\` | \`${c.type}\` | ${c.nullable ? "✅ Yes" : "❌ No"} | ${fkText} |\n`;
  });
  md += "\n";
});

fs.writeFileSync("LIVE_DATABASE_SCHEMA_AND_ER.md", md);
console.log("Successfully generated LIVE_DATABASE_SCHEMA_AND_ER.md");
