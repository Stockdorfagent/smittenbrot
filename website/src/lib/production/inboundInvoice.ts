/**
 * Phase 3 (owner, 30.10.2026): invoices forwarded by e-mail to the IONOS mailbox
 * belege@smittenbrot.de. A cron (Supabase pg_cron → /api/cron/inbound-invoices,
 * every 5 minutes) polls the mailbox over IMAP: every unread mail is marked read,
 * accepted only from the owner's sender addresses, its PDF/image attachments run
 * through the same reader + matcher as the upload, one DRAFT delivery per
 * attachment is saved, the attachments are forwarded to the Papierkram inbox,
 * and a short summary goes back to the sender. Nothing is booked.
 *
 * Pure parts (sender check, summary text) are here and tested; the rest is I/O.
 */
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadProductionData, loadStockRaw, saveDraftDelivery } from './data.ts';
import { INVOICE_MIMES, readInvoice, type InvoiceMime } from './invoiceRead.ts';
import { matchInvoice, type MatchedInvoice } from './invoiceMatch.ts';
import { berlinTodayISO } from './bakeDays.ts';
import { sendMail, type MailAttachment } from '../brevo.ts';

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

export interface InboundAttachment { filename: string; mime: InvoiceMime; bytes: Uint8Array }
export interface InboundMail { id: string; from: string; subject: string; attachments: InboundAttachment[] }

/** One forwarded mail: drafts for its attachments, forward to Papierkram, reply. */
export async function processInboundMail(db: SupabaseClient, mail: InboundMail): Promise<ProcessedAttachment[]> {
  const today = berlinTodayISO();
  const [data, raw] = await Promise.all([loadProductionData(db), loadStockRaw(db)]);
  const results: ProcessedAttachment[] = [];
  const forward: MailAttachment[] = [];
  const sender = (mail.from.match(/<([^>]+)>/)?.[1] ?? mail.from).trim();
  for (const [i, a] of mail.attachments.entries()) {
    const item: ProcessedAttachment = { filename: a.filename, draft_id: null, supplier: null, lines: 0, to_check: [], error: null };
    results.push(item);
    try {
      if (a.bytes.length > 15 * 1024 * 1024) throw new Error('larger than 15 MB');
      forward.push({ name: a.filename, content: Buffer.from(a.bytes).toString('base64') });
      const ext = a.mime === 'application/pdf' ? 'pdf' : a.mime.split('/')[1];
      const path = `${today.slice(0, 4)}/${today}_${mail.id.replace(/[^\w]/g, '').slice(0, 12)}_${i + 1}.${ext}`;
      const { error: upErr } = await db.storage.from('invoices').upload(path, a.bytes, { contentType: a.mime, upsert: true });
      if (upErr) throw new Error(upErr.message);
      const draft: MatchedInvoice = matchInvoice(await readInvoice(a.bytes, a.mime), data, raw.suppliers, raw.supplier_items, today);
      let supplierId = draft.supplier_id;
      if (!supplierId && draft.supplier_name) {
        const { data: s, error } = await db.from('pr_suppliers').upsert({ name: draft.supplier_name }, { onConflict: 'name' }).select('id').single();
        if (error) throw new Error(error.message);
        supplierId = s.id;
      }
      const hints = draft.notes.filter((n) => !n.includes('is new'));
      item.draft_id = await saveDraftDelivery(db, {
        supplier_id: supplierId, date: draft.date, invoice_no: draft.invoice_no, delivery_fee_cents: draft.delivery_fee_cents,
        notes: [`From e-mail: ${mail.subject}`, ...hints].join(' · ').slice(0, 500), file_path: `invoices/${path}`, source: 'email',
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
    try { await sendMail({ to: papierkram, subject: `Beleg: ${mail.subject}`, text: `Weitergeleiteter Lieferantenbeleg (${forward.map((f) => f.name).join(', ')}).`, attachments: forward, replyTo: sender }); forwarded = true; }
    catch (e) { console.error('Papierkram forward failed:', e); }
  }
  if (results.length === 0) results.push({ filename: '(kein Anhang)', draft_id: null, supplier: null, lines: 0, to_check: [], error: 'kein PDF oder Bild im Anhang' });
  try { await sendMail({ to: sender, subject: `Re: ${mail.subject}`, text: summaryText(results, mail.subject, forwarded) }); }
  catch (e) { console.error('Reply mail failed:', e); }
  return results;
}

export interface PollResult { seen: number; processed: { from: string; subject: string; results: ProcessedAttachment[] }[]; ignored: string[] }

/** Poll the IONOS mailbox: unread mails are marked read first (so an overlapping run skips them), then handled. */
export async function pollInbox(db: SupabaseClient, opts: { host?: string; user: string; password: string; allowedSenders: string; max?: number }): Promise<PollResult> {
  const client = new ImapFlow({ host: opts.host ?? 'imap.ionos.de', port: 993, secure: true, auth: { user: opts.user, pass: opts.password }, logger: false });
  const out: PollResult = { seen: 0, processed: [], ignored: [] };
  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const uids = (await client.search({ seen: false }, { uid: true })) || [];
      for (const uid of uids.slice(0, opts.max ?? 10)) {
        await client.messageFlagsAdd({ uid }, ['\\Seen'], { uid: true });
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!msg || !msg.source) continue;
        out.seen += 1;
        const parsed = await simpleParser(msg.source);
        const from = parsed.from?.text ?? '';
        const subject = parsed.subject ?? '(ohne Betreff)';
        if (!senderAllowed(from, opts.allowedSenders)) { out.ignored.push(from.replace(/[^@.\w<>\s-]/g, '')); continue; }
        const attachments: InboundAttachment[] = (parsed.attachments ?? [])
          .filter((a) => INVOICE_MIMES.includes(a.contentType as InvoiceMime))
          .map((a, i) => ({ filename: a.filename || `anhang-${i + 1}`, mime: a.contentType as InvoiceMime, bytes: new Uint8Array(a.content) }));
        const results = await processInboundMail(db, { id: parsed.messageId ?? `uid-${uid}`, from, subject, attachments });
        out.processed.push({ from, subject, results });
      }
    } finally { lock.release(); }
  } finally { await client.logout().catch(() => undefined); }
  return out;
}
