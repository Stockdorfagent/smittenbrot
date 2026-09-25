-- 033: discount_status(code) — lets a client decide whether to SHOW a welcome-code hint (owner, 25.09.2026):
-- the strip disappears for a customer who has already used the code, and for everyone once the code is
-- inactive or expired. Reads discounts/discount_usage (both RLS-locked to admins) on the caller's behalf and
-- returns only booleans — no other customer's data. Anonymous callers get used_by_me = false.
create or replace function public.discount_status(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'exists', d.id is not null,
    'active', coalesce(d.active, false),
    'expired', coalesce(d.expires_at < now(), false),
    'exhausted', coalesce(d.max_uses is not null and (select count(*) from public.discount_usage u where u.discount_id = d.id) >= d.max_uses, false),
    'used_by_me', coalesce(
      auth.uid() is not null and exists (
        select 1 from public.discount_usage u
        where u.discount_id = d.id
          and (u.customer_id = auth.uid() or (auth.email() is not null and u.email = auth.email()))
      ), false)
  )
  from (select 1) x
  left join public.discounts d on lower(d.code) = lower(p_code);
$$;
revoke all on function public.discount_status(text) from public;
grant execute on function public.discount_status(text) to anon, authenticated;
