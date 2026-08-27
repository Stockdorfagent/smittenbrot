/* ═══════════════════════════════════════════════════════════════
   Ingredients — the master list. Keyboard-first inline editing,
   save-on-change, plus "Paste from Excel".
   Stored in grams / net cents; shown in kg / euro.
   ═══════════════════════════════════════════════════════════════ */

Screens.ingredients = async function () {
  const ctx = await App.data(true);
  const wrap = h('div');

  wrap.append(
    h('div', { class: 'page-head' },
      h('h1', {}, 'Ingredients'),
      h('span', { class: 'tag' }, `${ctx.ingredients.length} items`)),
    h('p', { class: 'page-sub' },
      'Prices are NET per kg — input VAT is reclaimable, so a gross price overstates your cost. ' +
      'Pack size and reorder point are entered in kg and stored in grams.'));

  /* ── save one field ── */
  const save = debounce(async (id, patch, cell) => {
    try {
      await DB.update('bs_ingredients', `id=eq.${id}`, patch);
      App.invalidate();
      if (cell) { cell.style.outline = ''; }
      toast('Saved');
    } catch (e) { fail(e); if (cell) cell.style.outline = '2px solid var(--red)'; }
  }, 550);

  const cell = (row, field, opts = {}) => {
    const v = row[field];
    const inp = h('input', {
      class: 'cell' + (opts.num ? ' num' : ''),
      type: opts.num ? 'number' : 'text',
      step: opts.step || 'any',
      value: v == null ? '' : (opts.scale ? Number(v) / opts.scale : v),
      placeholder: opts.ph || '',
      oninput: () => {
        let val = inp.value === '' ? null : (opts.num ? numFrom(inp.value) : inp.value);
        if (val != null && opts.scale) val = val * opts.scale;
        row[field] = val;
        save(row.id, { [field]: val }, inp);
      },
    });
    return inp;
  };

  const check = (row, field) => h('input', {
    type: 'checkbox', checked: !!row[field],
    onchange: ev => { row[field] = ev.target.checked; save(row.id, { [field]: ev.target.checked }); },
  });

  const supplierSelect = row => {
    const sel = h('select', {
      class: 'cell',
      onchange: () => {
        const v = sel.value || null;
        row.supplier_id = v;
        save(row.id, { supplier_id: v });
      },
    }, h('option', { value: '' }, '—'),
       ...ctx.suppliers.map(s => h('option', { value: s.id, selected: s.id === row.supplier_id }, s.name)));
    return sel;
  };

  const tbody = h('tbody');
  const drawRow = row => {
    const tr = h('tr', {},
      h('td', {}, cell(row, 'name')),
      h('td', { style: 'text-align:center' }, check(row, 'is_flour')),
      h('td', {}, supplierSelect(row)),
      h('td', { class: 'num' }, cell(row, 'price_cents_per_kg',
        { num: true, scale: 100, step: '0.01', ph: '€/kg' })),
      h('td', { class: 'num' }, cell(row, 'vat_rate',
        { num: true, scale: 0.01, step: '1', ph: '7' })),
      h('td', { class: 'num' }, cell(row, 'pack_size_g',
        { num: true, scale: 1000, step: '0.1', ph: 'kg' })),
      h('td', { class: 'num' }, cell(row, 'reorder_point_g',
        { num: true, scale: 1000, step: '0.1', ph: 'kg' })),
      h('td', { style: 'text-align:center' }, check(row, 'mhd_relevant')),
      h('td', { style: 'text-align:center' }, check(row, 'active')),
      h('td', {}, h('button', {
        class: 'btn danger sm',
        onclick: async () => {
          if (!confirm(`Delete "${row.name}"?\n\nThis fails safely if any recipe still uses it.`)) return;
          try {
            await DB.remove('bs_ingredients', `id=eq.${row.id}`);
            App.invalidate(); tr.remove(); toast('Deleted');
          } catch (e) {
            fail(new Error('Still in use by a recipe or delivery — remove those first.'));
          }
        },
      }, '×')));
    return tr;
  };
  ctx.ingredients.forEach(r => tbody.append(drawRow(r)));

  const table = h('table', {},
    h('thead', {}, h('tr', {},
      h('th', {}, 'Name'),
      h('th', { style: 'text-align:center' }, 'Flour'),
      h('th', {}, 'Supplier'),
      h('th', { class: 'num' }, '€/kg net'),
      h('th', { class: 'num' }, 'VAT %'),
      h('th', { class: 'num' }, 'Pack kg'),
      h('th', { class: 'num' }, 'Reorder kg'),
      h('th', { style: 'text-align:center' }, 'MHD'),
      h('th', { style: 'text-align:center' }, 'Active'),
      h('th', {}, ''))),
    tbody);

  /* ── add one ── */
  const newName = h('input', { type: 'text', placeholder: 'New ingredient name…' });
  const addOne = async () => {
    const name = newName.value.trim();
    if (!name) return;
    try {
      const [row] = await DB.insert('bs_ingredients', [{ name }]);
      ctx.ingredients.push(row);
      tbody.append(drawRow(row));
      App.invalidate();
      newName.value = '';
      newName.focus();
      toast('Added');
    } catch (e) {
      fail(/duplicate|unique/i.test(e.message) ? new Error(`"${name}" already exists`) : e);
    }
  };
  newName.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); addOne(); } });

  wrap.append(h('div', { class: 'panel' },
    h('header', {}, h('h2', {}, 'Master list'),
      h('span', { class: 'hint' }, 'Tab between cells · changes save themselves')),
    h('div', { class: 'body flush table-scroll' }, table),
    h('div', { class: 'body', style: 'border-top:1px solid var(--line);display:flex;gap:8px' },
      newName, h('button', { class: 'btn primary', onclick: addOne }, 'Add'))));

  /* ── paste from Excel ── */
  const ta = h('textarea', {
    placeholder:
      'Paste columns from Excel:  Name → €/kg → VAT % → Pack kg\n' +
      'Only Name is required. Existing names are updated, new ones added.\n\n' +
      'Tarwe T80/1050\t1,36\t7\t25\n' +
      'Boter\t2,99\t7\t10',
    style: 'font-family:var(--mono);font-size:0.8rem;min-height:120px',
  });
  const preview = h('div', { class: 'hint' });
  const doPreview = () => {
    const rows = parsePaste(ta.value);
    if (!rows.length) { preview.textContent = ''; return; }
    const known = new Set(ctx.ingredients.map(i => i.name.toLowerCase()));
    const upd = rows.filter(r => known.has((r[0] || '').toLowerCase())).length;
    preview.innerHTML = `<strong>${rows.length}</strong> rows — ` +
      `${rows.length - upd} new, ${upd} updated. First: <code>${esc(rows[0].join(' | '))}</code>`;
  };
  ta.addEventListener('input', doPreview);

  const doImport = async () => {
    const rows = parsePaste(ta.value);
    if (!rows.length) return;
    const byName = new Map(ctx.ingredients.map(i => [i.name.toLowerCase(), i]));
    let added = 0, updated = 0, skipped = 0;
    for (const r of rows) {
      const name = (r[0] || '').trim();
      if (!name || /^(name|zutat|ingredient)$/i.test(name)) { skipped++; continue; }
      const patch = {};
      const eur = numFrom(r[1]); if (eur != null) patch.price_cents_per_kg = eur * 100;
      const vat = numFrom(r[2]); if (vat != null) patch.vat_rate = vat > 1 ? vat / 100 : vat;
      const pk  = numFrom(r[3]); if (pk  != null) patch.pack_size_g = pk * 1000;
      try {
        const existing = byName.get(name.toLowerCase());
        if (existing) { await DB.update('bs_ingredients', `id=eq.${existing.id}`, patch); updated++; }
        else { await DB.insert('bs_ingredients', [Object.assign({ name }, patch)]); added++; }
      } catch (e) { console.error(name, e); skipped++; }
    }
    App.invalidate();
    toast(`${added} added, ${updated} updated${skipped ? `, ${skipped} skipped` : ''}`);
    App.go('ingredients', false);
  };

  wrap.append(h('div', { class: 'panel' },
    h('header', {}, h('h2', {}, 'Paste from Excel')),
    h('div', { class: 'body' },
      h('p', { class: 'hint', style: 'margin-top:0' },
        'Copy a block of cells in Excel and paste here. German decimal commas are fine. ' +
        'Nothing is written until you press Import.'),
      ta, preview,
      h('div', { style: 'margin-top:10px' },
        h('button', { class: 'btn primary', onclick: doImport }, 'Import'),
        ' ',
        h('button', { class: 'btn ghost', onclick: () => { ta.value = ''; preview.textContent = ''; } }, 'Clear')))));

  /* ── suppliers ── */
  const sBody = h('tbody');
  const sRow = s => {
    const f = (field, opts = {}) => h('input', {
      class: 'cell' + (opts.num ? ' num' : ''), type: opts.num ? 'number' : 'text',
      value: s[field] == null ? '' : s[field],
      oninput: ev => {
        const v = ev.target.value === '' ? null : (opts.num ? numFrom(ev.target.value) : ev.target.value);
        DB.update('bs_suppliers', `id=eq.${s.id}`, { [field]: v }).then(() => App.invalidate()).catch(fail);
      },
    });
    return h('tr', {}, h('td', {}, f('name')), h('td', {}, f('order_email')),
      h('td', { class: 'num' }, f('lead_days', { num: true })), h('td', {}, f('notes')));
  };
  ctx.suppliers.forEach(s => sBody.append(sRow(s)));
  const supName = h('input', { type: 'text', placeholder: 'New supplier…' });
  const addSup = async () => {
    const name = supName.value.trim(); if (!name) return;
    const [row] = await DB.insert('bs_suppliers', [{ name }]);
    ctx.suppliers.push(row); sBody.append(sRow(row)); App.invalidate();
    supName.value = ''; toast('Added');
  };
  supName.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addSup(); } });

  wrap.append(h('div', { class: 'panel' },
    h('header', {}, h('h2', {}, 'Suppliers')),
    h('div', { class: 'body flush table-scroll' },
      h('table', {}, h('thead', {}, h('tr', {},
        h('th', {}, 'Name'), h('th', {}, 'Order email'),
        h('th', { class: 'num' }, 'Lead days'), h('th', {}, 'Notes'))), sBody)),
    h('div', { class: 'body', style: 'border-top:1px solid var(--line);display:flex;gap:8px' },
      supName, h('button', { class: 'btn primary', onclick: addSup }, 'Add'))));

  return wrap;
};
