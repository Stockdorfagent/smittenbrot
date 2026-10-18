/**
 * Print the generated customer ingredient lists for every shop product (never writes).
 *
 *   node --experimental-strip-types scripts/production-ingredient-lists.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { computeRows } from '../src/lib/production/listStatus.ts';

const root = join(process.cwd(), '..', '..');
const env = Object.fromEntries(readFileSync(join(root, '.credentials', 'aoryok.env'), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

for (const r of await computeRows(db)) {
  console.log(`\n${r.name}${r.active ? '' : ' (inactive)'} — ${r.status}`);
  if (!r.generated) continue;
  console.log(`  NOW : ${r.current_ingredients ?? '-'}  | ${r.current_allergens ?? '-'}`);
  console.log(`  NEW : ${r.generated.text}  | ${r.generated.allergens_text}`);
  if (r.generated.blocked.length) console.log(`  BLOCKED: ${r.generated.blocked.join(' ')}`);
  if (r.diff && !r.diff.same) console.log(`  diff: -[${r.diff.removed.join(', ')}] +[${r.diff.added.join(', ')}]`);
}
