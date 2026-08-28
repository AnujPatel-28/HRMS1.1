# 01 - Organisation Module: Overview & Concepts

**The Foundation Module.** Every other module in the HRMS joins to the Organisation Module. 
- Attendance needs shifts per location.
- Leave needs grades for policy defaults.
- The Approval Engine needs unit heads to resolve `dept_head`.
- Payroll needs effective-dated grades and structure. 

Getting this shape right ensures that every other module scales smoothly.

---

## 1. Core Philosophy: Independent Dimensions

The biggest mistake HR systems make is conflating "where you sit" with "who you report to" or "what you do." In this system, an employee's record is composed of strictly independent dimensions.

```text
┌─────────────────────────────────┐
│             EMPLOYEE            │
├─────────────────────────────────┤
│ Organisation: ABC Technologies  │  ← The Tenant
│                                 │
│ Belongs to:  Backend Team       │  ← ORG TREE (Where you belong)
│ Reports to:  Priya              │  ← REPORTING TREE (Who manages you)
│ Job title:   Backend Engineer   │  ← Designation (What you do)
│ Grade:       L3                 │  ← Grade/Band (Your defaults)
│ Employment:  Full-time          │  ← Contract Type
│ Location:    Ahmedabad Office   │  ← Location (Where you sit)
└─────────────────────────────────┘
```

### The "Two Trees" Concept
Matrix organisations are real. You can sit in the Backend Team while reporting to someone completely outside of it. A model with only one tree cannot express that.
Therefore, there are **two separate trees**:
1. **Organisation Tree**: Built from `org_units.parent_id`. Answers *"Where does this person belong?"*
2. **Reporting Tree**: Built from `employee_reporting_relationships`. Answers *"Who manages this person?"*

*(For detailed information on the database tables that support this architecture, please see `02-database-schema-and-er.md`)*
