#!/usr/bin/env python3
"""Fix missing order items from Squarespace migration."""

import csv
import os
import ssl
import json
import urllib.request
import urllib.parse
from collections import OrderedDict, defaultdict

EXPORT_DIR = "/Users/stockdorfagent/Documents/Smittenbrot App Project/sqsp-orders-customers-20260612"
ORDERS_FILE = os.path.join(EXPORT_DIR, "orders-smittenbrot.csv")

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://aoryokgzmpezanmlgxtl.supabase.co")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
SQL_FILE = "/tmp/fix-orders.sql"

# Complete product mapping: Squarespace name → product UUID
PRODUCT_MAP = {
    "Stockdorf Sourdough":        "b1000000-0000-0000-0000-000000000001",
    "Wheat & Rye Sourdough":      "b1000000-0000-0000-0000-000000000002",
    "Wheat & Rye Sourdough - Roggenmischbrot": "b1000000-0000-0000-0000-000000000002",
    "Rye/Wheat Sourdough":        "b1000000-0000-0000-0000-000000000002",
    "Weizen-Roggenmischbrot":     "b1000000-0000-0000-0000-000000000002",
    "Brioche":                    "b1000000-0000-0000-0000-000000000003",
    "La Brioche":                 "b1000000-0000-0000-0000-000000000003",
    "Focaccia":                   "b1000000-0000-0000-0000-000000000004",
    "Focaccia Naturale":          "b1000000-0000-0000-0000-000000000004",
    "Ciabatta":                   "60cfeed6-4693-4c08-967e-8b06eff4255e",
    "Ciabatta Naturale":          "60cfeed6-4693-4c08-967e-8b06eff4255e",
    "Ciabatta - mit oder ohne Oliven": "60cfeed6-4693-4c08-967e-8b06eff4255e",
    "La Baguette":                "b1000000-0000-0000-0000-000000000010",
    "Baguette":                   "b1000000-0000-0000-0000-000000000010",
    "Sauerteig Baguette - 350gr": "b1000000-0000-0000-0000-000000000010",
    "Spelt Sourdough":            "b1000000-0000-0000-0000-000000000009",
    "Seeded Sourdough - Sauerteigbrot mit Saaten": "b1000000-0000-0000-0000-000000000008",
    "Vollkorn Sourdough":         "b1000000-0000-0000-0000-000000000008",
    # Offline / not in active sortiment — dummy entries created
    "Kokosmakronen": "b1000000-0000-0000-0000-000000000100",
    "Mandelgebäck": "b1000000-0000-0000-0000-000000000101",
    "Osterhase": "b1000000-0000-0000-0000-000000000102",
    "Vollkorn Apple Crumble": "b1000000-0000-0000-0000-000000000103",
    "Weizenkleinbrot - 80gr": "b1000000-0000-0000-0000-000000000104",
    "Saaten Mehrkornbrot - 750gr": "b1000000-0000-0000-0000-000000000105",
}

orders = list(csv.DictReader(open(ORDERS_FILE, encoding='utf-8-sig')))

# Group order lines
grouped = OrderedDict()
for row in orders:
    oid = row.get("Order ID", "").strip()
    if not oid:
        continue
    if oid not in grouped:
        subtotal = float(row.get("Subtotal", "0").replace(",", ""))
        taxes = float(row.get("Taxes", "0").replace(",", ""))
        total_cents = int(round((subtotal + taxes) * 100))
        grouped[oid] = {"items": [], "total": total_cents, "email": row.get("Email", "").strip()}
    
    qty_raw = row.get("Lineitem quantity", "0")
    if not qty_raw:
        continue
    qty = int(qty_raw)
    name = row.get("Lineitem name", "").strip()
    price = float(row.get("Lineitem price", "0").replace(",", ""))
    pid = PRODUCT_MAP.get(name)
    if pid and qty > 0:
        g = int(round(price * 100))
        n = round(g / 1.07)
        v = g - n
        grouped[oid]["items"].append(f"('{pid}'::uuid, {qty}, {g}, {g}, {n}, {v})")

# Generate SQL
lines = ["BEGIN;"]
items_fixed = 0
orders_fixed = 0

for oid, o in grouped.items():
    if not o["items"]:
        continue
    
    # Find the order in the database
    inv_num = f"RE-%-{oid.zfill(5)}"
    items_sql = ", ".join(o["items"])
    total = o["total"]
    
    lines.append(f"""
-- Order #{oid}
UPDATE public.orders SET total_cents = {total} WHERE invoice_number LIKE '{inv_num}';
DELETE FROM public.order_items WHERE order_id IN (SELECT id FROM public.orders WHERE invoice_number LIKE '{inv_num}');
INSERT INTO public.order_items (order_id, product_id, quantity, unit_price_cents, unit_price_gross_cents, unit_price_net_cents, vat_cents)
SELECT o.id, t.*
FROM (VALUES {items_sql}) AS t(product_id, quantity, unit_price_cents, unit_price_gross_cents, unit_price_net_cents, vat_cents)
JOIN public.orders o ON o.invoice_number LIKE '{inv_num}';
""")
    items_fixed += len(o["items"])
    orders_fixed += 1

lines.append("COMMIT;")

with open(SQL_FILE, "w") as f:
    f.write("\n".join(lines))

print(f"{orders_fixed} orders to fix with {items_fixed} total items")
print(f"SQL written to {SQL_FILE}")
print(f"\nRun: export SUPABASE_ACCESS_TOKEN=... && supabase db query --linked --file {SQL_FILE}")
