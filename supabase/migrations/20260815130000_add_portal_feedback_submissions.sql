-- Temporary portal preview feedback: server-only audit and email delivery state.
create table if not exists public.portal_feedback_submissions (
  id uuid primary key,
  submitted_by uuid not null references public.users(id) on delete restrict,
  category text not null check (category in ('bug', 'improvement', 'other')),
  comment text not null check (char_length(btrim(comment)) between 5 and 4000),
  page_url text not null check (char_length(page_url) between 1 and 2000),
  route text not null default '',
  screenshot_bytes integer not null check (screenshot_bytes between 256 and 4194304),
  screenshot_width integer not null check (screenshot_width between 1 and 12000),
  screenshot_height integer not null check (screenshot_height between 1 and 12000),
  screenshot_mime_type text not null check (screenshot_mime_type in ('image/jpeg', 'image/png')),
  display_surface text not null default 'unknown',
  viewport_width integer,
  viewport_height integer,
  user_agent text not null default '',
  client_submitted_at timestamptz,
  email_status text not null default 'pending' check (email_status in ('pending', 'sent', 'failed')),
  email_error text,
  email_provider_message_id text,
  emailed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists portal_feedback_submissions_submitter_created_idx
  on public.portal_feedback_submissions (submitted_by, created_at desc);

alter table public.portal_feedback_submissions enable row level security;
alter table public.portal_feedback_submissions force row level security;

revoke all on table public.portal_feedback_submissions from public, anon, authenticated;
grant all on table public.portal_feedback_submissions to service_role;

comment on table public.portal_feedback_submissions is
  'Server-only audit trail for authenticated staff portal feedback and email delivery. Screenshot content is attached to email and is not retained in the database.';

select private.assert_function_permission_manifest();
