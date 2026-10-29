/**
 * Reads a supplier invoice (PDF or photo) into structured data with the Claude
 * API (server only; ANTHROPIC_API_KEY). Returns the extraction; matching to
 * ingredients happens in invoiceMatch.ts, booking only after the owner confirms.
 * Amounts are NET cents; the model converts gross lines using the VAT shown.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { ExtractedInvoice } from './invoiceMatch';

const LineSchema = z.object({
  description: z.string().describe('The item wording exactly as printed'),
  quantity: z.number().nullable().describe('Number of packs/units ordered of this line'),
  pack_size_value: z.number().nullable().describe('Size of ONE pack as printed, e.g. 25 for "25 kg"'),
  pack_size_unit: z.enum(['g', 'kg', 'ml', 'l', 'pcs']).nullable(),
  line_net_cents: z.number().int().nullable().describe('Net line total in cents (whole line, all packs), without VAT'),
  best_before: z.string().nullable().describe('YYYY-MM-DD if a best-before / MHD date is printed for this line'),
  is_fee_or_deposit: z.boolean().describe('true for delivery/shipping fees, deposits (Pfand), packaging surcharges, discounts — anything that is not goods'),
});
export const InvoiceSchema = z.object({
  supplier: z.string().nullable().describe('Supplier / seller company name'),
  invoice_date: z.string().nullable().describe('YYYY-MM-DD'),
  invoice_no: z.string().nullable(),
  delivery_fee_net_cents: z.number().int().nullable().describe('Delivery/shipping fee in net cents if shown as a separate position; else null'),
  lines: z.array(LineSchema),
});

export type InvoiceMime = 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp';
export const INVOICE_MIMES: InvoiceMime[] = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

const SYSTEM = `You read supplier invoices and delivery notes for a small German bakery and return the structured data.
Rules: amounts are NET (without VAT) in cents; if a line shows a gross amount, convert it with the VAT rate printed for that line (food is usually 7 %). Quantity = number of packs; pack size = ONE pack as printed ("25 kg Sack" → 25 kg; "30er Eier" → 30 pcs; "6 × 1 kg" → quantity 6, pack 1 kg). Mark fees, deposits (Pfand), surcharges and discounts with is_fee_or_deposit = true. Dates as YYYY-MM-DD. Keep the item wording exactly as printed. If something is not on the document, use null — never guess.`;

export async function readInvoice(bytes: Uint8Array, mime: InvoiceMime): Promise<ExtractedInvoice> {
  const client = new Anthropic();
  const data = Buffer.from(bytes).toString('base64');
  const file = mime === 'application/pdf'
    ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data } }
    : { type: 'image' as const, source: { type: 'base64' as const, media_type: mime, data } };
  const response = await client.messages.parse({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: 'user', content: [file, { type: 'text', text: 'Extract this invoice.' }] }],
    output_config: { format: zodOutputFormat(InvoiceSchema) },
  });
  if (response.stop_reason === 'refusal') throw new Error('The model declined to read this document.');
  const out = response.parsed_output;
  if (!out) throw new Error('The invoice could not be read into the expected structure.');
  return out;
}
