/*
  Align inherited maintenance tables with the operational maintenance board.

  The Bolt database retained the original due_condition fields while the
  current board also needs explicit interval and next-due values.
*/

ALTER TABLE public.maintenance_milestones
  ADD COLUMN IF NOT EXISTS type text DEFAULT 'hours',
  ADD COLUMN IF NOT EXISTS interval_hours numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS interval_months integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_completed_date date,
  ADD COLUMN IF NOT EXISTS last_completed_tach numeric,
  ADD COLUMN IF NOT EXISTS next_due_hours numeric,
  ADD COLUMN IF NOT EXISTS next_due_date date,
  ADD COLUMN IF NOT EXISTS description text;

ALTER TABLE public.maintenance_completions
  ADD COLUMN IF NOT EXISTS completed_date date,
  ADD COLUMN IF NOT EXISTS completed_tach numeric,
  ADD COLUMN IF NOT EXISTS next_due_hours numeric,
  ADD COLUMN IF NOT EXISTS next_due_date date;
