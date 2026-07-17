REVOKE ALL ON FUNCTION public.save_instructor_compliance_template(
  uuid,
  text,
  text,
  text,
  jsonb,
  boolean,
  jsonb
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.save_instructor_compliance_template(
  uuid,
  text,
  text,
  text,
  jsonb,
  boolean,
  jsonb
) TO authenticated, service_role;
