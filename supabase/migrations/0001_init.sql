-- MediHeal HIS — Supabase schema (migration 0001)
--
-- Design contract, in the order it matters:
--
--  1. Every row belongs to exactly one browser identity: `owner_id = auth.uid()`. There is no
--     shared tenant and no cross-visitor read. A visitor who is not signed in (not even
--     anonymously) sees nothing.
--  2. The application is a static site with a client-side demo login. It must never hold a
--     service_role key, so every rule below is enforced by RLS against the anon key: the database,
--     not the browser, decides what a session may read or write.
--  3. The app's existing modules own their records and are not rewritten by this migration. Each
--     table therefore carries the queryable columns a report needs (id, status, amount, dates)
--     plus a `data jsonb` copy of the whole record. The JSON is the source of truth for the module;
--     the columns exist so a query, an index or a dashboard does not have to parse JSON.
--  4. `audit_log` is append-only. A trigger refuses UPDATE and DELETE, and no RLS policy grants
--     them, so a signed-in session cannot rewrite history.
--
-- Run this file once in the Supabase SQL editor (or `supabase db push`) on a fresh project.

-- ---------------------------------------------------------------------------------------------
-- 0. Helpers
-- ---------------------------------------------------------------------------------------------
create extension if not exists pgcrypto;

-- Every table uses the same three-line owner guard, so the policy text is generated from one place.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 1. Clinical and operational records
-- ---------------------------------------------------------------------------------------------
-- Patients: `id` is the MRN the app already mints (PT-99xxx / PT-1000xx).
create table if not exists public.patients (
  owner_id   uuid not null default auth.uid(),
  id         text not null,
  name       text,
  last_name  text,
  dob        date,
  mobile     text,
  type       text,
  dept       text,
  status     text,
  attention  boolean not null default false,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

-- Registration-form rows. The app keeps these in their own list (`mh_regs_extra`), separate from
-- the seeded registry, so they get their own table rather than being merged into `patients`
-- behind the app's back.
create table if not exists public.registrations (
  owner_id   uuid not null default auth.uid(),
  id         text not null,
  name       text,
  dob        text,
  mobile     text,
  type       text,
  status     text,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

create table if not exists public.appointments (
  owner_id   uuid not null default auth.uid(),
  id         text not null,
  patient_id text,
  doctor     text,
  dept       text,
  slot_at    timestamptz,
  status     text,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

create table if not exists public.encounters (
  owner_id   uuid not null default auth.uid(),
  id         text not null,
  patient_id text,
  kind       text,
  status     text,
  opened_at  timestamptz,
  closed_at  timestamptz,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

-- Charges: the unbilled → invoiced path. amount is numeric so a sum is exact, never a float.
create table if not exists public.charges (
  owner_id     uuid not null default auth.uid(),
  id           text not null,
  encounter_id text,
  patient_id   text,
  invoice_id   text,
  code         text,
  description  text,
  amount       numeric(12,2),
  status       text,
  posted_at    timestamptz,
  data         jsonb not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (owner_id, id)
);

create table if not exists public.invoices (
  owner_id   uuid not null default auth.uid(),
  id         text not null,
  patient_id text,
  status     text,
  amount     numeric(12,2),
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

-- Money movement. Never a stored balance: a balance is always the sum of these rows, which is the
-- rule the app already enforces in HIS.ledger.
create table if not exists public.ledger_transactions (
  owner_id        uuid not null default auth.uid(),
  id              text not null,
  invoice_id      text,
  patient_id      text,
  kind            text,
  method          text,
  reference       text,
  amount          numeric(12,2),
  status          text,
  posted_at       timestamptz,
  idempotency_key text,
  data            jsonb not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (owner_id, id)
);

create table if not exists public.claims (
  owner_id     uuid not null default auth.uid(),
  id           text not null,
  invoice_id   text,
  payer        text,
  status       text,
  requested    numeric(12,2),
  approved     numeric(12,2),
  paid         numeric(12,2),
  data         jsonb not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (owner_id, id)
);

create table if not exists public.admissions (
  owner_id   uuid not null default auth.uid(),
  id         text not null,
  patient_id text,
  ward       text,
  bed        text,
  status     text,
  admitted_at timestamptz,
  discharged_at timestamptz,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

create table if not exists public.lab_orders (
  owner_id   uuid not null default auth.uid(),
  id         text not null,
  patient_id text,
  panel      text,
  status     text,
  released_at timestamptz,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

create table if not exists public.prescriptions (
  owner_id   uuid not null default auth.uid(),
  id         text not null,
  patient_id text,
  status     text,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

create table if not exists public.stock_batches (
  owner_id   uuid not null default auth.uid(),
  id         text not null,
  drug       text,
  batch      text,
  expires_on date,
  qty        integer,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

create table if not exists public.personnel (
  owner_id   uuid not null default auth.uid(),
  id         text not null,
  name       text,
  role       text,
  dept       text,
  status     text,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

create table if not exists public.guardians (
  owner_id   uuid not null default auth.uid(),
  id         text not null,
  patient_id text,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

-- ---------------------------------------------------------------------------------------------
-- 2. Everything that is a document rather than a row
-- ---------------------------------------------------------------------------------------------
-- Payroll runs, attendance registers, treatment/nursing/consultation state, tariffs, notification
-- flags: the owning module treats each of these as one JSON document with its own invariants.
-- Keeping them as documents is what stops this migration from forking a module's logic.
create table if not exists public.module_state (
  owner_id   uuid not null default auth.uid(),
  key        text not null,
  payload    jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id, key)
);

-- ---------------------------------------------------------------------------------------------
-- 3. Audit trail (append-only)
-- ---------------------------------------------------------------------------------------------
create table if not exists public.audit_log (
  owner_id  uuid not null default auth.uid(),
  id        bigserial primary key,
  row_ref   text,
  at        timestamptz not null default now(),
  actor     text,
  role      text,
  action    text,
  entity    text,
  before    text,
  after     text,
  data      jsonb
);

create or replace function public.audit_log_is_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only: % is refused', tg_op;
end;
$$;

drop trigger if exists audit_log_no_update on public.audit_log;
create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function public.audit_log_is_append_only();

-- ---------------------------------------------------------------------------------------------
-- 4. Indexes the pages actually query on
-- ---------------------------------------------------------------------------------------------
create index if not exists patients_owner_status_idx   on public.patients (owner_id, status);
create index if not exists patients_owner_name_idx     on public.patients (owner_id, name);
create index if not exists regs_owner_name_idx         on public.registrations (owner_id, name);
create index if not exists appts_owner_slot_idx        on public.appointments (owner_id, slot_at);
create index if not exists appts_owner_status_idx      on public.appointments (owner_id, status);
create index if not exists charges_owner_invoice_idx   on public.charges (owner_id, invoice_id);
create index if not exists charges_owner_status_idx    on public.charges (owner_id, status);
create index if not exists invoices_owner_patient_idx  on public.invoices (owner_id, patient_id);
create index if not exists invoices_owner_status_idx   on public.invoices (owner_id, status);
create index if not exists ledger_owner_invoice_idx    on public.ledger_transactions (owner_id, invoice_id);
-- A retried payment must not post twice: the app sends an idempotency key, and the database
-- refuses a second row with the same key for the same owner.
create unique index if not exists ledger_owner_idem_idx on public.ledger_transactions (owner_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists claims_owner_invoice_idx    on public.claims (owner_id, invoice_id);
create index if not exists claims_owner_status_idx     on public.claims (owner_id, status);
create index if not exists admissions_owner_bed_idx    on public.admissions (owner_id, ward, bed);
create index if not exists lab_owner_status_idx        on public.lab_orders (owner_id, status);
create index if not exists audit_owner_at_idx          on public.audit_log (owner_id, at desc);

-- ---------------------------------------------------------------------------------------------
-- 5. updated_at triggers
-- ---------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['patients','registrations','appointments','encounters','charges','invoices',
                           'ledger_transactions','claims','admissions','lab_orders','prescriptions',
                           'stock_batches','personnel','guardians']
  loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 6. Row level security
-- ---------------------------------------------------------------------------------------------
-- Enabled and forced on every table. The only policy is "your own rows", expressed against
-- auth.uid(). Anonymous sign-in gives the visitor a real JWT, so `auth.uid()` is never null for a
-- page that bootstrapped successfully; a request with no identity matches nothing.
do $$
declare t text;
begin
  foreach t in array array['patients','registrations','appointments','encounters','charges','invoices',
                           'ledger_transactions','claims','admissions','lab_orders','prescriptions',
                           'stock_batches','personnel','guardians','module_state','audit_log']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);

    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format('create policy %I_select on public.%I for select to authenticated using (owner_id = (select auth.uid()))', t, t);

    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (owner_id = (select auth.uid()))', t, t);

    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format('create policy %I_update on public.%I for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', t, t);
  end loop;
end;
$$;

-- The audit trail may be inserted and read, never changed or deleted (the trigger above enforces
-- the same rule even for a privileged role).
drop policy if exists audit_log_delete on public.audit_log;
drop policy if exists audit_log_update on public.audit_log;

-- Dashboard books: owner-scoped delete on the ordinary tables would let a session wipe its own
-- demo data, which the app already offers as "Reset sample data", so delete is granted on the
-- record tables only — not on module_state (the app overwrites it) and never on audit_log.
do $$
declare t text;
begin
  foreach t in array array['patients','registrations','appointments','encounters','charges','invoices',
                           'ledger_transactions','claims','admissions','lab_orders','prescriptions',
                           'stock_batches','personnel','guardians']
  loop
    execute format('drop policy if exists %I_delete on public.%I', t, t);
    execute format('create policy %I_delete on public.%I for delete to authenticated using (owner_id = (select auth.uid()))', t, t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 7. Cabinets that the site needs switched on in the dashboard
-- ---------------------------------------------------------------------------------------------
-- Anonymous sign-in must be enabled (Authentication → Providers → Anonymous) or the client cannot
-- obtain the JWT these policies depend on. No keys are stored in this file.
comment on table public.module_state is
  'Per-owner JSON documents for modules that own a whole store (payroll runs, attendance register, tariffs, notification flags). Mirrors HIS.store keys 1:1.';
comment on table public.audit_log is
  'Append-only audit trail. UPDATE and DELETE are refused by trigger; only INSERT and SELECT are granted.';
