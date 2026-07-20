-- Lock down discount RLS.
-- Previously anyone (anon) could read every active discount code (enumeration)
-- and insert arbitrary discount_usage rows. All legitimate access is server-side
-- (validate-discount / create-payment-intent / stripe-webhook use the service
-- role and bypass RLS) or admin (the admin_all policies). So we drop the two
-- permissive public policies.

DROP POLICY IF EXISTS "read_active_discounts" ON public.discounts;
DROP POLICY IF EXISTS "insert_usage" ON public.discount_usage;

-- Ensure the admin flag is set via migration (not by hand) so the admin_all
-- policies + the client admin pages keep working. Idempotent.
UPDATE public.customers SET is_admin = true WHERE email = 'sophia@smittenbrot.de';
