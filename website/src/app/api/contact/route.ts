import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { name, email, subject, message } = await req.json();

    if (!name || !email || !message) {
      return NextResponse.json({ error: 'Name, E-Mail und Nachricht sind erforderlich' }, { status: 400 });
    }

    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({
        sender: { email: 'kontakt@smittenbrot.de', name: 'Smittenbrot Kontaktformular' },
        to: [{ email: 'sophia@smittenbrot.de', name: 'Sophia' }],
        replyTo: { email, name },
        subject: subject ? `Kontaktformular: ${subject}` : `Kontaktformular von ${name}`,
        htmlContent: `
          <h2>Neue Nachricht über das Kontaktformular</h2>
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>E-Mail:</strong> ${email}</p>
          ${subject ? `<p><strong>Betreff:</strong> ${subject}</p>` : ''}
          <hr />
          <p><strong>Nachricht:</strong></p>
          <p>${message.replace(/\n/g, '<br>')}</p>
        `,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[contact-form] Brevo error:', errorText);
      return NextResponse.json({ error: 'Fehler beim Senden' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[contact-form]', err);
    return NextResponse.json({ error: 'Fehler beim Senden' }, { status: 500 });
  }
}
