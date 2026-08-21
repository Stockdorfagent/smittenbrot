-- 020: an order number only exists once there is a payment.
--
-- Two triggers were numbering orders:
--   * trg_set_order_number -> gen_order_number()   (legacy, from the pre-007 era)
--     stamped a plain 5-digit number from invoice_number_seq on INSERT, with no
--     awareness of test-invoice-mode.
--   * trg_assign_order_numbers -> assign_order_numbers()  (migration 007/008)
--     assigns order_number + invoice_number together when payment_status
--     becomes 'paid', prefixing TEST- while invoice_mode = 'test'.
--
-- So every order got a plain number at insert, and only paid ones had it
-- replaced. Unpaid orders therefore walked around wearing numbers like 00247
-- that are indistinguishable from real Squarespace invoice numbers — which is
-- what made 00212 / 00224 / 00235 so confusing.
--
-- Worse for launch: once test-invoice-mode is off, BOTH sequences hand out
-- plain 5-digit numbers, so an unpaid order could take a number that a later
-- paid order takes too — duplicate order numbers on real invoices.
--
-- Owner's rule (2026-08-21): "only a number once there is a payment. No
-- payment, no order, no order number." Which is also how the order-on-success
-- model already works everywhere else.
--
-- The clients already handle a missing number: the app shows the order date
-- instead, and the admin list shows "Wird bei Produktion zugewiesen".

drop trigger if exists trg_set_order_number on public.orders;
drop function if exists public.gen_order_number();

-- Clear the provisional numbers off orders that were never charged, so they get
-- a proper one (TEST-# now, RE-/#- after launch) at payment. Anything with an
-- invoice_number is left strictly alone: that is issued paperwork.
update public.orders
   set order_number = null
 where payment_status <> 'paid'
   and invoice_number is null
   and order_number is not null;

-- Note: invoice_number_seq is now unused (only the dropped function and the
-- long-replaced migration-002 assigner referenced it). Left in place rather
-- than dropped, since dropping a sequence is irreversible and it costs nothing.
