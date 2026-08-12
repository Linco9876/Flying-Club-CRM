-- Billing settings span four related tables. Save the complete configuration in
-- one transaction so a failed rate or provider rule cannot leave a partial edit.

create or replace function public.save_billing_configuration(
  p_payment_methods jsonb,
  p_flight_types jsonb,
  p_ground_options jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item jsonb;
  v_rate jsonb;
  v_id uuid;
  v_reference_id uuid;
  v_client_id text;
  v_reference text;
  v_uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  v_payment_ids uuid[] := '{}';
  v_flight_type_ids uuid[] := '{}';
  v_ground_option_ids uuid[] := '{}';
  v_rate_type_ids uuid[];
  v_payment_map jsonb := '{}'::jsonb;
  v_flight_type_map jsonb := '{}'::jsonb;
  v_existing_system boolean;
  v_existing_system_key text;
  v_is_existing boolean;
  v_pricing_mode text;
  v_active_count integer;
  v_unique_name_count integer;
  v_allowed_roles text[];
begin
  if not public.current_user_is_admin() then
    raise exception 'Administrator MFA verification is required';
  end if;

  if jsonb_typeof(p_payment_methods) <> 'array'
     or jsonb_typeof(p_flight_types) <> 'array'
     or jsonb_typeof(p_ground_options) <> 'array' then
    raise exception 'Billing settings payload is invalid';
  end if;

  select
    count(*) filter (where coalesce((item->>'active')::boolean, false)),
    count(distinct lower(btrim(item->>'name'))) filter (where coalesce((item->>'active')::boolean, false))
  into v_active_count, v_unique_name_count
  from jsonb_array_elements(p_payment_methods) item;

  if v_active_count < 1 then raise exception 'Keep at least one active Payment Method'; end if;
  if v_unique_name_count <> v_active_count then raise exception 'Active Payment Method names must be unique'; end if;

  for v_item in select value from jsonb_array_elements(p_payment_methods)
  loop
    if nullif(btrim(v_item->>'name'), '') is null then
      raise exception 'Every Payment Method needs a name';
    end if;

    v_client_id := coalesce(v_item->>'id', '');
    v_id := case when v_client_id ~* v_uuid_pattern then v_client_id::uuid else gen_random_uuid() end;
    select is_system, system_key
      into v_existing_system, v_existing_system_key
    from public.payment_methods
    where id = v_id;
    v_is_existing := found;

    insert into public.payment_methods(
      id, name, description, active, display_order, allow_account_topup,
      is_system, system_key, updated_at
    ) values (
      v_id,
      btrim(v_item->>'name'),
      nullif(btrim(v_item->>'description'), ''),
      coalesce((v_item->>'active')::boolean, true),
      coalesce((v_item->>'displayOrder')::integer, array_length(v_payment_ids, 1) + 1, 1),
      coalesce((v_item->>'allowAccountTopup')::boolean, true),
      case when v_is_existing then coalesce(v_existing_system, false) else false end,
      case when v_is_existing then v_existing_system_key else null end,
      now()
    )
    on conflict(id) do update set
      name = excluded.name,
      description = excluded.description,
      active = excluded.active,
      display_order = excluded.display_order,
      allow_account_topup = excluded.allow_account_topup,
      updated_at = excluded.updated_at;

    v_payment_ids := array_append(v_payment_ids, v_id);
    if v_client_id <> '' then
      v_payment_map := v_payment_map || jsonb_build_object(v_client_id, v_id::text);
    end if;
  end loop;

  update public.payment_methods
  set active = false, updated_at = now()
  where not (id = any(v_payment_ids)) and active;

  select
    count(*) filter (where coalesce((item->>'active')::boolean, false)),
    count(distinct lower(btrim(item->>'name'))) filter (where coalesce((item->>'active')::boolean, false))
  into v_active_count, v_unique_name_count
  from jsonb_array_elements(p_flight_types) item;

  if v_active_count < 1 then raise exception 'Keep at least one active Payment Type'; end if;
  if v_unique_name_count <> v_active_count then raise exception 'Active Payment Type names must be unique'; end if;

  for v_item in select value from jsonb_array_elements(p_flight_types)
  loop
    if nullif(btrim(v_item->>'name'), '') is null then
      raise exception 'Every Payment Type needs a name';
    end if;

    v_client_id := coalesce(v_item->>'id', '');
    v_id := case when v_client_id ~* v_uuid_pattern then v_client_id::uuid else gen_random_uuid() end;
    v_reference := nullif(v_item->>'forcedPaymentMethodId', '');
    v_reference_id := null;
    if v_reference is not null then
      if v_payment_map ? v_reference then
        v_reference_id := (v_payment_map->>v_reference)::uuid;
      elsif v_reference ~* v_uuid_pattern and v_reference::uuid = any(v_payment_ids) then
        v_reference_id := v_reference::uuid;
      else
        raise exception 'A Payment Type references an unavailable Payment Method';
      end if;
    end if;

    v_allowed_roles := array(
      select role_name
      from jsonb_array_elements_text(coalesce(v_item->'allowedRoles', '[]'::jsonb)) role_name
    );
    if exists (select 1 from unnest(v_allowed_roles) role_name where role_name not in ('admin', 'instructor', 'pilot', 'student')) then
      raise exception 'A Payment Type contains an unsupported role';
    end if;

    insert into public.flight_types(
      id, name, description, active, allowed_roles, display_order,
      forced_payment_method_id, ground_session_enabled, ground_session_hourly_rate,
      xero_item_code, xero_account_code, updated_at
    ) values (
      v_id,
      btrim(v_item->>'name'),
      nullif(btrim(v_item->>'description'), ''),
      coalesce((v_item->>'active')::boolean, true),
      v_allowed_roles,
      coalesce((v_item->>'displayOrder')::integer, array_length(v_flight_type_ids, 1) + 1, 1),
      v_reference_id,
      coalesce((v_item->>'groundSessionEnabled')::boolean, false),
      greatest(0, coalesce((v_item->>'groundSessionHourlyRate')::numeric, 0)),
      nullif(upper(btrim(v_item->>'xeroItemCode')), ''),
      nullif(upper(btrim(v_item->>'xeroAccountCode')), ''),
      now()
    )
    on conflict(id) do update set
      name = excluded.name,
      description = excluded.description,
      active = excluded.active,
      allowed_roles = excluded.allowed_roles,
      display_order = excluded.display_order,
      forced_payment_method_id = excluded.forced_payment_method_id,
      ground_session_enabled = excluded.ground_session_enabled,
      ground_session_hourly_rate = excluded.ground_session_hourly_rate,
      xero_item_code = excluded.xero_item_code,
      xero_account_code = excluded.xero_account_code,
      updated_at = excluded.updated_at;

    v_flight_type_ids := array_append(v_flight_type_ids, v_id);
    if v_client_id <> '' then
      v_flight_type_map := v_flight_type_map || jsonb_build_object(v_client_id, v_id::text);
    end if;
  end loop;

  update public.flight_types
  set active = false, updated_at = now()
  where not (id = any(v_flight_type_ids)) and active;

  for v_item in select value from jsonb_array_elements(p_ground_options)
  loop
    if nullif(btrim(v_item->>'name'), '') is null then
      raise exception 'Every Ground Session Type needs a name';
    end if;

    v_pricing_mode := case when v_item->>'pricingMode' = 'fixed' then 'fixed' else 'flight_type_hourly' end;
    if v_pricing_mode = 'fixed' and coalesce((v_item->>'fixedRate')::numeric, 0) < 0 then
      raise exception 'Ground Session fixed prices cannot be negative';
    end if;
    if v_pricing_mode = 'flight_type_hourly' and not exists (
      select 1
      from jsonb_array_elements(coalesce(v_item->'rates', '[]'::jsonb)) rate
      where coalesce((rate->>'enabled')::boolean, false)
        and coalesce((rate->>'hourlyRate')::numeric, 0) > 0
    ) then
      raise exception 'Each hourly Ground Session Type needs an enabled positive rate';
    end if;

    v_client_id := coalesce(v_item->>'id', '');
    v_id := case when v_client_id ~* v_uuid_pattern then v_client_id::uuid else gen_random_uuid() end;
    v_reference := nullif(v_item->>'flightTypeId', '');
    v_reference_id := null;
    if v_reference is not null then
      if v_flight_type_map ? v_reference then
        v_reference_id := (v_flight_type_map->>v_reference)::uuid;
      elsif v_reference ~* v_uuid_pattern and v_reference::uuid = any(v_flight_type_ids) then
        v_reference_id := v_reference::uuid;
      else
        raise exception 'A Ground Session Type references an unavailable Payment Type';
      end if;
    end if;

    insert into public.ground_session_description_options(
      id, name, description, active, display_order, pricing_mode,
      fixed_rate, flight_type_id, updated_at
    ) values (
      v_id,
      btrim(v_item->>'name'),
      nullif(btrim(v_item->>'description'), ''),
      coalesce((v_item->>'active')::boolean, true),
      coalesce((v_item->>'displayOrder')::integer, array_length(v_ground_option_ids, 1) + 1, 1),
      v_pricing_mode,
      case when v_pricing_mode = 'fixed' then coalesce((v_item->>'fixedRate')::numeric, 0) else 0 end,
      case when v_pricing_mode = 'flight_type_hourly' then v_reference_id else null end,
      now()
    )
    on conflict(id) do update set
      name = excluded.name,
      description = excluded.description,
      active = excluded.active,
      display_order = excluded.display_order,
      pricing_mode = excluded.pricing_mode,
      fixed_rate = excluded.fixed_rate,
      flight_type_id = excluded.flight_type_id,
      updated_at = excluded.updated_at;

    v_ground_option_ids := array_append(v_ground_option_ids, v_id);
    v_rate_type_ids := '{}';

    if v_pricing_mode = 'fixed' then
      update public.ground_session_rates
      set enabled = false, updated_at = now()
      where description_option_id = v_id and enabled;
    else
      for v_rate in select value from jsonb_array_elements(coalesce(v_item->'rates', '[]'::jsonb))
      loop
        v_reference := nullif(v_rate->>'flightTypeId', '');
        if v_reference is null then continue; end if;
        if v_flight_type_map ? v_reference then
          v_reference_id := (v_flight_type_map->>v_reference)::uuid;
        elsif v_reference ~* v_uuid_pattern and v_reference::uuid = any(v_flight_type_ids) then
          v_reference_id := v_reference::uuid;
        else
          raise exception 'A Ground Session rate references an unavailable Payment Type';
        end if;

        insert into public.ground_session_rates(
          description_option_id, flight_type_id, enabled, hourly_rate, updated_at
        ) values (
          v_id,
          v_reference_id,
          coalesce((v_rate->>'enabled')::boolean, false),
          greatest(0, coalesce((v_rate->>'hourlyRate')::numeric, 0)),
          now()
        )
        on conflict(description_option_id, flight_type_id) do update set
          enabled = excluded.enabled,
          hourly_rate = excluded.hourly_rate,
          updated_at = excluded.updated_at;

        v_rate_type_ids := array_append(v_rate_type_ids, v_reference_id);
      end loop;

      update public.ground_session_rates
      set enabled = false, updated_at = now()
      where description_option_id = v_id
        and not (flight_type_id = any(v_rate_type_ids))
        and enabled;
    end if;
  end loop;

  update public.ground_session_description_options
  set active = false, updated_at = now()
  where not (id = any(v_ground_option_ids)) and active;

  return jsonb_build_object(
    'paymentMethodIdMap', v_payment_map,
    'flightTypeIdMap', v_flight_type_map
  );
end;
$$;

revoke all on function public.save_billing_configuration(jsonb, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.save_billing_configuration(jsonb, jsonb, jsonb)
  to authenticated, service_role;

comment on function public.save_billing_configuration(jsonb, jsonb, jsonb) is
  'Validates and atomically saves payment methods, payment types, ground session types and their rate matrix.';

-- Provider-specific methods must become unavailable as soon as their provider
-- is disconnected. Reconnection remains an explicit admin choice.
create or replace function public.sync_provider_payment_method_availability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'stripe_connect_settings' then
    if tg_op = 'DELETE' then
      update public.payment_methods
      set active = false,
          allow_account_topup = false,
          updated_at = now()
      where system_key = 'stripe_card'
        and (active or allow_account_topup);
    elsif new.stripe_user_id is null or nullif(btrim(new.stripe_user_id), '') is null then
      update public.payment_methods
      set active = false,
          allow_account_topup = false,
          updated_at = now()
      where system_key = 'stripe_card'
        and (active or allow_account_topup);
    end if;
  elsif tg_table_name = 'xero_connection_settings' then
    if tg_op = 'DELETE' then
      update public.payment_methods
      set active = false,
          updated_at = now()
      where system_key = 'pilot_account'
        and active;
    elsif new.tenant_id is null
       or nullif(btrim(new.tenant_id), '') is null
       or new.disconnected_at is not null then
      update public.payment_methods
      set active = false,
          updated_at = now()
      where system_key = 'pilot_account'
        and active;
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists sync_stripe_payment_method_availability on public.stripe_connect_settings;
create trigger sync_stripe_payment_method_availability
after insert or update or delete on public.stripe_connect_settings
for each row execute function public.sync_provider_payment_method_availability();

drop trigger if exists sync_xero_payment_method_availability on public.xero_connection_settings;
create trigger sync_xero_payment_method_availability
after insert or update or delete on public.xero_connection_settings
for each row execute function public.sync_provider_payment_method_availability();

update public.payment_methods
set active = false,
    allow_account_topup = false,
    updated_at = now()
where system_key = 'stripe_card'
  and (active or allow_account_topup)
  and not exists (
    select 1 from public.stripe_connect_settings
    where id is true and nullif(btrim(stripe_user_id), '') is not null
  );

update public.payment_methods
set active = false,
    updated_at = now()
where system_key = 'pilot_account'
  and active
  and not exists (
    select 1 from public.xero_connection_settings
    where id is true
      and nullif(btrim(tenant_id), '') is not null
      and disconnected_at is null
  );

revoke all on function public.sync_provider_payment_method_availability()
  from public, anon, authenticated, service_role;

comment on function public.sync_provider_payment_method_availability() is
  'Fail-closes Stripe and Xero payment methods immediately when their provider disconnects.';

insert into private.function_permission_manifest(
  signature, function_name, classification, allowed_roles, security_definer,
  fixed_search_path, rationale, reviewed_at
) values (
  'public.save_billing_configuration(p_payment_methods jsonb, p_flight_types jsonb, p_ground_options jsonb)',
  'save_billing_configuration',
  'staff_aal2',
  array['authenticated', 'service_role']::text[],
  true,
  true,
  'Admin-only financial configuration transaction; current_user_is_admin enforces role and AAL2.',
  date '2026-08-05'
), (
  'public.sync_provider_payment_method_availability()',
  'sync_provider_payment_method_availability',
  'trigger_internal',
  array[]::text[],
  true,
  true,
  'Invoked only by provider-connection triggers; client EXECUTE is unnecessary.',
  date '2026-08-05'
)
on conflict(signature) do update set
  function_name = excluded.function_name,
  classification = excluded.classification,
  allowed_roles = excluded.allowed_roles,
  security_definer = excluded.security_definer,
  fixed_search_path = excluded.fixed_search_path,
  rationale = excluded.rationale,
  reviewed_at = excluded.reviewed_at;

select private.assert_function_permission_manifest();
