/* ═══════════════════════════════════════════════════════════════
   lib.js — auth, REST access, formatting, tiny DOM helpers.
   No framework, no CDN, no build step. Plain fetch against
   GoTrue (/auth/v1) and PostgREST (/rest/v1).
   ═══════════════════════════════════════════════════════════════ */

const LS_KEY = 'backstube.session';

const Auth = {
  session: null,

  load() {
    try { this.session = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); }
    catch { this.session = null; }
    return this.session;
  },
  save(s) {
    this.session = s;
    try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch {}
  },
  clear() {
    this.session = null;
    try { localStorage.removeItem(LS_KEY); } catch {}
  },

  async sendCode(email) {
    const r = await fetch(`${CONFIG.url}/auth/v1/otp`, {
      method: 'POST',
      headers: { apikey: CONFIG.anon, 'Content-Type': 'application/json' },
      // false: this tool is for an existing admin account only
      body: JSON.stringify({ email, create_user: false }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).msg
      || (await r.text().catch(() => '')) || `HTTP ${r.status}`);
  },

  async verifyCode(email, token) {
    const r = await fetch(`${CONFIG.url}/auth/v1/verify`, {
      method: 'POST',
      headers: { apikey: CONFIG.anon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'email', email, token }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.msg || j.error_description || `HTTP ${r.status}`);
    this.save(j);
    return j;
  },

  /* A failed refresh is NOT proof of being logged out — it is usually the
     network. Keep the refresh token on disk and let the caller retry.
     (Same lesson as the mobile app's session-persistence bug.) */
  async refresh() {
    const rt = this.session && this.session.refresh_token;
    if (!rt) return null;
    const r = await fetch(`${CONFIG.url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: CONFIG.anon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: rt }),
    });
    if (!r.ok) {
      if (r.status === 400 || r.status === 401) { this.clear(); return null; }
      throw new Error(`refresh failed: HTTP ${r.status}`);
    }
    const j = await r.json();
    this.save(j);
    return j;
  },

  async me() {
    const r = await this.fetchAuthed(`${CONFIG.url}/auth/v1/user`);
    return r.ok ? r.json() : null;
  },

  async fetchAuthed(url, opts = {}, retried = false) {
    const s = this.session;
    const headers = Object.assign({
      apikey: CONFIG.anon,
      Authorization: `Bearer ${s ? s.access_token : CONFIG.anon}`,
    }, opts.headers || {});
    const r = await fetch(url, Object.assign({}, opts, { headers }));
    if (r.status === 401 && !retried) {
      const ns = await this.refresh();
      if (ns) return this.fetchAuthed(url, opts, true);
    }
    return r;
  },
};

/* ─── PostgREST ─────────────────────────────────────────────── */
const DB = {
  async select(table, query = '') {
    const q = query ? (query.startsWith('?') ? query : '?' + query) : '';
    const r = await Auth.fetchAuthed(`${CONFIG.url}/rest/v1/${table}${q}`);
    if (!r.ok) throw new Error(`${table}: ${r.status} ${await r.text()}`);
    return r.json();
  },

  async insert(table, rows) {
    const r = await Auth.fetchAuthed(`${CONFIG.url}/rest/v1/${table}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(rows),
    });
    if (!r.ok) throw new Error(`insert ${table}: ${await r.text()}`);
    return r.json();
  },

  async update(table, query, patch) {
    const q = query.startsWith('?') ? query : '?' + query;
    const r = await Auth.fetchAuthed(`${CONFIG.url}/rest/v1/${table}${q}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    });
    if (!r.ok) throw new Error(`update ${table}: ${await r.text()}`);
    return r.json();
  },

  async remove(table, query) {
    const q = query.startsWith('?') ? query : '?' + query;
    const r = await Auth.fetchAuthed(`${CONFIG.url}/rest/v1/${table}${q}`, { method: 'DELETE' });
    if (!r.ok) throw new Error(`delete ${table}: ${await r.text()}`);
  },
};

/* ─── Formatting ────────────────────────────────────────────────
   Internally everything is grams. kg is display only.            */
const F = {
  /* 15737 -> "15,74 kg" ; 315 -> "315 g" ; 0.19 -> "0,19 g" */
  g(v) {
    if (v == null || isNaN(v)) return '–';
    const n = Number(v);
    if (Math.abs(n) >= 1000) return F.num(n / 1000, 2) + ' kg';
    if (Math.abs(n) >= 10)   return F.num(n, 0) + ' g';
    if (n === 0)             return '0 g';
    return F.num(n, 2) + ' g';
  },
  num(v, dp = 2) {
    if (v == null || isNaN(v)) return '–';
    return Number(v).toLocaleString('de-DE',
      { minimumFractionDigits: dp, maximumFractionDigits: dp });
  },
  pct(v, dp = 1) { return v == null ? '–' : F.num(v, dp) + ' %'; },
  eur(cents) {
    if (cents == null || isNaN(cents)) return '–';
    return F.num(Number(cents) / 100, 2) + ' €';
  },
  /* dd.mm.yyyy — project convention */
  date(d) {
    if (!d) return '–';
    const x = (d instanceof Date) ? d : new Date(d + (String(d).length === 10 ? 'T12:00:00' : ''));
    if (isNaN(x)) return String(d);
    const p = n => String(n).padStart(2, '0');
    return `${p(x.getDate())}.${p(x.getMonth() + 1)}.${x.getFullYear()}`;
  },
  dateTime(d) {
    if (!d) return '–';
    const x = new Date(d);
    const p = n => String(n).padStart(2, '0');
    return `${F.date(x)} ${p(x.getHours())}:${p(x.getMinutes())}`;
  },
  weekday(d) {
    const x = (d instanceof Date) ? d : new Date(d + 'T12:00:00');
    return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][x.getDay()];
  },
  iso(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  },
};

/* ─── DOM ───────────────────────────────────────────────────── */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(9)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let toastTimer;
function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, isErr ? 5200 : 2400);
}
function fail(e) {
  console.error(e);
  toast(e && e.message ? e.message : String(e), true);
}

/* debounce, for save-as-you-type cells */
function debounce(fn, ms = 500) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* Parse a pasted Excel block (TSV, or CSV as a fallback) into rows of cells.
   German decimal commas are accepted. */
function parsePaste(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim() !== '');
  const sep = lines.length && lines[0].includes('\t') ? '\t' : (lines[0].includes(';') ? ';' : ',');
  return lines.map(l => l.split(sep).map(c => c.trim()));
}
/* "1.234,56" | "1,5" | "1.5" -> Number */
function numFrom(s) {
  if (s == null || s === '') return null;
  if (typeof s === 'number') return s;
  let t = String(s).trim().replace(/\s|%|kg|g|€/gi, '');
  if (t.includes(',') && t.includes('.')) t = t.replace(/\./g, '').replace(',', '.');
  else if (t.includes(',')) t = t.replace(',', '.');
  const n = parseFloat(t);
  return isNaN(n) ? null : n;
}
