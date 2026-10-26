/**
 * Terminal twin of the admin's "pro Auszahlung" export (same code path as the
 * API route), for checking a payout without the browser.
 *
 *   node --experimental-strip-types scripts/stripe-payout-export.ts list [limit]
 *   node --experimental-strip-types scripts/stripe-payout-export.ts po_… [outDir]
 *
 * Reads the service-role key from ../../.credentials/aoryok.env and the Stripe
 * secret key from STRIPE_SECRET_KEY or ../../.credentials/"Stripe Secret Key.txt"
 * (never printed). Writes the CSV and the PDF to outDir (default: current directory).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { buildPayoutExport, listPayoutsWithCheck, PAYOUT_STATUS_LABELS } from '../src/lib/payoutExport.ts';
import { euro } from '../src/lib/payoutSplit.ts';
import { buildPayoutPdf } from '../src/lib/payoutPdf.ts';

const root = join(process.cwd(), '..', '..');
const env = Object.fromEntries(readFileSync(join(root, '.credentials', 'aoryok.env'), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const stripeKey = (process.env.STRIPE_SECRET_KEY ?? readFileSync(join(root, '.credentials', 'Stripe Secret Key.txt'), 'utf8')).trim();
if (!/^sk_(live|test)_/.test(stripeKey)) { console.error('No usable Stripe secret key'); process.exit(1); }
console.error(`Stripe mode: ${stripeKey.startsWith('sk_live_') ? 'LIVE' : 'test'}`);

const stripe = new Stripe(stripeKey);
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const arg = process.argv[2];
if (!arg || arg === 'list') {
  const list = await listPayoutsWithCheck(stripe, Number(process.argv[3] ?? 60));
  for (const p of list) {
    console.log([p.arrival_date, p.payout_id, `${euro(p.amount_cents)} €`, PAYOUT_STATUS_LABELS[p.status] ?? p.status, `${p.transactions} Tx`, p.ok ? 'OK' : `NICHT OK (${p.warnings.join('; ')})`].join('  '));
  }
} else if (/^po_/.test(arg)) {
  const { csv, filename, summary, rows } = await buildPayoutExport(stripe, db, arg);
  const outDir = process.argv[3] ?? '.';
  writeFileSync(join(outDir, filename), csv);
  const pdfName = filename.replace(/\.csv$/, '.pdf');
  writeFileSync(join(outDir, pdfName), await buildPayoutPdf(summary, rows));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`→ ${join(outDir, filename)}`);
  console.log(`→ ${join(outDir, pdfName)}`);
} else {
  console.error('usage: stripe-payout-export.ts list [limit] | po_… [outDir]');
  process.exit(1);
}
