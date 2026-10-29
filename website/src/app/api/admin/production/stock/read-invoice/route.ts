import { NextRequest, NextResponse } from 'next/server';
import { withAdmin, bad } from '@/lib/production/api';
import { loadProductionData, loadStockRaw } from '@/lib/production/data';
import { INVOICE_MIMES, readInvoice, type InvoiceMime } from '@/lib/production/invoiceRead';
import { matchInvoice } from '@/lib/production/invoiceMatch';
import { berlinTodayISO } from '@/lib/production/bakeDays';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const BUCKET = 'invoices';
const MAX_BYTES = 15 * 1024 * 1024;

/**
 * POST /api/admin/production/stock/read-invoice  (multipart: file)
 *   → { draft: MatchedInvoice, extracted: ExtractedInvoice, file_path }
 * Stores the file in the private "invoices" bucket, reads it with the Claude
 * API, matches supplier + lines. Nothing is written to deliveries here.
 */
export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) return bad('ANTHROPIC_API_KEY is not set on the server.', 500);
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return bad('file is required.');
  const mime = file.type as InvoiceMime;
  if (!INVOICE_MIMES.includes(mime)) return bad('PDF, JPEG, PNG or WebP only.');
  if (file.size > MAX_BYTES) return bad('File larger than 15 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  return withAdmin(req, async (db) => {
    const today = berlinTodayISO();
    const ext = mime === 'application/pdf' ? 'pdf' : mime.split('/')[1];
    const path = `${today.slice(0, 4)}/${today}_${crypto.randomUUID().slice(0, 8)}.${ext}`;
    // bucket is created once, private (service role only)
    const { data: buckets } = await db.storage.listBuckets();
    if (!buckets?.some((b) => b.name === BUCKET)) {
      const { error } = await db.storage.createBucket(BUCKET, { public: false, fileSizeLimit: MAX_BYTES });
      if (error && !/already exists/i.test(error.message)) throw new Error(error.message);
    }
    const { error: upErr } = await db.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
    if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
    const [extracted, data, raw] = await Promise.all([readInvoice(bytes, mime), loadProductionData(db), loadStockRaw(db)]);
    const draft = matchInvoice(extracted, data, raw.suppliers, raw.supplier_items, today);
    return NextResponse.json({ draft, extracted, file_path: `${BUCKET}/${path}` });
  });
}
