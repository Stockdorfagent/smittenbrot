import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const adminEmail = process.env.ADMIN_EMAIL || 'sophia@smittenbrot.de';

export async function POST(req: NextRequest) {
  try {
    // --- Authorization: require a valid, logged-in admin session ---
    // (Unlike the other admin API routes, this one verifies the caller
    // server-side so it can't be abused as an open email relay.)
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return NextResponse.json({ error: 'Nicht autorisiert – bitte neu anmelden.' }, { status: 401 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user || user.email !== adminEmail) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 403 });
    }

    // --- Optional custom recipient; defaults to the admin address ---
    const body = await req.json().catch(() => ({} as { to?: string }));
    const requested = typeof body?.to === 'string' ? body.to.trim() : '';
    const recipient = requested.includes('@') ? requested : 'info@smittenbrot.de';

    const brevoKey = process.env.BREVO_API_KEY;
    if (!brevoKey) {
      return NextResponse.json(
        { error: 'BREVO_API_KEY ist nicht konfiguriert (Vercel → Environment Variables).' },
        { status: 500 }
      );
    }

    const sentAt = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });

    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': brevoKey },
      body: JSON.stringify({
        sender: { email: 'info@smittenbrot.de', name: 'Smittenbrot' },
        to: [{ email: recipient }],
        subject: 'Smittenbrot – Test-E-Mail',
        htmlContent: `<div style="font-family:sans-serif;color:#231f1a;">
          <p>Hallo,</p>
          <p>dies ist eine <strong>Test-E-Mail</strong> von Smittenbrot.</p>
          <p>Wenn du diese Nachricht erhältst, funktioniert der E-Mail-Versand über Brevo korrekt.</p>
          <p style="color:#888;font-size:12px;margin-top:24px;">Gesendet: ${sentAt} (Europe/Berlin)</p>
        </div>`,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('[send-test-email] Brevo error:', res.status, detail);
      return NextResponse.json(
        {
          error: `Brevo hat den Versand abgelehnt (HTTP ${res.status}). Prüfe den API-Key und den verifizierten Absender.`,
          detail: detail.slice(0, 300),
        },
        { status: 502 }
      );
    }

    const data = await res.json().catch(() => ({} as { messageId?: string }));
    return NextResponse.json({ success: true, sentTo: recipient, messageId: data?.messageId ?? null });
  } catch (err) {
    console.error('[send-test-email]', err);
    return NextResponse.json({ error: 'Test-E-Mail konnte nicht gesendet werden.' }, { status: 500 });
  }
}
