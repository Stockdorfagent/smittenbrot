import { test } from 'node:test';
import assert from 'node:assert/strict';
import { senderAllowed, summaryText } from './inboundInvoice.ts';

test('senderAllowed: display names, case, comma-separated allowed addresses', () => {
  const allowed = 'sophia@smittenbrot.de,info@smittenbrot.de, Sophia.Private@gmail.com';
  assert.equal(senderAllowed('Sophia <sophia@smittenbrot.de>', allowed), true);
  assert.equal(senderAllowed('info@smittenbrot.de', allowed), true);
  assert.equal(senderAllowed('SOPHIA.PRIVATE@GMAIL.COM', allowed), true);
  assert.equal(senderAllowed('evil@example.com', allowed), false);
  assert.equal(senderAllowed('"sophia@smittenbrot.de" <evil@example.com>', allowed), false);   // the address in <> counts, not the display name
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
