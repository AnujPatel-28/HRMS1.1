# TalentMesh HRMS Documentation

Welcome to the developer documentation index for the **TalentMesh HRMS** platform. This system is integrated with the **InsForge** Backend-as-a-Service (BaaS) platform.

---

## 🛠️ Backend Configuration (InsForge)

The project is connected to the following InsForge backend:
* **Project Name**: `HRMS`
* **Project ID**: `0431f0f6-225f-4fb1-86b7-3fd32684c7f4`
* **Organization ID**: `8a53667f-c2f5-4782-81d5-fc8358f2f6f7`
* **API Base URL**: `https://rq3qmu8y.ap-southeast.insforge.app`
* **Region**: `ap-southeast`
* **Default Tenant ID**: `111035ce-979c-429a-a482-ddfa87dbfe6e`

---

## 📁 System Architecture & Core Modules

The codebase is organized into several key directories:
* **[/src](file:///c:/Users/Anuj/Desktop/hrms/HRMS-Talentmesh-Solutions/src)**: Main React application source code.
  * **[/src/hr](file:///c:/Users/Anuj/Desktop/hrms/HRMS-Talentmesh-Solutions/src/hr)**: HR Administrator views, dashboards, and settings.
  * **[/src/employee](file:///c:/Users/Anuj/Desktop/hrms/HRMS-Talentmesh-Solutions/src/employee)**: Employee Self-Service (ESS) features.
  * **[/src/shared](file:///c:/Users/Anuj/Desktop/hrms/HRMS-Talentmesh-Solutions/src/shared)**: Shared UI components (Direct Messaging, authentication, global layouts).
  * **[/src/insforge](file:///c:/Users/Anuj/Desktop/hrms/HRMS-Talentmesh-Solutions/src/insforge)**: InsForge SDK client initialization.
* **[/functions](file:///c:/Users/Anuj/Desktop/hrms/HRMS-Talentmesh-Solutions/functions)**: Serverless backend Edge Functions deployed to InsForge (e.g., employee creation, late marks calculation, attendance rules).

---

## 📖 Key Documentation References

For in-depth explanations of individual subsystems, refer to:

* 🗄️ **[Database Schema Dictionary](file:///c:/Users/Anuj/Desktop/hrms/HRMS-Talentmesh-Solutions/doc/database_schema.md)**
  Comprehensive map of all active tables, primary/foreign keys, and columns validated against the live schema.
* 📦 **[Serverless Edge Functions](file:///c:/Users/Anuj/Desktop/hrms/HRMS-Talentmesh-Solutions/doc/edge_functions.md)**
  Catalog of Deno edge handlers, their authorization steps, and runtime triggers.
* 🏛️ **[Frontend Portal Architecture & State](file:///c:/Users/Anuj/Desktop/hrms/HRMS-Talentmesh-Solutions/doc/frontend_architecture.md)**
  React portal hierarchy, routing guards, subdomain parsing, and custom React hook states.
* 📅 **[Core Business Workflows & Lifecycles](file:///c:/Users/Anuj/Desktop/hrms/HRMS-Talentmesh-Solutions/doc/business_workflows.md)**
  Sequence maps for leave approval chains, clock-in validations, geofencing, and the monthly payroll run.
* 🛡️ **[Security, RLS & Authorization](file:///c:/Users/Anuj/Desktop/hrms/HRMS-Talentmesh-Solutions/doc/security_architecture.md)**
  Detailed analysis of permissive/restrictive policies, secure DB routines context, and privilege escalation defenses.
* 💬 **[Real-Time Chat & Workspace Notifications](file:///c:/Users/Anuj/Desktop/hrms/HRMS-Talentmesh-Solutions/doc/chat_notifications.md)**
  Detailed view of WebSockets lifecycle, database-level triggers, client-side tenant verification, and message flows.
* ⏰ **[Time Clock, Break Tracking & Location Geo-fencing](file:///c:/Users/Anuj/Desktop/hrms/HRMS-Talentmesh-Solutions/doc/attendance_geofencing.md)**
  Detailed view of coordinates capture, geofencing radii checking, break tracking RPCs, selfie verification, and late marks calculations.
* 🏢 **[Employee Onboarding & KYC Document Storage](file:///c:/Users/Anuj/Desktop/hrms/HRMS-Talentmesh-Solutions/doc/employee_onboarding.md)**
  Detailed view of registration wizard steps, Deno Edge Function pipelines, rate limiting, sessionStorage caching, and file uploads.
* 🛠️ **[Developer Environment & Deployment Guide](file:///c:/Users/Anuj/Desktop/hrms/HRMS-Talentmesh-Solutions/doc/developer_guide.md)**
  Detailed view of local environment configurations, integration testing scripts execution, and backend/frontend deployment instructions.
* 💵 **[Salary Structures & Payslip Generation](file:///c:/Users/Anuj/Desktop/hrms/HRMS-Talentmesh-Solutions/doc/payroll_generation.md)**
  Detailed view of gross-to-net calculations, LOP proration methods, late mark deduction Edge Function integration, and PDF storage upload pipelines.
* 📅 **[Shift Rostering & Scheduling Engine](file:///c:/Users/Anuj/Desktop/hrms/HRMS-Talentmesh-Solutions/doc/shift_rostering.md)**
  Detailed view of custom timing templates, gapless effective-dated scheduling rules, soft deactivation parameters, and tier-based resolution fallbacks.
* 🏢 **[Platform Administration & Tenant Provisioning](file:///c:/Users/Anuj/Desktop/hrms/HRMS-Talentmesh-Solutions/doc/platform_admin.md)**
  Detailed view of superadmin role resolution, subdomain validation saga, transactional rollback guards, user onboarding Edge Functions, and database triggers.
* 📂 **[HR Policies & Settings Policy Center](file:///c:/Users/Anuj/Desktop/hrms/HRMS-Talentmesh-Solutions/doc/policies.md)**
  Detailed view of corporate policy publications, visibilities filtering logic, document upload saga rollbacks, and global settings verification rules.

---

## 🔒 Legacy Security References
* [LIVE_RLS_VERIFICATION.md](file:///c:/Users/Anuj/Desktop/hrms/HRMS-Talentmesh-Solutions/LIVE_RLS_VERIFICATION.md) - RLS check guidelines.
* [SECURITY_AUDIT_RLS.md](file:///c:/Users/Anuj/Desktop/hrms/HRMS-Talentmesh-Solutions/SECURITY_AUDIT_RLS.md) - Historical RLS review report.
