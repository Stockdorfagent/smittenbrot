-- 045: P0 lockdown after the code review of 02.11.2026 (CODE-REVIEW-2026-11-02.md, findings 1–3).
--
-- Before: customers_self / orders_self / order_items_self / subscriptions_self /
-- subscription_items_self were all FOR ALL with "customer_id = auth.uid()", so a
-- logged-in customer could (1) set is_admin = true on their own row, (2) insert or
-- edit their own orders incl. payment_status = 'paid' (which issues a real RE- number),
-- (3) change anything on their Abo.
--
-- After:
--   customers          : select / insert / update own row, but is_admin,
--                        stripe_customer_id and stripe_payment_method_id may only be
--                        changed by the service role (trigger), and a client may set
--                        email only to the e-mail of its own JWT (create-setup-intent
--                        used to look customers up BY E-MAIL, so a forged e-mail could
--                        have attached another customer's Stripe customer). No client
--                        delete (account deletion goes through the delete-account function).
--   orders, order_items: read-only for customers. All writes come from the edge
--                        functions / admin routes (service role).
--   subscriptions      : select + insert own Abo (the wizards), update own Abo but
--                        only status -> 'cancellation_pending' (trigger); everything
--                        else goes through subscription-engine. No client delete.
--   subscription_items : select + insert for own Abo (the wizards); no update/delete
--                        from clients (engine update-subscription does that).
--
-- Admin policies (is_admin()) are untouched. The service role bypasses RLS and is
-- exempt from the triggers.

-- ── helper: is this request coming from a client JWT (anon / authenticated)? ──
create or replace function public.request_is_client()
returns boolean
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) in ('anon', 'authenticated');
$$;
grant execute on function public.request_is_client() to anon, authenticated, service_role;

-- ── customers: privileged columns ────────────────────────────────────────────
create or replace function public.customers_guard_privileged()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  jwt_email text;
begin
  if not public.request_is_client() then
    return new;
  end if;
  jwt_email := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email';
  if tg_op = 'INSERT' then
    if new.is_admin then
      raise exception 'is_admin cannot be set by clients' using errcode = '42501';
    end if;
    if new.stripe_customer_id is not null or new.stripe_payment_method_id is not null then
      raise exception 'stripe ids cannot be set by clients' using errcode = '42501';
    end if;
    if new.email is not null and jwt_email is not null and lower(new.email) <> lower(jwt_email) then
      raise exception 'email must match the signed-in account' using errcode = '42501';
    end if;
  else
    if new.is_admin is distinct from old.is_admin then
      raise exception 'is_admin cannot be changed by clients' using errcode = '42501';
    end if;
    if new.stripe_customer_id is distinct from old.stripe_customer_id
       or new.stripe_payment_method_id is distinct from old.stripe_payment_method_id then
      raise exception 'stripe ids cannot be changed by clients' using errcode = '42501';
    end if;
    if new.email is distinct from old.email
       and (jwt_email is null or lower(coalesce(new.email, '')) <> lower(jwt_email)) then
      raise exception 'email must match the signed-in account' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
grant execute on function public.customers_guard_privileged() to anon, authenticated, service_role;

drop trigger if exists trg_customers_guard_privileged on public.customers;
create trigger trg_customers_guard_privileged
  before insert or update on public.customers
  for each row execute function public.customers_guard_privileged();

drop policy if exists customers_self on public.customers;
create policy customers_self_select on public.customers
  for select to authenticated using (id = auth.uid());
create policy customers_self_insert on public.customers
  for insert to authenticated with check (id = auth.uid());
create policy customers_self_update on public.customers
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ── orders / order_items: read-only for customers ────────────────────────────
drop policy if exists orders_self on public.orders;
create policy orders_self_select on public.orders
  for select to authenticated using (customer_id = auth.uid());

drop policy if exists order_items_self on public.order_items;
create policy order_items_self_select on public.order_items
  for select to authenticated
  using (order_id in (select id from public.orders where customer_id = auth.uid()));

-- ── subscriptions: own Abo, client update limited to the cancel flag ─────────
create or replace function public.subscriptions_guard_client_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.request_is_client() then
    return new;
  end if;
  if (to_jsonb(new) - 'status' - 'updated_at') is distinct from (to_jsonb(old) - 'status' - 'updated_at') then
    raise exception 'Abo changes are made through the subscription engine' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and new.status <> 'cancellation_pending' then
    raise exception 'clients may only request the cancellation of an Abo' using errcode = '42501';
  end if;
  return new;
end;
$$;
grant execute on function public.subscriptions_guard_client_update() to anon, authenticated, service_role;

drop trigger if exists trg_subscriptions_guard_client_update on public.subscriptions;
create trigger trg_subscriptions_guard_client_update
  before update on public.subscriptions
  for each row execute function public.subscriptions_guard_client_update();

drop policy if exists subscriptions_self on public.subscriptions;
create policy subscriptions_self_select on public.subscriptions
  for select to authenticated using (customer_id = auth.uid());
create policy subscriptions_self_insert on public.subscriptions
  for insert to authenticated with check (customer_id = auth.uid());
create policy subscriptions_self_update on public.subscriptions
  for update to authenticated using (customer_id = auth.uid()) with check (customer_id = auth.uid());

-- ── subscription_items: select + insert for own Abo ──────────────────────────
drop policy if exists subscription_items_self on public.subscription_items;
create policy subscription_items_self_select on public.subscription_items
  for select to authenticated
  using (subscription_id in (select id from public.subscriptions where customer_id = auth.uid()));
create policy subscription_items_self_insert on public.subscription_items
  for insert to authenticated
  with check (subscription_id in (select id from public.subscriptions where customer_id = auth.uid()));
