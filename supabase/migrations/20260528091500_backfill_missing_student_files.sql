/*
  Backfill student file rows for existing users.

  Some Bolt-created users can exist in public.users and auth.users before a
  matching public.students row is created. The CRM treats the student file as
  the operational record for billing, compliance, documents and training, so
  every user needs a base row even when most aviation fields are blank.
*/

INSERT INTO public.students (id, prepaid_balance)
SELECT u.id, 0
FROM public.users u
LEFT JOIN public.students s ON s.id = u.id
WHERE s.id IS NULL
ON CONFLICT (id) DO NOTHING;
