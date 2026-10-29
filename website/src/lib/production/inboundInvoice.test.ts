import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { senderAllowed, summaryText, verifySvix } from './inboundInvoice.ts';

const secret = 'whsec_' + Buffer.from('test-secret-bytes-0123456789').toString('base64');
const sign = (id: string, ts: string, body: string) => 'v1,' + createHmac('sha256', Buffer.from('test-secret-bytes-0123456789')).update(`${id}.${ts}.${body}`).digest('base64');

test('verifySvix accepts a correct signature within 5 minutes and rejects tampering, old timestamps and missing headers', () => {
  const body = '{"type":"email.received"}', id = 'msg_1', ts = '1700000000';
  const h = { id, timestamp: ts, signature: sign(id, ts, body) };
  assert.equal(verifySvix(secret, h, body, 1700000100), true);
  assert.equal(verifySvix(secret, { ...h, signature: 'v1,' + sign(id, ts, body).slice(3).replace(/.$/, 'A') }, body, 1700000100), false);
  assert.equal(verifySvix(secret, h, body + ' ', 1700000100), false);
  assert.equal(verifySvix(secret, h, body, 1700000000 + 600), false);
  assert.equal(verifySvix(secret, { ...h, signature: null }, body, 1700000100), false);
  assert.equal(verifySvix('', h, body, 1700000100), false);
  // several signatures in the header (key rotation): any valid one passes
  assert.equal(verifySvix(secret, { ...h, signature: 'v1,AAAA ' + sign(id, ts, body) }, body, 1700000100), true);
});

test('senderAllowed: display names, case, several allowed addresses', () => {
  const allowed = 'sophia@smittenbrot.de, Sophia.Private@gmail.com';
  assert.equal(senderAllowed('Sophia <sophia@smittenbrot.de>', allowed), true);
  assert.equal(senderAllowed('SOPHIA.PRIVATE@GMAIL.COM', allowed), true);
  assert.equal(senderAllowed('evil@example.com', allowed), false);
  assert.equal(senderAllowed('sophia@smittenbrot.de', ''), false);
});

test('summaryText lists drafts, checks and errors in German', () => {
  const t = summaryText([
    { filename: 'rechnung.pdf', draft_id: 'd1', supplier: 'Mühlenhof', lines: 3, to_check: ['"Kokosflocken": no matching ingredient — choose one.'], error: null },
    { filename: 'foto.jpg', draft_id: null, supplier: null, lines: 0, to_check: [], error: 'larger than 15 MB' },
  ], 'Fwd: Rechnung', true);
  assert.match(t, /rechnung\.pdf: Entwurf angelegt – Mühlenhof, 3 Positionen, prüfen: "Kokosflocken"/);
  assert.match(t, /foto\.jpg: konnte nicht gelesen werden \(larger than 15 MB\)/);
  assert.match(t, /an Papierkram weitergeleitet/);
});
