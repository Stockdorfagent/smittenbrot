/* ═══════════════════════════════════════════════════════════════
   Bake day — live demand from real orders.

   Sources of demand:
     • shop/app orders   — paid AND pending (subscriptions are pre-created
                           well before the cutoff, so they are real demand)
     • wholesale         — Lumbono, typed in, with saved We/Sa templates
     • backup units      — typed per bake day
     • levain safety     — per output, LEVAIN ONLY
   TEST- orders are excluded and counted separately.
   ═══════════════════════════════════════════════════════════════ */

Screens.bakeday = async function () {
  const ctx = await App.data(true);
  const wrap = h('div');

  /* next Wed or Sat */
  const nextBake = () => {
    const d = new Date(); d.setHours(12, 0, 0, 0);
    for (let i = 0; i < 8; i++) {
      const x = new Date(d.getTime() + i * 864e5);
      if (x.getDay() === 3 || x.getDay() === 6) return F.iso(x);
    }
    return F.iso(d);
  };
  let date = localStorage.getItem('backstube.bakedate') || nextBake();

  const dateInput = h('input', { type: 'date', value: date, style: 'max-width:170px' });
  const wdTag = h('span', { class: 'tag' });
  const statusLine = h('span', { class: 'hint' });
  const host = h('div');
  let timer = null, wholesaleCust = null;

  dateInput.addEventListener('change', () => {
    date = dateInput.value;
    localStorage.setItem('backstube.bakedate', date);
    load();
  });

  wrap.append(
    h('div', { class: 'page-head' }, h('h1', {}, 'Bake day'), wdTag),
    h('p', { class: 'page-sub' },
      'Everything below is derived from the real orders in the database. Nothing is written to stock.'),
    h('div', { class: 'panel' }, h('div', { class: 'body',
      style: 'display:flex;gap:12px;align-items:center;flex-wrap:wrap' },
      dateInput,
      h('button', { class: 'btn ghost', onclick: () => { date = nextBake(); dateInput.value = date; load(); } }, 'Next bake day'),
      h('button', { class: 'btn primary', onclick: () => load() }, 'Refresh'),
      statusLine)),
    host);

  /* ── data for one date ── */
  async function fetchOrders() {
    const q = 'select=id,order_number,payment_status,status,customer_name,' +
              'order_items(quantity,product_id)' +
              `&fulfillment_date=eq.${date}` +
              '&payment_status=in.(paid,pending)' +
              '&status=not.in.(cancelled,refunded)';
    const rows = await DB.select('orders', q);
    const paid = new Map(), pending = new Map();
    let testExcluded = 0;
    for (const o of rows) {
      if (o.order_number && /^TEST-/i.test(o.order_number)) { testExcluded++; continue; }
      const bucket = o.payment_status === 'paid' ? paid : pending;
      for (const it of o.order_items || []) {
        if (!it.product_id) continue;
        bucket.set(it.product_id, (bucket.get(it.product_id) || 0) + Number(it.quantity || 0));
      }
    }
    return { paid, pending, testExcluded, count: rows.length };
  }

  async function ensureBakeDay() {
    let rows = await DB.select('bs_bake_days', `select=*&bake_date=eq.${date}`);
    if (!rows.length) rows = await DB.insert('bs_bake_days', [{ bake_date: date }]);
    return rows[0];
  }

  async function fetchWholesale() {
    const custs = await DB.select('bs_wholesale_customers', 'select=*&active=eq.true&order=name');
    wholesaleCust = custs[0] || null;
    if (!wholesaleCust) return { qty: new Map(), order: null };
    let ords = await DB.select('bs_wholesale_orders',
      `select=*,bs_wholesale_order_items(*)&customer_id=eq.${wholesaleCust.id}&bake_date=eq.${date}`);
    let order = ords[0];
    if (!order) {
      const [o] = await DB.insert('bs_wholesale_orders',
        [{ customer_id: wholesaleCust.id, bake_date: date }]);
      order = Object.assign({}, o, { bs_wholesale_order_items: [] });
    }
    const qty = new Map();
    for (const it of order.bs_wholesale_order_items || []) qty.set(it.output_id, Number(it.qty || 0));
    return { qty, order };
  }

  /* ── render ── */
  async function load() {
    clearTimeout(timer);
    const d = new Date(date + 'T12:00:00');
    wdTag.textContent = `${F.weekday(d)} ${F.date(d)}`;
    host.innerHTML = '';
    host.append(h('p', { class: 'page-sub' }, h('span', { class: 'spinner' }), ' Reading orders…'));

    let orders, bakeDay, ws, bdp;
    try {
      [orders, bakeDay, ws] = await Promise.all([fetchOrders(), ensureBakeDay(), fetchWholesale()]);
      bdp = await DB.select('bs_bake_day_products', `select=*&bake_day_id=eq.${bakeDay.id}`);
    } catch (e) { host.innerHTML = ''; host.append(h('div', { class: 'warn' }, String(e.message || e))); return; }

    statusLine.textContent =
      `${orders.count} order${orders.count === 1 ? '' : 's'} read` +
      (orders.testExcluded ? ` · ${orders.testExcluded} TEST- excluded` : '') +
      ` · checked ${F.dateTime(new Date())}`;

    /* outputs in play: everything a recipe can produce */
    const outs = ctx.outputs.slice().sort((a, b) =>
      (a.output_name || '').localeCompare(b.output_name || ''));
    const bdpByOutput = new Map(bdp.map(r => [r.output_id, r]));

    /* alternatives: several recipes claiming one product */
    const altsByProduct = new Map();
    for (const o of outs) {
      if (!o.product_id) continue;
      if (!altsByProduct.has(o.product_id)) altsByProduct.set(o.product_id, []);
      altsByProduct.get(o.product_id).push(o);
    }

    const rows = [];   // {output, paid, pending, wholesale, backup, recipe_id}
    for (const o of outs) {
      const paid = o.product_id ? (orders.paid.get(o.product_id) || 0) : 0;
      const pend = o.product_id ? (orders.pending.get(o.product_id) || 0) : 0;
      const whole = ws.qty.get(o.id) || 0;
      const rec = bdpByOutput.get(o.id);
      rows.push({
        output: o, paid, pending: pend, wholesale: whole,
        backup: rec ? Number(rec.backup_units || 0) : 0,
        recipe_id: (rec && rec.recipe_id) || o.recipe_id,
        bdp: rec,
      });
    }

    /* If a product has alternative recipes, only ONE should take the orders.
       Default to the row whose recipe is the picked one; zero the others. */
    for (const [pid, list] of altsByProduct) {
      if (list.length < 2) continue;
      const chosenId = (() => {
        for (const o of list) { const r = bdpByOutput.get(o.id); if (r && r.recipe_id) return o.id; }
        const def = list.find(o => o.is_default); return def ? def.id : list[0].id;
      })();
      for (const o of list) if (o.id !== chosenId) {
        const r = rows.find(x => x.output.id === o.id);
        if (r) { r.paid = 0; r.pending = 0; r.alt = true; }
      }
      const cr = rows.find(x => x.output.id === chosenId);
      if (cr) cr.altOf = list;
    }

    host.innerHTML = '';

    /* ── orders table ── */
    const tbody = h('tbody');
    const activeRows = rows.filter(r =>
      r.paid || r.pending || r.wholesale || r.backup || r.altOf);

    const saveBackup = debounce(async (r, v) => {
      try {
        if (r.bdp) await DB.update('bs_bake_day_products', `id=eq.${r.bdp.id}`, { backup_units: v });
        else {
          const [x] = await DB.insert('bs_bake_day_products',
            [{ bake_day_id: bakeDay.id, output_id: r.output.id, backup_units: v, recipe_id: r.recipe_id }]);
          r.bdp = x;
        }
        toast('Saved');
      } catch (e) { fail(e); }
    }, 600);

    const saveWholesale = debounce(async (r, v) => {
      if (!ws.order) return;
      try {
        const existing = (ws.order.bs_wholesale_order_items || []).find(x => x.output_id === r.output.id);
        if (existing) {
          await DB.update('bs_wholesale_order_items', `id=eq.${existing.id}`, { qty: v });
          existing.qty = v;
        } else {
          const [x] = await DB.insert('bs_wholesale_order_items',
            [{ order_id: ws.order.id, output_id: r.output.id, qty: v }]);
          (ws.order.bs_wholesale_order_items = ws.order.bs_wholesale_order_items || []).push(x);
        }
        toast('Saved');
      } catch (e) { fail(e); }
    }, 600);

    const redraw = () => {
      tbody.innerHTML = '';
      for (const r of activeRows) {
        const total = r.paid + r.pending + r.wholesale + r.backup;
        const backupI = h('input', { class: 'cell num', type: 'number', step: '1', value: r.backup,
          oninput: ev => { r.backup = numFrom(ev.target.value) || 0; saveBackup(r, r.backup); compute(); } });
        const wholeI = h('input', { class: 'cell num', type: 'number', step: '1', value: r.wholesale,
          oninput: ev => { r.wholesale = numFrom(ev.target.value) || 0; saveWholesale(r, r.wholesale); compute(); } });

        let recipeCell = null;
        if (r.altOf && r.altOf.length > 1) {
          const sel = h('select', { class: 'cell', onchange: async ev => {
            const newOut = ev.target.value;
            for (const o of r.altOf) {
              const rr = rows.find(x => x.output.id === o.id);
              if (!rr) continue;
              const patch = { bake_day_id: bakeDay.id, output_id: o.id, recipe_id: o.id === newOut ? o.recipe_id : null };
              if (rr.bdp) await DB.update('bs_bake_day_products', `id=eq.${rr.bdp.id}`, { recipe_id: patch.recipe_id });
              else if (o.id === newOut) {
                const [x] = await DB.insert('bs_bake_day_products', [Object.assign({ backup_units: 0 }, patch)]);
                rr.bdp = x;
              }
            }
            toast('Recipe chosen'); load();
          } }, ...r.altOf.map(o => {
            const rec = ctx.recipeById.get(o.recipe_id);
            return h('option', { value: o.id, selected: o.id === r.output.id }, rec ? rec.name : o.output_name);
          }));
          recipeCell = sel;
        } else {
          const rec = ctx.recipeById.get(r.recipe_id);
          recipeCell = h('span', { class: 'hint' }, rec ? rec.name : '— no recipe —');
        }

        tbody.append(h('tr', {},
          h('td', {}, r.output.output_name,
            r.output.product_id ? null : h('span', { class: 'tag', style: 'margin-left:6px' }, 'B2B')),
          h('td', {}, recipeCell),
          h('td', { class: 'num' }, r.paid || '–'),
          h('td', { class: 'num', style: 'color:var(--grey)' }, r.pending || '–'),
          h('td', { class: 'num' }, wholeI),
          h('td', { class: 'num', style: 'background:var(--panel)' }, backupI),
          h('td', { class: 'num' }, h('strong', {}, total || '–')),
          h('td', { class: 'num hint' },
            Number(r.output.levain_safety_units) ? '+' + F.num(r.output.levain_safety_units, 2) : '–')));
      }
      if (!activeRows.length)
        tbody.append(h('tr', {}, h('td', { colspan: 8, class: 'empty' },
          'No orders for this date, and no wholesale or backups entered.')));
    };

    const loadTemplate = async () => {
      if (!wholesaleCust) { toast('No wholesale customer set up yet', true); return; }
      const wd = new Date(date + 'T12:00:00').getDay() || 7;   // 1..7, Mon=1
      const tpl = await DB.select('bs_wholesale_templates',
        `select=*&customer_id=eq.${wholesaleCust.id}&weekday=eq.${wd}`);
      if (!tpl.length) { toast('No standing order saved for this weekday', true); return; }
      for (const t of tpl) {
        const r = rows.find(x => x.output.id === t.output_id);
        if (r) { r.wholesale = Number(t.qty || 0); await saveWholesale(r, r.wholesale); }
        if (r && !activeRows.includes(r)) activeRows.push(r);
      }
      toast(`${tpl.length} standing lines loaded`);
      redraw(); compute();
    };

    const saveTemplate = async () => {
      if (!wholesaleCust) { toast('No wholesale customer set up yet', true); return; }
      const wd = new Date(date + 'T12:00:00').getDay() || 7;
      let n = 0;
      for (const r of rows) {
        if (!r.wholesale) continue;
        try {
          await DB.insert('bs_wholesale_templates',
            [{ customer_id: wholesaleCust.id, weekday: wd, output_id: r.output.id, qty: r.wholesale }]);
        } catch {
          await DB.update('bs_wholesale_templates',
            `customer_id=eq.${wholesaleCust.id}&weekday=eq.${wd}&output_id=eq.${r.output.id}`,
            { qty: r.wholesale });
        }
        n++;
      }
      toast(`Standing order for ${F.weekday(new Date(date + 'T12:00:00'))} saved (${n} lines)`);
    };

    /* let any output be added manually (wholesale items with no orders) */
    const addSel = h('select', { style: 'max-width:260px' },
      h('option', { value: '' }, '— add a product to this bake day —'),
      ...outs.filter(o => !activeRows.some(r => r.output.id === o.id))
             .map(o => h('option', { value: o.id }, o.output_name)));
    addSel.addEventListener('change', () => {
      const r = rows.find(x => x.output.id === addSel.value);
      if (r && !activeRows.includes(r)) { activeRows.push(r); redraw(); compute(); }
      addSel.value = '';
    });

    host.append(h('div', { class: 'panel' },
      h('header', {}, h('h2', {}, 'Orders'),
        h('button', { class: 'btn ghost sm', onclick: loadTemplate }, 'Load standing B2B order'),
        h('button', { class: 'btn ghost sm', onclick: saveTemplate }, 'Save as standing')),
      h('div', { class: 'body flush table-scroll' },
        h('table', {}, h('thead', {}, h('tr', {},
          h('th', {}, 'Product'), h('th', {}, 'Recipe'),
          h('th', { class: 'num' }, 'Paid'), h('th', { class: 'num' }, 'Expected'),
          h('th', { class: 'num' }, 'B2B'),
          h('th', { class: 'num', style: 'background:var(--panel)' }, 'Backup'),
          h('th', { class: 'num' }, 'Total'),
          h('th', { class: 'num' }, 'Levain safety'))), tbody)),
      h('div', { class: 'body', style: 'border-top:1px solid var(--line);display:flex;gap:10px;align-items:center;flex-wrap:wrap' },
        addSel,
        h('span', { class: 'hint' },
          '“Expected” = subscription orders already created but not yet charged.'))));
    redraw();

    /* ── results ── */
    const results = h('div');
    host.append(results);

    function compute() {
      results.innerHTML = '';
      const engRows = activeRows.map(r => ({
        output_id: r.output.id, recipe_id: r.recipe_id,
        ordered: r.paid + r.pending + r.wholesale, backup: r.backup,
      })).filter(r => r.ordered || r.backup);

      if (!engRows.length) {
        results.append(h('div', { class: 'empty' }, 'Nothing to bake yet.'));
        return;
      }

      const bd = Engine.bakeDay(date, engRows, ctx);

      if (bd.warnings.length)
        results.append(h('div', { class: 'warn' },
          h('strong', {}, 'Check: '),
          h('ul', { style: 'margin:6px 0 0;padding-left:18px' },
            ...[...new Set(bd.warnings)].map(w => h('li', {}, w)))));

      /* ingredients */
      const ib = h('tbody');
      for (const l of bd.lines) {
        ib.append(h('tr', {},
          h('td', {}, l.name, l.isFlour ? h('span', { class: 'tag', style: 'margin-left:6px' }, 'flour') : null),
          h('td', { class: 'num' }, h('strong', {}, F.g(l.grams))),
          h('td', { class: 'num hint' }, l.ing && l.ing.price_cents_per_kg != null
            ? F.eur(l.ing.price_cents_per_kg) + '/kg' : '– no price –'),
          h('td', { class: 'num' }, l.costCents != null ? F.eur(l.costCents) : '–')));
      }
      results.append(h('div', { class: 'panel' },
        h('header', {}, h('h2', {}, 'Ingredients needed'),
          h('span', { class: 'tag' }, `${bd.lines.length} items`),
          h('span', { class: 'tag ink' }, F.eur(bd.totalCostCents) + ' material')),
        h('div', { class: 'body flush table-scroll' },
          h('table', {}, h('thead', {}, h('tr', {},
            h('th', {}, 'Ingredient'), h('th', { class: 'num' }, 'Needed'),
            h('th', { class: 'num' }, 'Price'), h('th', { class: 'num' }, 'Cost'))), ib))));

      /* levain plan */
      if (bd.levains.length) {
        const lh = h('div');
        for (const ch of bd.levains) {
          const st = ch.starter;
          const lines = [];
          lines.push(`${st.name}   (${st.kind}, ${F.num(st.parts_flour, 0)} : ${F.num(st.parts_water, 0)} : ${F.num(st.parts_seed, 0)})`);
          lines.push('');
          const stages = ch.stages.slice().reverse();   // earliest first
          for (const s of stages) {
            const day = new Date(new Date(date + 'T12:00:00').getTime() - s.build.days_before * 864e5);
            lines.push(`${F.weekday(day)} ${F.date(day)}  pre-build stage ${s.build.stage_no}` +
              (s.build.duration_hours ? `  (${F.num(s.build.duration_hours, 0)} h` +
                (s.build.temp_c ? `, ${F.num(s.build.temp_c, 0)} °C)` : ')') : ''));
            lines.push(`     flour ${F.g(s.flour).padStart(10)}   water ${F.g(s.water).padStart(10)}   seed ${F.g(s.seed).padStart(10)}`);
          }
          const bday = new Date(new Date(date + 'T12:00:00').getTime() - (st.build_days_before || 2) * 864e5);
          lines.push(`${F.weekday(bday)} ${F.date(bday)}  build the levain itself`);
          lines.push(`     needs ${F.g(ch.seedTotal)} of seed from the previous stage`);
          lines.push('');
          lines.push(`Anstellgut needed from the jar: ${F.g(ch.anstellgut)}` +
            (st.typical_amount_g ? `   (jar normally ${F.g(st.typical_amount_g)})` : ''));
          lh.append(h('div', { class: 'derivation', style: 'margin-bottom:12px' }, lines.join('\n')));
        }
        results.append(h('div', { class: 'panel' },
          h('header', {}, h('h2', {}, 'Levain build plan'),
            h('span', { class: 'hint' }, 'aggregated across all products, then chained backwards')),
          h('div', { class: 'body' }, lh)));
      }

      /* per-recipe derivation */
      const dh = h('div');
      for (const ex of bd.perRecipe) {
        if (!ex.batchDough) continue;
        const L = [];
        L.push(`${ex.recipe.smittenbrot_name || ex.recipe.name}   [${ex.recipe.name}]`);
        for (const o of ex.outputs) {
          if (o.units <= 0) continue;
          L.push(`  ${o.units} × ${F.num(o.weight, 0)} g` +
            (o.loss ? `  + ${F.num(o.loss, 1)} g loss` : '') + `  = ${F.g(o.dough + o.loss)}`);
        }
        L.push(`  batch dough  ${F.g(ex.batchDough)}`);
        if (ex.levainRequired) {
          L.push(`  levain: need ${F.g(ex.levainRequired)} → build ${F.g(ex.levainBuilt)}` +
            ` (${F.num(ex.levainBuilt / ex.levainRequired, 2)}× block overage)`);
        }
        L.push(`  divide: ` + ex.outputs.filter(o => o.units > 0)
          .map(o => `${o.units} × ${F.num(o.weight, 0)} g ${o.output.output_name}`).join(',  '));
        dh.append(h('div', { class: 'derivation', style: 'margin-bottom:10px' }, L.join('\n')));
      }
      results.append(h('div', { class: 'panel' },
        h('header', {}, h('h2', {}, 'How this was worked out')),
        h('div', { class: 'body' }, dh)));

      /* water temperature */
      const rec0 = bd.perRecipe.find(x => x.recipe && x.recipe.target_dough_temp_c != null);
      if (rec0) {
        const roomI = h('input', { type: 'number', step: 'any', value: bakeDay.room_temp_c ?? 23, style: 'max-width:110px' });
        const flourI = h('input', { type: 'number', step: 'any', value: bakeDay.flour_temp_c ?? 23, style: 'max-width:110px' });
        const outEl = h('strong', { style: 'font-size:1.3rem' });
        const calc = () => {
          const t = Engine.waterTemp(rec0.recipe.target_dough_temp_c, rec0.recipe.delta_t,
            numFrom(roomI.value), numFrom(flourI.value));
          outEl.textContent = t == null ? '– set target dough °C and Delta T on the recipe –'
            : F.num(t, 1) + ' °C';
        };
        const persist = debounce(() => DB.update('bs_bake_days', `id=eq.${bakeDay.id}`,
          { room_temp_c: numFrom(roomI.value), flour_temp_c: numFrom(flourI.value) }).catch(fail), 700);
        roomI.addEventListener('input', () => { calc(); persist(); });
        flourI.addEventListener('input', () => { calc(); persist(); });
        calc();
        results.append(h('div', { class: 'panel' },
          h('header', {}, h('h2', {}, 'Water temperature'),
            h('span', { class: 'hint' }, `${rec0.recipe.name} · ((dough − delta) × 3) − room − flour`)),
          h('div', { class: 'body', style: 'display:flex;gap:18px;align-items:flex-end;flex-wrap:wrap' },
            h('label', { class: 'field' }, h('span', {}, 'Room °C'), roomI),
            h('label', { class: 'field' }, h('span', {}, 'Flour °C'), flourI),
            h('div', {}, h('div', { class: 'hint' }, 'Use water at'), outEl))));
      }
    }

    compute();

    /* light polling — effectively live, and far more robust than a
       hand-rolled websocket for a single-user local tool */
    timer = setTimeout(() => { if (App.screen === 'bakeday') load(); }, 25000);
  }

  await load();
  return wrap;
};
