import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * Receive a cancellation declared through the public Kündigungsbutton page.
 *
 * § 312k BGB shapes this route:
 *   - Abs. 2: it must work without logging in. Cancelling may not be harder
 *     than signing up, so there is deliberately no auth here.
 *   - Abs. 4: the trader confirms "sofort auf elektronischem Wege in Textform",
 *     including the content of the declaration, the date and time it was
 *     received, and when the contract ends. That is the email below.
 *
 * Because it is unauthenticated, the form is treated as a declaration, never as
 * proof of identity: the confirmation goes to the address registered on the
 * matched account, and only falls back to the address typed into the form when
 * nothing matched. Otherwise anyone could redirect someone else's confirmation.
 *
 * Knowing an email address is therefore enough to declare a cancellation for
 * someone else, which is uncomfortable but is the price of a form that may not
 * ask for a login. The answer is reversibility rather than obstruction: the Abo
 * is put on hold (`cancellation_pending`, which stops the next order) and the
 * owner confirms or discards it under Admin → Kündigungen. Nobody is charged
 * while it waits, and nothing is destroyed if the declaration was a prank.
 */

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const SENDER = { email: 'info@smittenbrot.de', name: 'Smittenbrot' };

function deDateTime(iso: string): string {
  return new Date(iso).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Berlin',
  });
}

