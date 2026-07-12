-- Migration: RLS Policy Refactoring and Standardization
-- Created: 2026-07-12
-- Target Tables: public.attendance, public.attendance_breaks, public.attendance_selfies, public.attendance_corrections

-- ==========================================
-- 1. public.attendance
-- ==========================================
-- Drop old permissive policies
DROP POLICY IF EXISTS attendance_hr_all ON public.attendance;
DROP POLICY IF EXISTS attendance_self_read ON public.attendance;
DROP POLICY IF EXISTS attendance_self_update ON public.attendance;
DROP POLICY IF EXISTS attendance_self_write ON public.attendance;

-- Create operation-specific permissive policies for HR
CREATE POLICY attendance_select_hr ON public.attendance
  AS PERMISSIVE FOR SELECT TO authenticated USING (is_hr());

CREATE POLICY attendance_insert_hr ON public.attendance
  AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (is_hr());

CREATE POLICY attendance_update_hr ON public.attendance
  AS PERMISSIVE FOR UPDATE TO authenticated USING (is_hr()) WITH CHECK (is_hr());

CREATE POLICY attendance_delete_hr ON public.attendance
  AS PERMISSIVE FOR DELETE TO authenticated USING (is_hr());

-- Rename / Re-create standard employee self policies
CREATE POLICY attendance_select_self ON public.attendance
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM employees e WHERE e.id = attendance.employee_id AND e.user_id = auth.uid()));

CREATE POLICY attendance_update_self ON public.attendance
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM employees e WHERE e.id = attendance.employee_id AND e.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM employees e WHERE e.id = attendance.employee_id AND e.user_id = auth.uid()));

CREATE POLICY attendance_insert_self ON public.attendance
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM employees e WHERE e.id = attendance.employee_id AND e.user_id = auth.uid()));


-- ==========================================
-- 2. public.attendance_breaks
-- ==========================================
-- Drop old permissive policies
DROP POLICY IF EXISTS breaks_hr_all ON public.attendance_breaks;
DROP POLICY IF EXISTS breaks_self_read ON public.attendance_breaks;

-- Create operation-specific permissive policies for HR
CREATE POLICY attendance_breaks_select_hr ON public.attendance_breaks
  AS PERMISSIVE FOR SELECT TO authenticated USING (is_hr());

CREATE POLICY attendance_breaks_insert_hr ON public.attendance_breaks
  AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (is_hr());

CREATE POLICY attendance_breaks_update_hr ON public.attendance_breaks
  AS PERMISSIVE FOR UPDATE TO authenticated USING (is_hr()) WITH CHECK (is_hr());

CREATE POLICY attendance_breaks_delete_hr ON public.attendance_breaks
  AS PERMISSIVE FOR DELETE TO authenticated USING (is_hr());

-- Rename / Re-create standard employee self policies
CREATE POLICY attendance_breaks_select_self ON public.attendance_breaks
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM employees e WHERE e.id = attendance_breaks.employee_id AND e.user_id = auth.uid()));


-- ==========================================
-- 3. public.attendance_selfies
-- ==========================================
-- Drop old permissive policies
DROP POLICY IF EXISTS selfies_hr_all ON public.attendance_selfies;
DROP POLICY IF EXISTS selfies_self_read ON public.attendance_selfies;
DROP POLICY IF EXISTS selfies_self_insert ON public.attendance_selfies;

-- Create operation-specific permissive policies for HR
CREATE POLICY attendance_selfies_select_hr ON public.attendance_selfies
  AS PERMISSIVE FOR SELECT TO authenticated USING (is_hr());

CREATE POLICY attendance_selfies_insert_hr ON public.attendance_selfies
  AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (is_hr());

CREATE POLICY attendance_selfies_update_hr ON public.attendance_selfies
  AS PERMISSIVE FOR UPDATE TO authenticated USING (is_hr()) WITH CHECK (is_hr());

CREATE POLICY attendance_selfies_delete_hr ON public.attendance_selfies
  AS PERMISSIVE FOR DELETE TO authenticated USING (is_hr());

-- Rename / Re-create standard employee self policies
CREATE POLICY attendance_selfies_select_self ON public.attendance_selfies
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (employee_id = (SELECT id FROM employees WHERE user_id = auth.uid()));

CREATE POLICY attendance_selfies_insert_self ON public.attendance_selfies
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM attendance a JOIN employees e ON e.id = a.employee_id WHERE a.id = attendance_selfies.attendance_id AND e.user_id = auth.uid()));


-- ==========================================
-- 4. public.attendance_corrections
-- ==========================================
-- Drop old permissive policies
DROP POLICY IF EXISTS attendance_corrections_hr_all ON public.attendance_corrections;
DROP POLICY IF EXISTS attendance_corrections_self ON public.attendance_corrections;

-- Create operation-specific permissive policies for HR
CREATE POLICY attendance_corrections_select_hr ON public.attendance_corrections
  AS PERMISSIVE FOR SELECT TO authenticated USING (is_hr());

CREATE POLICY attendance_corrections_insert_hr ON public.attendance_corrections
  AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (is_hr());

CREATE POLICY attendance_corrections_update_hr ON public.attendance_corrections
  AS PERMISSIVE FOR UPDATE TO authenticated USING (is_hr()) WITH CHECK (is_hr());

CREATE POLICY attendance_corrections_delete_hr ON public.attendance_corrections
  AS PERMISSIVE FOR DELETE TO authenticated USING (is_hr());

-- Rename / Re-create unified self-ownership policy
CREATE POLICY attendance_corrections_self ON public.attendance_corrections
  AS PERMISSIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees e WHERE e.id = attendance_corrections.employee_id AND e.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM employees e WHERE e.id = attendance_corrections.employee_id AND e.user_id = auth.uid()));
