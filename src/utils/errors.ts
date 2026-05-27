export class PayrollError extends Error {
  constructor(
    public code: "PAYROLL_LOCKED" | "INVALID_POLICY_CONFIGURATION" | "PAYROLL_POLICY_MISSING" | "DIVISION_GUARD_TRIGGERED",
    message: string
  ) {
    super(message);
    this.name = "PayrollError";
  }
}