function deDate(d: string): string {
  return new Date(d + 'T12:00:00').toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

async function sendMail(to: string, subject: string, htmlContent: string) {
  const key = process.env.BREVO_API_KEY;
  if (!key) throw new Error('BREVO_API_KEY missing');
  const res = await fetch(BREVO_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': key, Accept: 'application/json' },
    body: JSON.stringify({ sender: SENDER, to: [{ email: to }], subject, htmlContent }),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const declaredName = String(body.name ?? '').trim();
    const declaredEmail = String(body.email ?? '').trim().toLowerCase();
    const contractLabel = String(body.contract ?? '').trim();
    const kind = body.kind === 'ausserordentlich' ? 'ausserordentlich' : 'ordentlich';
    const reason = String(body.reason ?? '').trim() || null;
    const effectiveChoice = body.effective_choice === 'datum' ? 'datum' : 'naechstmoeglich';
    const effectiveDate = effectiveChoice === 'datum' && body.effective_date
      ? String(body.effective_date)
      : null;
    const message = String(body.message ?? '').trim() || null;

    if (!declaredName || !declaredEmail || !contractLabel) {
      return NextResponse.json(
        { error: 'Bitte Name, E-Mail-Adresse und Abo angeben.' },
        { status: 400 },
      );
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(declaredEmail)) {
      return NextResponse.json({ error: 'Bitte eine gültige E-Mail-Adresse angeben.' }, { status: 400 });
    }
    // § 312k Abs. 2: an extraordinary cancellation is declared together with
    // its reason, so the form must not accept one without the other.
    if (kind === 'ausserordentlich' && !reason) {
      return NextResponse.json(
        { error: 'Bei einer außerordentlichen Kündigung bitte den Kündigungsgrund angeben.' },
        { status: 400 },
      );
    }

    const supabase = admin();
    const receivedAt = new Date().toISOString();

    // Match the declaration to an account, best effort.
    const { data: customer } = await supabase
      .from('customers')
      .select('id, email, name')
      .ilike('email', declaredEmail)
      .maybeSingle();

    let subscriptionIds: string[] = [];
    if (customer) {
      const { data: subs } = await supabase
        .from('subscriptions')
        .select('id')
        .eq('customer_id', customer.id)
        .in('status', ['active', 'paused', 'payment_failed']);
      subscriptionIds = (subs ?? []).map((s: { id: string }) => s.id);
    }

    const { data: record, error: insertError } = await supabase
      .from('cancellation_requests')
      .insert({
        declared_name: declaredName,
        declared_email: declaredEmail,
        contract_label: contractLabel,
        cancellation_kind: kind,
        cancellation_reason: reason,
        effective_choice: effectiveChoice,
        effective_date: effectiveDate,
        message,
        customer_id: customer?.id ?? null,
        subscription_ids: subscriptionIds,
        received_at: receivedAt,
      })
      .select('id')
      .single();

    if (insertError || !record) {
      console.error('[kuendigung] could not record declaration:', insertError);
      return NextResponse.json(
        { error: 'Deine Kündigung konnte nicht gespeichert werden. Bitte schreib uns an info@smittenbrot.de.' },
        { status: 500 },
      );
    }

    // Hold the Abo rather than deleting it outright. `cancellation_pending`
    // already stops the next order — placement selects status = 'active' only —
    // so nobody is charged, while the owner can still discard a declaration
    // that was not genuine. Since the form needs no login, that reversibility
    // is the only thing standing between a stranger's email address and
    // somebody's bread. processCancellations skips held subscriptions until
    // the owner resolves them (migration 025).
    if (subscriptionIds.length > 0) {
      const { error: cancelError } = await supabase
        .from('subscriptions')
        .update({ status: 'cancellation_pending' })
        .in('id', subscriptionIds);
      if (cancelError) {
        console.error('[kuendigung] could not hold subscriptions:', cancelError);
      }
    }

    // § 312k Abs. 4 — the confirmation, in text form, immediately.
    const endsAt = effectiveDate
      ? deDate(effectiveDate)
      : subscriptionIds.length > 0
        ? 'sofort — es wird keine weitere Bestellung mehr für dich aufgegeben'
        : 'zum nächstmöglichen Zeitpunkt';

    const recipient = customer?.email ?? declaredEmail;
    const html = `
      <div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1A1A1A; font-size: 15px; line-height: 1.55;">
        <p style="margin: 0 0 16px;">Hallo ${declaredName},</p>
        <p style="margin: 0 0 16px;">wir bestätigen dir den Eingang deiner Kündigung.</p>
        <table style="border-collapse: collapse; margin: 0 0 16px;">
          <tr><td style="padding: 2px 16px 2px 0; color: #6B7280;">Eingegangen am</td><td style="padding: 2px 0;"><strong>${deDateTime(receivedAt)} Uhr</strong></td></tr>
          <tr><td style="padding: 2px 16px 2px 0; color: #6B7280;">Abo</td><td style="padding: 2px 0;">${contractLabel}</td></tr>
          <tr><td style="padding: 2px 16px 2px 0; color: #6B7280;">Art der Kündigung</td><td style="padding: 2px 0;">${kind === 'ausserordentlich' ? 'Außerordentliche Kündigung' : 'Ordentliche Kündigung'}</td></tr>
          ${reason ? `<tr><td style="padding: 2px 16px 2px 0; color: #6B7280;">Kündigungsgrund</td><td style="padding: 2px 0;">${reason}</td></tr>` : ''}
          <tr><td style="padding: 2px 16px 2px 0; color: #6B7280;">Beendet</td><td style="padding: 2px 0;"><strong>${endsAt}</strong></td></tr>
          <tr><td style="padding: 2px 16px 2px 0; color: #6B7280;">Vorgangsnummer</td><td style="padding: 2px 0;">${record.id}</td></tr>
        </table>
        ${message ? `<p style="margin: 0 0 16px; color: #6B7280;">Deine Nachricht: ${message}</p>` : ''}
        <p style="margin: 0 0 16px;">
          ${subscriptionIds.length > 0
            ? 'Bereits bezahlte Bestellungen bleiben bestehen und kannst du wie gewohnt abholen.'
            : 'Falls du zusätzlich eine einzelne Bestellung stornieren möchtest, schreib uns kurz — bis zum Bestellschluss ist das möglich.'}
        </p>
        <p style="margin: 0 0 16px;">Bewahre diese E-Mail als Nachweis auf.</p>
        <p style="margin: 0;">Liebe Grüße<br>Sophia</p>
      </div>
    `.trim();

    let confirmationError: string | null = null;
    try {
      await sendMail(recipient, 'Bestätigung deiner Kündigung', html);
      await supabase
        .from('cancellation_requests')
        .update({ confirmation_sent_at: new Date().toISOString() })
        .eq('id', record.id);
    } catch (err) {
      confirmationError = err instanceof Error ? err.message : String(err);
      console.error('[kuendigung] confirmation email failed:', confirmationError);
      await supabase
        .from('cancellation_requests')
        .update({ confirmation_error: confirmationError })
        .eq('id', record.id);
    }

    // Tell the owner, so a cancellation is never something she finds out about
    // from a missing order. Best effort — never fails the request.
    try {
      await sendMail(
        process.env.ADMIN_EMAIL || 'sophia@smittenbrot.de',
        `[Smittenbrot] Kündigung eingegangen: ${declaredName}`,
        `<div style="font-family: Arial, sans-serif; font-size: 14px; color: #1A1A1A;">
           <p>${declaredName} (${declaredEmail}) hat gekündigt.</p>
           <p>Abo: ${contractLabel}<br>
              Art: ${kind}${reason ? ` (${reason})` : ''}<br>
              Eingegangen: ${deDateTime(receivedAt)} Uhr<br>
              Zugeordnetes Konto: ${customer ? customer.email : 'KEINES GEFUNDEN — bitte prüfen'}<br>
              Gekündigte Abos: ${subscriptionIds.length}</p>
           ${message ? `<p>Nachricht: ${message}</p>` : ''}
           ${confirmationError ? `<p style="color:#f8120e">Bestätigungsmail an den Kunden FEHLGESCHLAGEN: ${confirmationError}</p>` : ''}
         </div>`,
      );
    } catch (err) {
      console.error('[kuendigung] admin alert failed:', err);
    }

    return NextResponse.json({
      success: true,
      id: record.id,
      received_at: receivedAt,
      cancelled_subscriptions: subscriptionIds.length,
      matched_account: !!customer,
      confirmation_email: confirmationError ? null : recipient,
    });
  } catch (err) {
    console.error('[kuendigung] unexpected error:', err);
    return NextResponse.json(
      { error: 'Deine Kündigung konnte nicht verarbeitet werden. Bitte schreib uns an info@smittenbrot.de.' },
      { status: 500 },
    );
  }
}
