-- 024: record cancellations declared through the public Kündigungsbutton.
--
-- § 312k BGB requires a permanently reachable "Verträge hier kündigen" button
-- for contracts concluded online that are directed at a continuing obligation.
-- Whether the Smittenbrot Abo is one is arguable — every week is placed, paid
-- and confirmed as an individual order, and the customer is told in advance
-- each time — but the button costs little and settles the question either way.
--
-- The declaration must be storable by the consumer WITH date and time
-- (§ 312k Abs. 3) and confirmed by the trader immediately in text form,
-- including the time of receipt (§ 312k Abs. 4). Both need a record that
-- survives the request, hence this table rather than a fire-and-forget email.
--
-- Deliberately NOT behind a login: the whole point of the provision is that
-- cancelling must not be harder than signing up. That means the form is
-- unauthenticated, so it stores what was declared and never trusts it as
-- identity — the confirmation always goes to the address registered on the
-- account, never only to whatever address the form was filled in with.

create table if not exists public.cancellation_requests (
  id uuid primary key default gen_random_uuid(),

  -- exactly as declared, for the record
  declared_name text not null,
  declared_email text not null,
  contract_label text not null,
  cancellation_kind text not null check (cancellation_kind in ('ordentlich', 'ausserordentlich')),
  cancellation_reason text,
  effective_choice text not null check (effective_choice in ('naechstmoeglich', 'datum')),
  effective_date date,
  message text,

  -- what we could match it to; null when nothing matched
  customer_id uuid references public.customers(id) on delete set null,
  subscription_ids uuid[] not null default '{}',

  -- § 312k Abs. 4: the moment of receipt is part of the confirmation
  received_at timestamptz not null default now(),
  confirmation_sent_at timestamptz,
  confirmation_error text,

  created_at timestamptz not null default now()
);

comment on table public.cancellation_requests is
  'Declarations made through the public /kuendigung page (§ 312k BGB). Unauthenticated by design; declared_* fields are what the form said, customer_id/subscription_ids are what we could match.';

create index if not exists idx_cancellation_requests_email
  on public.cancellation_requests (lower(declared_email));
create index if not exists idx_cancellation_requests_received
  on public.cancellation_requests (received_at desc);

alter table public.cancellation_requests enable row level security;

-- Written only by the service role (the API route). Readable by the admin.
-- No customer-facing policy: a consumer's own copy is the confirmation email
-- and the printable page, not a query against this table.
drop policy if exists cancellation_requests_admin_all on public.cancellation_requests;
create policy cancellation_requests_admin_all on public.cancellation_requests
  for all
  using (
    exists (
      select 1 from public.customers c
      where c.id = auth.uid() and c.is_admin = true
    )
  );
