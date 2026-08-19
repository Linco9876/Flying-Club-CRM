-- The RPC examiner declaration is still recorded, but no portal evidence or
-- authority-form upload is required.

update public.training_courses course
set review_configuration = jsonb_set(
      course.review_configuration,
      '{checklist}',
      coalesce((
        select jsonb_agg(
          case
            when item->>'key' = 'RPC-CMP-04' then item || jsonb_build_object(
              'title', 'Complete the examiner declaration',
              'guidance', 'Record the test outcome and examiner certification. No portal upload is required.'
            )
            else item
          end
          order by ordinal
        )
        from jsonb_array_elements(coalesce(course.review_configuration->'checklist', '[]'::jsonb))
          with ordinality as checklist(item, ordinal)
      ), '[]'::jsonb),
      true
    ),
    last_updated = now()
where course.review_configuration->>'review_type' = 'raaus_rpc_flight_test';

update public.flight_review_records record
set template_snapshot = jsonb_set(
      record.template_snapshot,
      '{review_configuration,checklist}',
      coalesce((
        select jsonb_agg(
          case
            when item->>'key' = 'RPC-CMP-04' then item || jsonb_build_object(
              'title', 'Complete the examiner declaration',
              'guidance', 'Record the test outcome and examiner certification. No portal upload is required.'
            )
            else item
          end
          order by ordinal
        )
        from jsonb_array_elements(coalesce(record.template_snapshot->'review_configuration'->'checklist', '[]'::jsonb))
          with ordinality as checklist(item, ordinal)
      ), '[]'::jsonb),
      true
    )
where record.review_type = 'raaus_rpc_flight_test'
  and record.status in ('draft', 'in_progress', 'further_training_required');

update public.flight_review_record_items item
set title = 'Complete the examiner declaration',
    guidance = 'Record the test outcome and examiner certification. No portal upload is required.',
    updated_at = now()
from public.flight_review_records record
where record.id = item.review_record_id
  and record.review_type = 'raaus_rpc_flight_test'
  and record.status in ('draft', 'in_progress', 'further_training_required')
  and item.template_item_key = 'RPC-CMP-04';
