/* ═══════════════════════════════════════════════════════════════
   Levains — the maintained jars and their build chain.
   Parts notation (the owner's "SL door 4 delen"), with hydration /
   inoculation shown as the derived equivalent.
   ═══════════════════════════════════════════════════════════════ */

Screens.starters = async function () {
  const ctx = await App.data(true);
  const wrap = h('div');

  wrap.append(
    h('div', { class: 'page-head' }, h('h1', {}, 'Levains')),
    h('p', { class: 'page-sub' },
      'Enter parts — flour : water : seed — the way you already think about it. ' +
      'Hydration and inoculation are shown as the derived equivalent, and the ' +
      'seed divisor is the "÷ 4" / "÷ 5" from your Desem schema.'));

  const flourOpts = ctx.ingredients.filter(i => i.is_flour);
  if (!flourOpts.length) {
    wrap.append(h('div', { class: 'warn' },
      h('strong', {}, 'No flours yet. '),
      'Tick the "Flour" box for your flours on the Ingredients screen first — a levain needs one.'));
  }

  const derived = st => {
    const pf = Number(st.parts_flour || 0), pw = Number(st.parts_water || 0), ps = Number(st.parts_seed || 0);
    const pt = pf + pw + ps;
    if (!pf || !pt) return { txt: 'parts incomplete', bad: true };
    return {
      bad: false,
      txt: `${pt} parts · hydration ${F.num(pw / pf * 100, 0)} % · ` +
           `inoculation ${F.num(ps / pf * 100, 0)} % · seed = total ÷ ${F.num(pt / ps, 2).replace(/,00$/, '')}`,
    };
  };

  for (const st of ctx.starters) wrap.append(card(st));
  if (!ctx.starters.length) wrap.append(h('div', { class: 'empty' }, 'No levains yet — add one below.'));

  function card(st) {
    const box = h('div', { class: 'panel' });
    const derivedLine = h('p', { class: 'hint', style: 'margin:0 0 14px' });
    const refresh = () => {
      const d = derived(st);
      derivedLine.innerHTML = d.bad ? `<strong style="color:var(--red)">${d.txt}</strong>` : esc(d.txt);
    };

    const save = debounce(async patch => {
      try { await DB.update('bs_starters', `id=eq.${st.id}`, patch); App.invalidate(); toast('Saved'); }
      catch (e) { fail(e); }
    }, 550);

    const f = (field, opts = {}) => {
      const inp = h('input', {
        type: opts.num ? 'number' : 'text', step: opts.step || 'any',
        value: st[field] == null ? '' : st[field], placeholder: opts.ph || '',
        oninput: () => {
          const v = inp.value === '' ? null : (opts.num ? numFrom(inp.value) : inp.value);
          st[field] = v; refresh(); save({ [field]: v });
        },
      });
      return inp;
    };

    const kindSel = h('select', {
      onchange: ev => { st.kind = ev.target.value; save({ kind: ev.target.value }); },
    }, h('option', { value: 'SL', selected: st.kind === 'SL' }, 'SL — stiff levain'),
       h('option', { value: 'LL', selected: st.kind === 'LL' }, 'LL — liquid levain'));

    const flourSel = h('select', {
      onchange: ev => {
        st.flour_ingredient_id = ev.target.value || null;
        save({ flour_ingredient_id: ev.target.value || null });
      },
    }, h('option', { value: '' }, '— pick a flour —'),
       ...flourOpts.map(i => h('option',
         { value: i.id, selected: i.id === st.flour_ingredient_id }, i.name)));

    /* build stages */
    const stagesBody = h('tbody');
    const drawStages = () => {
      stagesBody.innerHTML = '';
      const list = (ctx.buildsByStarter.get(st.id) || []).slice().sort((a, b) => a.stage_no - b.stage_no);
      if (!list.length) {
        stagesBody.append(h('tr', {}, h('td', { colspan: 6, class: 'hint', style: 'padding:12px' },
          'No pre-build. The seed is taken straight from the jar on the build day.')));
      }
      for (const b of list) {
        const bf = (field, opts = {}) => h('input', {
          class: 'cell num', type: 'number', step: opts.step || 'any',
          value: b[field] == null ? '' : b[field],
          oninput: ev => {
            const v = ev.target.value === '' ? null : numFrom(ev.target.value);
            b[field] = v;
            DB.update('bs_starter_builds', `id=eq.${b.id}`, { [field]: v })
              .then(() => App.invalidate()).catch(fail);
          },
        });
        stagesBody.append(h('tr', {},
          h('td', {}, `Stage ${b.stage_no}`),
          h('td', { class: 'num' }, bf('days_before', { step: '1' })),
          h('td', { class: 'num' }, bf('duration_hours')),
          h('td', { class: 'num' }, bf('temp_c')),
          h('td', { class: 'num' }, bf('overage_pct')),
          h('td', {}, h('button', {
            class: 'btn danger sm',
            onclick: async () => {
              await DB.remove('bs_starter_builds', `id=eq.${b.id}`);
              const arr = ctx.buildsByStarter.get(st.id) || [];
              arr.splice(arr.indexOf(b), 1);
              App.invalidate(); drawStages(); toast('Removed');
            },
          }, '×'))));
      }
    };
    drawStages();

    const addStage = async () => {
      const arr = ctx.buildsByStarter.get(st.id) || [];
      const next = arr.length ? Math.max(...arr.map(b => b.stage_no)) + 1 : 1;
      const [row] = await DB.insert('bs_starter_builds', [{
        starter_id: st.id, stage_no: next,
        days_before: (st.build_days_before || 2) + next,
        duration_hours: 12, temp_c: 24, overage_pct: 0,
      }]);
      if (!ctx.buildsByStarter.has(st.id)) ctx.buildsByStarter.set(st.id, []);
      ctx.buildsByStarter.get(st.id).push(row);
      App.invalidate(); drawStages(); toast('Stage added');
    };

    refresh();
    box.append(
      h('header', {},
        h('h2', {}, st.name || '(unnamed)'),
        h('span', { class: 'tag ' + (st.kind === 'LL' ? 'ink' : 'red') }, st.kind || '?'),
        h('button', {
          class: 'btn danger sm',
          onclick: async () => {
            if (!confirm(`Delete levain "${st.name}"?`)) return;
            try {
              await DB.remove('bs_starters', `id=eq.${st.id}`);
              App.invalidate(); box.remove(); toast('Deleted');
            } catch (e) { fail(new Error('Still used by a recipe block — remove that first.')); }
          },
        }, 'Delete')),
      h('div', { class: 'body' },
        derivedLine,
        h('div', { class: 'row' },
          h('label', { class: 'field' }, h('span', {}, 'Name'), f('name')),
          h('label', { class: 'field' }, h('span', {}, 'Type'), kindSel),
          h('label', { class: 'field' }, h('span', {}, 'Flour'), flourSel)),
        h('div', { class: 'row' },
          h('label', { class: 'field' }, h('span', {}, 'Parts flour'), f('parts_flour', { num: true })),
          h('label', { class: 'field' }, h('span', {}, 'Parts water'), f('parts_water', { num: true })),
          h('label', { class: 'field' }, h('span', {}, 'Parts seed'), f('parts_seed', { num: true })),
          h('label', { class: 'field' },
            h('span', {}, 'Jar normally holds (g)'), f('typical_amount_g', { num: true })),
          h('label', { class: 'field' },
            h('span', {}, 'Levain built (days before bake)'), f('build_days_before', { num: true, step: '1' }))),
        h('p', { class: 'hint', style: 'margin:0 0 6px' },
          h('strong', {}, 'Pre-builds. '),
          'Each row is a refreshment ahead of the levain build itself. ' +
          'Your Desem schema has one: built the day before, needing seed = total ÷ ' +
          (st.parts_seed ? F.num((Number(st.parts_flour) + Number(st.parts_water) + Number(st.parts_seed)) / Number(st.parts_seed), 0) : '?') +
          ' from the jar.'),
        h('div', { class: 'table-scroll' },
          h('table', {}, h('thead', {}, h('tr', {},
            h('th', {}, 'Stage'), h('th', { class: 'num' }, 'Days before bake'),
            h('th', { class: 'num' }, 'Hours'), h('th', { class: 'num' }, '°C'),
            h('th', { class: 'num' }, 'Overage %'), h('th', {}, ''))), stagesBody)),
        h('div', { style: 'margin-top:10px' },
          h('button', { class: 'btn ghost sm', onclick: addStage }, '+ Add pre-build stage'))));
    return box;
  }

  /* ── add a levain ── */
  const nName = h('input', { type: 'text', placeholder: 'e.g. SL T80/1050' });
  const nKind = h('select', {}, h('option', { value: 'SL' }, 'SL — stiff'), h('option', { value: 'LL' }, 'LL — liquid'));
  const add = async () => {
    const name = nName.value.trim(); if (!name) return;
    const preset = nKind.value === 'LL'
      ? { parts_flour: 2, parts_water: 2, parts_seed: 1 }    // LL door 5 delen
      : { parts_flour: 2, parts_water: 1, parts_seed: 1 };   // SL door 4 delen
    try {
      const [row] = await DB.insert('bs_starters',
        [Object.assign({ name, kind: nKind.value, build_days_before: 2 }, preset)]);
      ctx.starters.push(row); App.invalidate();
      toast('Added'); App.go('starters', false);
    } catch (e) { fail(/unique|duplicate/i.test(e.message) ? new Error('That name already exists') : e); }
  };
  nName.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });

  wrap.append(h('div', { class: 'panel' },
    h('header', {}, h('h2', {}, 'Add a levain')),
    h('div', { class: 'body' },
      h('p', { class: 'hint', style: 'margin-top:0' },
        'SL presets to 2 : 1 : 1 (4 parts), LL to 2 : 2 : 1 (5 parts) — your own ratios.'),
      h('div', { class: 'row' },
        h('label', { class: 'field' }, h('span', {}, 'Name'), nName),
        h('label', { class: 'field' }, h('span', {}, 'Type'), nKind),
        h('div', { style: 'display:flex;align-items:flex-end' },
          h('button', { class: 'btn primary', onclick: add }, 'Add'))))));

  return wrap;
};
