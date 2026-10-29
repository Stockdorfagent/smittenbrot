/**
 * Phase 3 (owner, 29.10.2026): invoices forwarded by e-mail. Resend receives
 * mail for belege.smittenbrot.de and calls our webhook (event email.received,
 * metadata only); we verify the Svix signature, accept only the owner's sender
 * addresses, download the attachments, run the same reader + matcher as the
 * upload, save one DRAFT delivery per attachment, forward the attachments to
 * the Papierkram inbox, and reply with a short summary. Nothing is booked.
 *
 * Pure parts (signature, sender check, summary text) are here and tested;
 * processReceivedEmail does the I/O.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadProductionData, loadStockRaw, saveDraftDelivery } from './data.ts';
import { INVOICE_MIMES, readInvoice, type InvoiceMime } from './invoiceRead.ts';
import { matchInvoice, type MatchedInvoice } from './invoiceMatch.ts';
import { berlinTodayISO } from './bakeDays.ts';
import { sendMail, type MailAttachment } from '../brevo.ts';

/** Svix signature check (Resend webhooks): v1,<base64 hmac-sha256(secret, "id.timestamp.body")>, 5-minute tolerance. */
export function verifySvix(secret: string, headers: { id: string | null; timestamp: string | null; signature: string | null }, body: string, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (!secret || !headers.id || !headers.timestamp || !headers.signature) return false;
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${headers.id}.${headers.timestamp}.${body}`).digest();
  return headers.signature.split(' ').some((part) => {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) return false;
    const given = Buffer.from(sig, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

export function senderAllowed(from: string, allowed: string): boolean {
  const addr = (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
  return allowed.split(/[,;\s]+/).map((a) => a.trim().toLowerCase()).filter(Boolean).includes(addr);
}

export interface ProcessedAttachment { filename: string; draft_id: string | null; supplier: string | null; lines: number; to_check: string[]; error: string | null }

export function summaryText(items: ProcessedAttachment[], subject: string, forwarded: boolean): string {
  const lines = [`Deine Weiterleitung „${subject}“ ist angekommen.`, ''];
  for (const it of items) {
    if (it.error) { lines.push(`${it.filename}: konnte nicht gelesen werden (${it.error}).`); continue; }
    lines.push(`${it.filename}: Entwurf angelegt – ${it.supplier ?? 'Lieferant unklar'}, ${it.lines} Position${it.lines === 1 ? '' : 'en'}${it.to_check.length ? `, prüfen: ${it.to_check.join(' ')}` : ''}`);
  }
  lines.push('', 'Buchen: Production → Stock → Open drafts.', forwarded ? 'Der Beleg wurde an Papierkram weitergeleitet.' : 'Nicht an Papierkram weitergeleitet (keine Adresse hinterlegt).');
  return lines.join('\n');
}

interface ResendAttachment { id: string; filename: string; content_type: string; download_url: string }

async function resend<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.resend.com${path}`, { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY ?? ''}` } });
  if (!res.ok) throw new Error(`Resend ${res.status} on ${path}`);
  return res.json() as Promise<T>;
}

/** The whole job for one received e-mail; returns what was done (for logs and the reply mail). */
export async function processReceivedEmail(db: SupabaseClient, emailId: string, from: string, subject: string): Promise<ProcessedAttachment[]> {
  const list = await resend<{ data: ResendAttachment[] }>(`/emails/receiving/${emailId}/attachments`);
  const today = berlinTodayISO();
  const [data, raw] = await Promise.all([loadProductionData(db), loadStockRaw(db)]);
  const results: ProcessedAttachment[] = [];
  const forward: MailAttachment[] = [];
  const sender = (from.match(/<([^>]+)>/)?.[1] ?? from).trim();
  for (const a of list.data ?? []) {
    const mime = a.content_type.split(';')[0].trim() as InvoiceMime;
    if (!INVOICE_MIMES.includes(mime)) continue;
    const item: ProcessedAttachment = { filename: a.filename, draft_id: null, supplier: null, lines: 0, to_check: [], error: null };
    results.push(item);
    try {
      const bytes = new Uint8Array(await (await fetch(a.download_url)).arrayBuffer());
      if (bytes.length > 15 * 1024 * 1024) throw new Error('larger than 15 MB');
      forward.push({ name: a.filename, content: Buffer.from(bytes).toString('base64') });
      const ext = mime === 'application/pdf' ? 'pdf' : mime.split('/')[1];
      const path = `${today.slice(0, 4)}/${today}_${emailId.slice(0, 8)}_${a.id.slice(0, 8)}.${ext}`;
      const { error: upErr } = await db.storage.from('invoices').upload(path, bytes, { contentType: mime, upsert: true });
      if (upErr) throw new Error(upErr.message);
      const draft: MatchedInvoice = matchInvoice(await readInvoice(bytes, mime), data, raw.suppliers, raw.supplier_items, today);
      let supplierId = draft.supplier_id;
      if (!supplierId && draft.supplier_name) {
        const { data: s, error } = await db.from('pr_suppliers').upsert({ name: draft.supplier_name }, { onConflict: 'name' }).select('id').single();
        if (error) throw new Error(error.message);
        supplierId = s.id;
      }
      const hints = draft.notes.filter((n) => !n.includes('is new'));
      item.draft_id = await saveDraftDelivery(db, {
        supplier_id: supplierId, date: draft.date, invoice_no: draft.invoice_no, delivery_fee_cents: draft.delivery_fee_cents,
        notes: [`From e-mail: ${subject}`, ...hints].join(' · ').slice(0, 500), file_path: `invoices/${path}`, source: 'email',
        lines: draft.lines.map((l) => ({ ingredient_id: l.ingredient_id, item_text: l.item_text, qty: l.qty, pack_amount: l.pack_amount ?? 1, price_cents: l.price_cents, bbf: l.bbf })),
      });
      item.supplier = draft.supplier_name ?? raw.suppliers.find((s) => s.id === supplierId)?.name ?? null;
      item.lines = draft.lines.length;
      item.to_check = hints;
    } catch (e) {
      item.error = e instanceof Error ? e.message : String(e);
    }
  }
  const papierkram = process.env.PAPIERKRAM_INBOX_EMAIL ?? '';
  let forwarded = false;
  if (papierkram && forward.length) {
    try { await sendMail({ to: papierkram, subject: `Beleg: ${subject}`, text: `Weitergeleiteter Lieferantenbeleg (${forward.map((f) => f.name).join(', ')}).`, attachments: forward, replyTo: sender }); forwarded = true; }
    catch (e) { console.error('Papierkram forward failed:', e); }
  }
  if (results.length === 0) results.push({ filename: '(kein Anhang)', draft_id: null, supplier: null, lines: 0, to_check: [], error: 'kein PDF oder Bild im Anhang' });
  try { await sendMail({ to: sender, subject: `Re: ${subject}`, text: summaryText(results, subject, forwarded) }); }
  catch (e) { console.error('Reply mail failed:', e); }
  return results;
}
