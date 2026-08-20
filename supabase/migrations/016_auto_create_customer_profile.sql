-- 016: create the customers profile row automatically for every new auth user.
--
-- Why: the clients used to insert the profile row themselves right after
-- signUp(). With email confirmation enabled, signUp() returns NO session, so
-- that insert ran unauthenticated and RLS refused it (policy customers_self
-- requires id = auth.uid()). The account existed with no profile row, and
-- because orders.customer_id references customers(id), the stripe-webhook's
-- order insert then failed on the foreign key — the card was charged and no
-- order was created. Passwordless (6-digit code) sign-up has no client-side
-- insert at all, so the row must come from the database.
--
-- name is NOT NULL; an empty string means "not supplied yet" and the app asks
-- for it once, right after the first login.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.customers (id, email, name, phone)
  values (
    new.id,
    new.email,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      ''
    ),
    nullif(trim(new.raw_user_meta_data ->> 'phone'), '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- Backfill: any existing auth user without a profile row (accounts created
-- while the broken client-side insert was in place).
insert into public.customers (id, email, name)
select u.id, u.email, coalesce(nullif(trim(u.raw_user_meta_data ->> 'name'), ''), '')
from auth.users u
left join public.customers c on c.id = u.id
where c.id is null
  and u.email is not null
on conflict (id) do nothing;
