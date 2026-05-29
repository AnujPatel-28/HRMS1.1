import type { AttendancePolicyForm, TaskPolicyForm, LeavePolicyForm, SalaryPolicyForm, LeaveTypeForm } from "../hr/PolicyCenter";

export type ValidationResult = {
  valid: boolean;
  errors: Record<string, string>;
};

export function validateAttendancePolicy(policy: AttendancePolicyForm): ValidationResult {
  const errors: Record<string, string> = {};

  if (policy.late_mark_enabled) {
    if (Number(policy.late_mark_grace_minutes) < 0) {
      errors.late_mark_grace_minutes = "Grace minutes cannot be negative.";
    }
    if (Number(policy.late_mark_threshold) < 0) {
      errors.late_mark_threshold = "Late mark threshold cannot be negative.";
    }
    if (Number(policy.late_mark_deduction_hours) < 0) {
      errors.late_mark_deduction_hours = "Deduction hours cannot be negative.";
    }
  }

  if (policy.overtime_enabled) {
    if (Number(policy.overtime_rate) < 1.0) {
      errors.overtime_rate = "Overtime rate must be at least 1.0.";
    }
  }

  if (policy.geofence_enabled) {
    if (Number(policy.geofence_radius_meters) < 50) {
      errors.geofence_radius_meters = "Geofence radius must be at least 50 meters.";
    }
    if (!policy.office_lat.trim() || isNaN(Number(policy.office_lat))) {
      errors.office_lat = "Valid office latitude is required.";
    }
    if (!policy.office_lng.trim() || isNaN(Number(policy.office_lng))) {
      errors.office_lng = "Valid office longitude is required.";
    }
  }

  if (policy.regularization_enabled) {
    if (Number(policy.regularization_window_days) < 1) {
      errors.regularization_window_days = "Regularization window must be at least 1 day.";
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

export function validateTaskPolicy(policy: TaskPolicyForm): ValidationResult {
  const errors: Record<string, string> = {};

  if (Number(policy.task_grace_period_minutes) < 0) {
    errors.task_grace_period_minutes = "Task grace period cannot be negative.";
  }
  if (Number(policy.task_grace_period_minutes) > 480) {
    errors.task_grace_period_minutes = "Task grace period is unreasonably high.";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

export function validateLeavePolicy(policy: LeavePolicyForm): ValidationResult {
  const errors: Record<string, string> = {};

  if (Number(policy.leave_min_notice_days) < 0) {
    errors.leave_min_notice_days = "Notice days cannot be negative.";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

export function validateSalaryPolicy(policy: SalaryPolicyForm): ValidationResult {
  const errors: Record<string, string> = {};

  if (Number(policy.pf_wage_ceiling) < 0) {
    errors.pf_wage_ceiling = "PF wage ceiling cannot be negative.";
  }
  if (Number(policy.esi_gross_ceiling) < 0) {
    errors.esi_gross_ceiling = "ESI gross ceiling cannot be negative.";
  }
  if (policy.professional_tax_state === "manual" && Number(policy.professional_tax_manual_amount) < 0) {
    errors.professional_tax_manual_amount = "PT amount cannot be negative.";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

export function validateLeaveType(policy: LeaveTypeForm): ValidationResult {
  const errors: Record<string, string> = {};

  if (!policy.name.trim()) {
    errors.name = "Leave type name is required.";
  }
  if (!policy.code.trim()) {
    errors.code = "Leave type code is required.";
  }

  // Days per year validation
  if (policy.days_per_year.trim()) {
    const val = Number(policy.days_per_year);
    if (isNaN(val) || val < 0) {
      errors.days_per_year = "Days per year must be a valid non-negative number.";
    }
  }

  // Carry forward validation
  if (policy.carry_forward) {
    if (!policy.max_carry_forward_days.trim()) {
      errors.max_carry_forward_days = "Max carry forward days is required when carry forward is enabled.";
    } else {
      const val = Number(policy.max_carry_forward_days);
      if (isNaN(val) || val < 0) {
        errors.max_carry_forward_days = "Max carry forward days must be a valid non-negative number.";
      }
    }
  }

  // Applicable after days validation
  if (policy.applicable_after_days.trim()) {
    const val = Number(policy.applicable_after_days);
    if (isNaN(val) || !Number.isInteger(val) || val < 0) {
      errors.applicable_after_days = "Applicable after days must be a valid non-negative integer.";
    }
  }

  // Minimum notice days validation
  if (policy.minimum_notice_days.trim()) {
    const val = Number(policy.minimum_notice_days);
    if (isNaN(val) || !Number.isInteger(val) || val < 0) {
      errors.minimum_notice_days = "Minimum notice days must be a valid non-negative integer.";
    }
  }

  // Maximum consecutive days validation
  if (policy.maximum_consecutive_days.trim()) {
    const val = Number(policy.maximum_consecutive_days);
    if (isNaN(val) || !Number.isInteger(val) || val < 1) {
      errors.maximum_consecutive_days = "Max consecutive days must be a valid integer of at least 1.";
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}
