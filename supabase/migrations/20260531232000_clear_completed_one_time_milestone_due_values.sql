/*
  Completed one-time milestones should remain as history only.
  Clear due fields so they cannot be selected as the next active milestone.
*/

UPDATE public.maintenance_milestones
SET
  next_due_hours = NULL,
  next_due_date = NULL,
  due_value = '',
  updated_at = now()
WHERE is_one_time = true
  AND status = 'completed'
  AND (next_due_hours IS NOT NULL OR next_due_date IS NOT NULL OR due_value <> '');
