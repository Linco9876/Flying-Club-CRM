-- Repair the already-deployed duty assessment function without duplicating its large body.
-- Fresh databases receive the corrected declaration from the preceding migration.
do $repair$
declare
  v_definition text;
  v_corrected text;
begin
  select pg_get_functiondef(
    'public.assess_instructor_duty_booking(uuid,timestamp with time zone,timestamp with time zone,uuid)'::regprocedure
  ) into v_definition;

  v_corrected := replace(
    v_definition,
    'v_codes text[] := ''{}'';',
    'v_codes text[] := array[]::text[];'
  );

  if v_corrected = v_definition then
    -- pg_get_functiondef may preserve an explicit text cast depending on server version.
    v_corrected := replace(
      v_definition,
      'v_codes text[] := ''{}''::text;',
      'v_codes text[] := array[]::text[];'
    );
  end if;

  if v_corrected = v_definition then
    -- A fresh rebuild already receives the corrected declaration from the
    -- preceding migration. Treat that state as success so recovery restores
    -- remain repeatable, while retaining the repair for older deployments.
    if position('v_codes text[] := array[]::text[];' in v_definition) > 0 then
      raise notice 'Duty assessment array declaration is already correct';
      return;
    end if;

    raise exception 'Could not locate the duty assessment array declaration to repair';
  end if;

  execute v_corrected;
end
$repair$;
