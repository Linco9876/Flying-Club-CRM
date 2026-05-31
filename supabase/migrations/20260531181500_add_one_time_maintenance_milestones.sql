/*
  Add support for one-time maintenance milestones.

  One-time work remains in the maintenance history after completion but does
  not roll forward into another due cycle.
*/

ALTER TABLE public.maintenance_milestones
ADD COLUMN IF NOT EXISTS is_one_time boolean NOT NULL DEFAULT false;
