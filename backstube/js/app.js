/* ═══════════════════════════════════════════════════════════════
   app.js — login gate, nav, router, shared data cache.
   ═══════════════════════════════════════════════════════════════ */

const SCREENS = [
  { id: 'bakeday',     label: 'Bake day',    render: () => Screens.bakeday() },
  { id: 'recipes',     label: 'Recipes',     render: () => Screens.recipes() },
  { id: 'starters',    label: 'Levains',     render: () => Screens.starters() },
  { id: 'ingredients', label: 'Ingredients', render: () => Screens.ingredients() },
];

const App = {
  screen: null,
  cache: null,

  /* One fetch of everything the engine needs, shared by all screens. */
  async data(force = false) {
    if (this.cache && !force) return this.cache;
    const [ingredients, suppliers, starters, starterBuilds, recipes,
           outputs, blocks, items, settings, products] = await Promise.all([
      DB.select('bs_ingredients',     'select=*&order=name'),
      DB.select('bs_suppliers',       'select=*&order=name'),
      DB.select('bs_starters',        'select=*&order=sort_order,name'),
      DB.select('bs_starter_builds',  'select=*&order=stage_no'),
      DB.select('bs_recipes',         'select=*&order=name'),
      DB.select('bs_recipe_outputs',  'select=*&order=sort_order'),
      DB.select('bs_recipe_blocks',   'select=*&order=sort_order'),
      DB.select('bs_block_items',     'select=*&order=sort_order'),
      DB.select('bs_settings',        'select=*&limit=1'),
      DB.select('products',           'select=id,name,price_cents,active,tax_rate&order=sort_order'),
    ]);
    const raw = {
      ingredients, suppliers, starters, starterBuilds, recipes,
      outputs, blocks, items, products,
      settings: settings[0] || {},
    };
    this.cache = Engine.index(raw);
    return this.cache;
  },

  invalidate() { this.cache = null; },

  async go(id, push = true) {
    const s = SCREENS.find(x => x.id === id) || SCREENS[0];
    this.screen = s.id;
    $$('#nav button').forEach(b => b.classList.toggle('active', b.dataset.id === s.id));
    if (push && location.hash !== '#' + s.id) history.replaceState(null, '', '#' + s.id);
    const main = $('#main');
    main.innerHTML = '';
    main.append(h('p', { class: 'page-sub' }, h('span', { class: 'spinner' }), ' Loading…'));
    try {
      const node = await s.render();
      main.innerHTML = '';
      main.append(node);
    } catch (e) {
      main.innerHTML = '';
      main.append(
        h('div', { class: 'warn' }, h('strong', {}, 'Could not load this screen. '),
          (e && e.message) || String(e)),
        h('button', { class: 'btn ghost', onclick: () => App.go(s.id, false) }, 'Retry'));
      console.error(e);
    }
  },

  buildNav() {
    const nav = $('#nav');
    nav.innerHTML = '';
    for (const s of SCREENS) {
      nav.append(h('button', {
        dataset: { id: s.id },
        onclick: () => App.go(s.id),
      }, s.label));
    }
  },

  async start() {
    $('#login').hidden = true;
    $('#app').hidden = false;
    this.buildNav();
    const me = await Auth.me();
    $('#who').textContent = me ? me.email : '';
    const id = (location.hash || '').replace('#', '');
    await this.go(SCREENS.some(s => s.id === id) ? id : 'bakeday', false);
  },
};

/* ─── Login ─────────────────────────────────────────────────── */
const Login = {
  email: '',

  show(msg, isErr) {
    $('#login').hidden = false;
    $('#app').hidden = true;
    const m = $('#li-msg');
    m.textContent = msg || '';
    m.className = 'msg hint' + (isErr ? ' err' : '');
  },

  wire() {
    $('#login-email').addEventListener('submit', async ev => {
      ev.preventDefault();
      const btn = ev.target.querySelector('button');
      this.email = $('#li-email').value.trim();
      btn.disabled = true;
      this.show('Sending…');
      try {
        await Auth.sendCode(this.email);
        $('#login-email').hidden = true;
        $('#login-code').hidden = false;
        $('#li-code').focus();
        this.show(`Code sent to ${this.email}. It is valid for a few minutes.`);
      } catch (e) {
        this.show(
          /not found|signups|user/i.test(e.message)
            ? 'No admin account for that address.'
            : e.message, true);
      } finally { btn.disabled = false; }
    });

    $('#login-code').addEventListener('submit', async ev => {
      ev.preventDefault();
      const btn = ev.target.querySelector('button');
      btn.disabled = true;
      this.show('Checking…');
      try {
        await Auth.verifyCode(this.email, $('#li-code').value.trim());
        await Boot.gate();
      } catch (e) {
        this.show('That code was not accepted. ' + (e.message || ''), true);
      } finally { btn.disabled = false; }
    });

    $('#li-back').addEventListener('click', () => {
      $('#login-code').hidden = true;
      $('#login-email').hidden = false;
      this.show('');
    });

    $('#signout').addEventListener('click', () => {
      Auth.clear();
      App.invalidate();
      location.hash = '';
      Login.show('Signed out.');
      $('#login-code').hidden = true;
      $('#login-email').hidden = false;
    });
  },
};

/* ─── Boot ──────────────────────────────────────────────────── */
const Boot = {
  /* Confirm the session works AND that this account is actually an admin,
     so a non-admin gets a clear message instead of empty tables. */
  async gate() {
    Auth.load();
    if (!Auth.session) { Login.show(''); return; }
    try {
      const r = await Auth.fetchAuthed(`${CONFIG.url}/rest/v1/bs_settings?select=id&limit=1`);
      if (r.status === 401) { Login.show('Session expired — please sign in again.'); return; }
      if (!r.ok) throw new Error(`HTTP ${r.status} ${await r.text()}`);
      const rows = await r.json();
      if (!rows.length) {
        Login.show('That account is not an admin, so Backstube is not available to it.', true);
        Auth.clear();
        return;
      }
      await App.start();
    } catch (e) {
      /* A network failure is NOT a logout — keep the session and say so. */
      console.error(e);
      Login.show('Cannot reach the database right now. Your login is still saved — retry in a moment.', true);
    }
  },
};

window.addEventListener('DOMContentLoaded', () => {
  Login.wire();
  const y = new Date();
  $('#li-email').value = 'sophia@smittenbrot.de';
  Boot.gate();
});
window.addEventListener('hashchange', () => {
  const id = (location.hash || '').replace('#', '');
  if (id && id !== App.screen && SCREENS.some(s => s.id === id)) App.go(id, false);
});

/* screens attach themselves here */
const Screens = {};
