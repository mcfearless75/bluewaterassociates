-- Bluewater CRM: tickets schema
-- Every inbound contact (call, voicemail, missed call, form submission) becomes a ticket.

create extension if not exists "pgcrypto";

create table if not exists tickets (
  id            uuid primary key default gen_random_uuid(),
  source        text not null check (source in ('voicemail','missed_call','call','readiness','contact')),
  contact_name  text,
  contact_email text,
  contact_phone text,
  company       text,
  subject       text,
  body          text,
  payload       jsonb not null default '{}'::jsonb,
  status        text not null default 'new' check (status in ('new','in_progress','closed')),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists tickets_created_at_idx on tickets (created_at desc);
create index if not exists tickets_status_idx     on tickets (status);
create index if not exists tickets_source_idx     on tickets (source);

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists tickets_updated_at on tickets;
create trigger tickets_updated_at
  before update on tickets
  for each row execute function set_updated_at();

-- Row-level security: dashboard users (magic-link auth) can read + update.
-- The Worker writes using the service-role key, which bypasses RLS.
alter table tickets enable row level security;

drop policy if exists "admins read tickets"   on tickets;
drop policy if exists "admins update tickets" on tickets;

-- Email allowlist. Extend the IN list to add admins.
create policy "admins read tickets"
  on tickets for select
  to authenticated
  using (
    auth.jwt() ->> 'email' in (
      'paul@bluewaterassociates.co.uk',
      'paulmc18@gmail.com'
    )
  );

create policy "admins update tickets"
  on tickets for update
  to authenticated
  using (
    auth.jwt() ->> 'email' in (
      'paul@bluewaterassociates.co.uk',
      'paulmc18@gmail.com'
    )
  )
  with check (
    auth.jwt() ->> 'email' in (
      'paul@bluewaterassociates.co.uk',
      'paulmc18@gmail.com'
    )
  );
