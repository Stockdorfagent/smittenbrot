/** Transactional mail from the website (server only, BREVO_API_KEY) — same API the edge functions use. */
export interface MailAttachment { name: string; content: string /* base64 */ }

export async function sendMail(opts: { to: string; subject: string; text: string; attachments?: MailAttachment[]; replyTo?: string }): Promise<void> {
  const key = process.env.BREVO_API_KEY;
  if (!key) throw new Error('BREVO_API_KEY is not set.');
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: 'info@smittenbrot.de', name: 'Smittenbrot' },
      to: [{ email: opts.to }],
      ...(opts.replyTo ? { replyTo: { email: opts.replyTo } } : {}),
      subject: opts.subject,
      textContent: opts.text,
      ...(opts.attachments?.length ? { attachment: opts.attachments } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
