/*
  Prevent duplicate automatic maintenance milestones.

  Keep the most useful existing milestone for each aircraft and title, then
  enforce the identity used by the maintenance board initializer.
*/

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY aircraft_id, title
      ORDER BY
        (next_due_hours IS NOT NULL OR next_due_date IS NOT NULL) DESC,
        created_at ASC,
        id ASC
    ) AS row_number
  FROM public.maintenance_milestones
)
DELETE FROM public.maintenance_milestones milestone
USING ranked
WHERE milestone.id = ranked.id
  AND ranked.row_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS maintenance_milestones_aircraft_title_key
ON public.maintenance_milestones (aircraft_id, title);
