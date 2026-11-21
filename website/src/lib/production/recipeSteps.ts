/**
 * Recipe steps (owner, 21.11.2026): the method ("Werkwijze") and the planning table
 * of a recipe, as the owner keeps them in her Excel files (recipe-steps/*.xlsx):
 *
 *   A1            recipe name
 *   "Werkwijze"   then rows: label | duration or value | detail   (e.g. Bulkrijs | 90min | 22°C, 1@30, 1@60, 1@90)
 *   "Planning"    header Task | Duration | Available for other task?, then rows
 *                 (duration = Excel time like 0:15, or text like "8-12uur", "0:40-0:50")
 *
 * Stored as JSON on pr_recipes.steps, printed on the Backplan, and later the basis for
 * the bake-day planner (durations + hands-free flag). "1@30" = one stretch & fold at
 * 30 minutes — kept as text, parsed by foldsAt() when needed.
 *
 * Pure: no I/O, tested.
 */
import type { MethodStep, PlanTask, RecipeSteps } from './types';

export const EMPTY_STEPS: RecipeSteps = { method: [], planning: [] };

const str = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' && v && 'text' in (v as object) ? String((v as { text: unknown }).text) : String(v)).trim();

export function normalizeSteps(v: unknown): RecipeSteps {
  const o = (v && typeof v === 'object' ? v : {}) as { method?: unknown; planning?: unknown };
  const method: MethodStep[] = Array.isArray(o.method) ? o.method.map((m: Partial<MethodStep>) => ({ label: str(m?.label), value: str(m?.value), detail: str(m?.detail) })).filter((m) => m.label || m.value || m.detail) : [];
  const planning: PlanTask[] = Array.isArray(o.planning) ? o.planning.map((p: Partial<PlanTask>) => {
    const duration = str(p?.duration);
    const parsed = parseDuration(duration);
    return {
      task: str(p?.task), duration,
      min_minutes: typeof p?.min_minutes === 'number' ? p.min_minutes : parsed.min,
      max_minutes: typeof p?.max_minutes === 'number' ? p.max_minutes : parsed.max,
      hands_free: !!p?.hands_free,
    };
  }).filter((p) => p.task || p.duration) : [];
  return { method, planning };
}

/** "2min" → 2/2, "90min" → 90/90, "8-12uur" → 480/720, "0:40-0:50" → 40/50, "8:00-12:00" → 480/720,
 *  "1h30" → 90, "1,5 h" → 90, Excel time fraction 0.0625 → 90. Unknown → null/null. */
export function parseDuration(input: unknown): { min: number | null; max: number | null } {
  if (input instanceof Date) {   // exceljs gives time cells as a Date on 1899-12-30 (UTC)
    const base = Date.UTC(1899, 11, 30);
    const m = Math.round((input.getTime() - base) / 60000);
    return m >= 0 && m < 7 * 24 * 60 ? { min: m, max: m } : { min: null, max: null };
  }
  if (typeof input === 'number') {
    if (!isFinite(input) || input < 0) return { min: null, max: null };
    const m = Math.round(input * 24 * 60);   // Excel time = fraction of a day
    return { min: m, max: m };
  }
  const s = str(input).toLowerCase().replace(/\s+/g, '');
  if (!s || s === '-') return { min: null, max: null };
  const one = (t: string): number | null => {
    let m: RegExpMatchArray | null;
    if ((m = /^(\d{1,2}):(\d{2})$/.exec(t))) return Number(m[1]) * 60 + Number(m[2]);
    if ((m = /^(\d+(?:[.,]\d+)?)(h|u|uur|std|hr|hrs|hours?|stunden?)(\d{1,2})?(min)?$/.exec(t))) return Math.round(Number(m[1].replace(',', '.')) * 60 + Number(m[3] ?? 0));
    if ((m = /^(\d+(?:[.,]\d+)?)(min|m|minuten|minutes?)?$/.exec(t))) return Math.round(Number(m[1].replace(',', '.')));
    return null;
  };
  // ranges: the unit may sit on the second part only ("8-12uur", "40-50min")
  const range = /^(.+?)[-–](.+)$/.exec(s);
  if (range) {
    const unit = /(uur|min|h|std|m)$/.exec(range[2])?.[1] ?? '';
    const a = one(range[1]) !== null && /[a-z]$/.test(range[1]) ? one(range[1]) : one(range[1] + unit);
    const b = one(range[2]);
    if (a !== null && b !== null) return { min: Math.min(a, b), max: Math.max(a, b) };
    return { min: null, max: null };
  }
  const v = one(s);
  return { min: v, max: v };
}

/** "22°C, 1@30, 1@60, 1@90" → [30, 60, 90] (one stretch & fold at those minutes). */
export function foldsAt(detail: string): number[] {
  return [...detail.matchAll(/(\d+)@(\d+)/g)].flatMap((m) => Array(Number(m[1])).fill(Number(m[2]))).sort((a, b) => a - b);
}

export function formatMinutes(min: number | null, max: number | null): string {
  const f = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);
  if (min === null && max === null) return '';
  if (min === null) return f(max!);
  if (max === null || max === min) return f(min);
  return `${f(min)} – ${f(max)}`;
}

const YES = new Set(['yes', 'ja', 'y', 'j', 'true', 'x', '1']);

/** Rows of the first sheet (cell values, row 1 first) → recipe name + steps. */
export function parseStepsRows(rows: unknown[][]): { name: string; steps: RecipeSteps } {
  const name = str(rows[0]?.[0]);
  let section: 'none' | 'method' | 'planning' = 'none';
  const method: MethodStep[] = [];
  const planning: PlanTask[] = [];
  for (const row of rows.slice(1)) {
    const a = str(row[0]), b = row[1], c = str(row[2]);
    const bs = str(b);
    const head = (a || bs).toLowerCase();
    if (!a && !bs && !c) continue;
    if (/^(werkwijze|method|methode|schritte|steps)$/.test(head)) { section = 'method'; continue; }
    if (/^(planning|planung|plan)$/.test(head)) { section = 'planning'; continue; }
    if (section === 'planning' && /^(task|taak|aufgabe)$/.test(a.toLowerCase())) continue;   // header row
    if (section === 'method') method.push({ label: a, value: bs, detail: c === bs ? '' : c });   // a merged B:C cell repeats its value
    else if (section === 'planning') {
      const d = parseDuration(b);
      planning.push({ task: a, duration: typeof b === 'number' || b instanceof Date ? formatMinutes(d.min, d.max) : bs, min_minutes: d.min, max_minutes: d.max, hands_free: YES.has(c.toLowerCase()) });
    }
  }
  return { name, steps: { method, planning } };
}
