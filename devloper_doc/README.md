# Developer Documentation

Module-level developer docs. Each set opens with a `00-README.md` — start there.

| Module | State | Start at |
|---|---|---|
| [Organisation](organizationModule/00-README.md) | ✅ Rebuilt | `00-README.md` |
| [Attendance](attendanceModule/00-README.md) | ✅ Rebuilt | `00-README.md` |
| [Leave](leaveModule/00-README.md) | ❌ Not rebuilt — `leave_balances` is still a counter, not a ledger | `00-README.md` |
| [Onboarding / Add Employee](onboardingModule/00-README.md) | ❌ Not rebuilt — was impassable end to end until 2026-09-02 | `00-README.md`, then `06-gotchas-and-history.md` |

## Before you debug anything in a NOT-rebuilt module

Organisation and Attendance were rebuilt on the module/contract substrate. The others were not, and
they still speak the vocabulary of the schema Organisation replaced — renamed columns, dropped
columns whose function parameters survived, and legacy text columns whose CHECK constraints know
nothing about the lookup tables now feeding them.

**So the first hypothesis is "what did Organisation rename or drop that this still uses?", not
"what is wrong with my input?"** Seven consecutive failures in the onboarding wizard were all that
shape; see `onboardingModule/06-gotchas-and-history.md`.

Wider context: `doc/hrms_vision_and_frd_2026-09-02.md` (§0 status, §5.3a why this happened) and
`doc/hrms_target_state_frd_2026-09-02.md` (what each module is built toward).
