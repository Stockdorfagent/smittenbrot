#!/usr/bin/env python3
"""Generate SQL migration from Squarespace CSVs. Pipe into supabase db query."""

import csv, os, sys
from collections import OrderedDict
from datetime import datetime

EXPORT_DIR = "/Users/stockdorfagent/Documents/Smittenbrot App Project/sqsp-orders-customers-20260612"
CUSTOMERS_FILE = os.path.join(EXPORT_DIR, "customers-smittenbrot.csv")
ORDERS_FILE = os.path.join(EXPORT_DIR, "orders-smittenbrot.csv")

PRODUCT_MAP = {
    "Stockdorf Sourdough": "'b1000000-0000-0000-0000-000000000001'",
    "Weizen-Roggenmischbrot": "'b1000000-0000-0000-0000-000000000002'",
    "Brioche": "'b1000000-0000-0000-0000-000000000003'",
    "La Brioche": "'b1000000-0000-0000-0000-000000000003'",
    "Focaccia": "'b1000000-0000-0000-0000-000000000004'",
    "Focaccia Naturale": "'b1000000-0000-0000-0000-000000000004'",
    "La Baguette": "'b1000000-0000-0000-0000-000000000005'",
    "Baguette": "'b1000000-0000-0000-0000-000000000005'",
    "Ciabatta": "'b1000000-0000-0000-0000-000000000006'",
    "Ciabatta Naturale": "'b1000000-0000-0000-0000-000000000006'",
}

customers = list(csv.DictReader(open(CUSTOMERS_FILE, encoding='utf-8-sig')))
orders_raw = list(csv.DictReader(open(ORDERS_FILE, encoding='utf-8-sig')))

# Group orders
grouped = OrderedDict()
for row in orders_raw:
    oid = row.get("Order ID", "").strip()
    if not oid: continue
    if oid not in grouped:
        status = "'cancelled'" if row.get("Cancelled at","").strip() else "'fulfilled'"
        payment = "'paid'"
        subtotal = float(row.get("Subtotal","0").replace(",",""))
        taxes = float(row.get("Taxes","0").replace(",",""))
        total_cents = int(round((subtotal + taxes) * 100))
        fd = "NULL"
        if row.get("Created at"):
            try:
                dt = datetime.strptime(row["Created at"].strip(), "%Y-%m-%d %H:%M:%S %z")
                fd = f"'{dt.strftime('%Y-%m-%d')}'"
            except: pass
        grouped[oid] = {"id": oid, "email": row.get("Email","").strip(), "status": status, "payment": payment,
                        "total": total_cents, "fd": fd, "items": [],
                        "name": row.get("Billing Name","").strip().replace("'","''")}
    if row.get("Lineitem quantity"):
        qty = int(row["Lineitem quantity"])
        name = row.get("Lineitem name","").strip()
        price = float(row.get("Lineitem price","0").replace(",",""))
        pid = PRODUCT_MAP.get(name)
        if pid and qty > 0:
            g = int(round(price * 100))
            n = round(g / 1.07)
            v = g - n
            grouped[oid]["items"].append(f"({pid}, {qty}, {g}, {n}, {v}, {g * qty})")

max_inv = max((int(o.lstrip("0")) for o in grouped if o.lstrip("0").isdigit()), default=0)

# Generate SQL
lines = []
lines.append("-- Migration: Squarespace import")
lines.append(f"-- Generated: {datetime.now().isoformat()}")
lines.append(f"-- Customers: {len(customers)}, Orders: {len(grouped)}, Invoice next: {max_inv + 1:05d}")
lines.append("")
lines.append("BEGIN;")
lines.append("")

# Set invoice sequence
lines.append(f"ALTER SEQUENCE invoice_number_seq RESTART WITH {max_inv + 1};")
lines.append("")

# Customers who already exist in auth (we need to find them)
already_existing = {"info@smittenbrot.de", "sophia@smittenbrot.de"}

for c in customers:
    email = c.get("Email","").strip().lower()
    if not email: continue
    first = c.get("First Name","").strip().replace("'","''")
    last = c.get("Last Name","").strip().replace("'","''")
    name = f"{first} {last}".strip()
    if not name: name = email.split('@')[0]
    
    if email in already_existing:
        # Update existing customer record
        lines.append(f"UPDATE public.customers SET name = '{name}' WHERE email = '{email}';")
    else:
        lines.append(f"""
-- Customer: {email}
DO $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Create auth user (no password, email confirmed)
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, confirmation_sent_at, confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, last_sign_in_at)
  VALUES ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', '{email}', '', now(), now(), now(), '{{"provider":"email","providers":["email"]}}'::jsonb, '{{"full_name":"{name}"}}'::jsonb, now(), now(), now())
  RETURNING id INTO v_user_id;

  -- Create customer record
  INSERT INTO public.customers (id, email, name) VALUES (v_user_id, '{email}', '{name}');
END $$;
""")

lines.append("")
lines.append("-- Import orders")
lines.append("")

for oid, o in grouped.items():
    if not o["items"]: continue
    items_sql = ", ".join(o["items"])
    strip_quotes = "'"
    inv = f"RE-{o['fd'].strip(strip_quotes)}-{oid.zfill(5)}" if o['fd'] != "NULL" else f"RE-20260101-{oid.zfill(5)}"
    
    lines.append(f"""
-- Order #{oid} ({o['name']}, €{o['total']/100:.2f})
WITH ord AS (
  INSERT INTO public.orders (customer_id, order_type, status, payment_status, total_cents, fulfillment_date, invoice_number, customer_name, customer_email)
  SELECT c.id, 'one_time', {o['status']}, {o['payment']}, {o['total']}, {o['fd']}, '{inv}', '{o['name']}', '{o['email']}'
  FROM public.customers c WHERE c.email = '{o['email']}'
  RETURNING id
)
INSERT INTO public.order_items (order_id, product_id, quantity, unit_price_cents, unit_price_gross_cents, unit_price_net_cents, vat_cents, total_price_cents)
SELECT ord.id, * FROM (VALUES {items_sql}) AS t(product_id, quantity, unit_price_cents, unit_price_net_cents, vat_cents, total_price_cents), ord;
""")

lines.append("COMMIT;")

sql = "\n".join(lines)
print(sql)

if "--stats" in sys.argv:
    print(f"\n-- Stats: {len(customers)} customers, {len(grouped)} orders, max invoice {max_inv:05d}", file=sys.stderr)
