/* ═══════════════════════════════════════════════════════════════
   Recipes — blocks of percentages, each with its own 100 % base.
   Live gram preview, validators, dated notes log, Excel paste.
   ═══════════════════════════════════════════════════════════════ */

Screens.recipes = async function () {
  const ctx = await App.data(true);
  const wrap = h('div');
  let current = localStorage.getItem('backstube.recipe') || null;
  if (!ctx.recipeById.has(current)) current = ctx.recipes.length ? ctx.recipes[0].id : null;

  const detail = h('div');

  /* ── recipe picker ── */
  const picker = h('select', {
    style: 'max-width:420px',
    onchange: ev => {
      current = ev.target.value;
      localStorage.setItem('backstube.recipe', current);
      draw();
    },
  });
  const fillPicker = () => {
    picker.innerHTML = '';
    for (const r of ctx.recipes) {
      const label = (r.smittenbrot_name ? `${r.smittenbrot_name}  —  ${r.name}` : r.name)
        + (r.is_experimental ? '   [experimental]' : '')
        + (r.active ? '' : '   [inactive]');
      picker.append(h('option', { value: r.id, selected: r.id === current }, label));
    }
  };
  fillPicker();

  const nName = h('input', { type: 'text', placeholder: 'New recipe (sheet) name…', style: 'max-width:260px' });
  const addRecipe = async () => {
    const name = nName.value.trim(); if (!name) return;
    try {
      const [r] = await DB.insert('bs_recipes', [{ name }]);
      const [b] = await DB.insert('bs_recipe_blocks',
        [{ recipe_id: r.id, name: 'Deeg', sort_order: 0, is_final: true }]);
      await DB.insert('bs_block_items',
        [{ block_id: b.id, percent: 100, is_base: true, sort_order: 0 }]);
      App.invalidate(); toast('Recipe created');
      localStorage.setItem('backstube.recipe', r.id);
      App.go('recipes', false);
    } catch (e) { fail(/unique|duplicate/i.test(e.message) ? new Error('That name exists') : e); }
  };
  nName.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addRecipe(); } });

  wrap.append(
    h('div', { class: 'page-head' }, h('h1', {}, 'Recipes'),
      h('span', { class: 'tag' }, `${ctx.recipes.length}`)),
    h('p', { class: 'page-sub' },
      'Every block has its own 100 % base — often not flour. Percentages are relative to that base.'),
    h('div', { class: 'panel' }, h('div', { class: 'body', style: 'display:flex;gap:10px;flex-wrap:wrap;align-items:center' },
      picker, h('span', { class: 'hint' }, '·'), nName,
      h('button', { class: 'btn primary', onclick: addRecipe }, 'New recipe'))),
    detail);

  /* ══ draw one recipe ══ */
  function draw() {
    detail.innerHTML = '';
    if (!current) { detail.append(h('div', { class: 'empty' }, 'No recipes yet.')); return; }
    const R = ctx.recipeById.get(current);
    const outs = (ctx.outputsByRecipe.get(current) || []).slice();
    const blocks = (ctx.blocksByRecipe.get(current) || []).slice();

    const saveR = debounce(async patch => {
      try {
        patch.version = (R.version || 1) + 1;
        await DB.update('bs_recipes', `id=eq.${R.id}`, patch);
        R.version = patch.version;
        App.invalidate(); toast('Saved');
      } catch (e) { fail(e); }
    }, 600);

    const rf = (field, opts = {}) => {
      const inp = h('input', {
        type: opts.num ? 'number' : 'text', step: opts.step || 'any',
        value: R[field] == null ? '' : R[field], placeholder: opts.ph || '',
        oninput: () => {
          const v = inp.value === '' ? null : (opts.num ? numFrom(inp.value) : inp.value);
          R[field] = v; saveR({ [field]: v }); recompute();
        },
      });
      return inp;
    };
    const rcheck = field => h('input', {
      type: 'checkbox', checked: !!R[field],
      onchange: ev => { R[field] = ev.target.checked; saveR({ [field]: ev.target.checked }); fillPicker(); },
    });

    /* ── header / meta ── */
    detail.append(h('div', { class: 'panel' },
      h('header', {},
        h('h2', {}, R.smittenbrot_name || R.name),
        R.is_experimental ? h('span', { class: 'tag red' }, 'experimental') : null,
        h('span', { class: 'tag' }, `v${R.version || 1}`),
        h('button', {
          class: 'btn danger sm',
          onclick: async () => {
            if (!confirm(`Delete recipe "${R.name}" with all its blocks and outputs?`)) return;
            try {
              await DB.remove('bs_recipes', `id=eq.${R.id}`);
              localStorage.removeItem('backstube.recipe');
              App.invalidate(); toast('Deleted'); App.go('recipes', false);
            } catch (e) { fail(e); }
          },
        }, 'Delete')),
      h('div', { class: 'body' },
        h('div', { class: 'row' },
          h('label', { class: 'field' }, h('span', {}, 'Sheet name'), rf('name')),
          h('label', { class: 'field' }, h('span', {}, 'Smittenbrot name'), rf('smittenbrot_name')),
          h('label', { class: 'field' }, h('span', {}, 'Source'), rf('source')),
          h('label', { class: 'field' }, h('span', {}, 'Page'), rf('source_page'))),
        h('div', { class: 'row' },
          h('label', { class: 'field' }, h('span', {}, 'Target dough °C'), rf('target_dough_temp_c', { num: true })),
          h('label', { class: 'field' }, h('span', {}, 'Delta T'), rf('delta_t', { num: true })),
          h('label', { class: 'field', style: 'display:flex;align-items:center;gap:7px;margin-top:18px' },
            rcheck('is_experimental'), h('span', { style: 'margin:0;text-transform:none;letter-spacing:0' }, 'Experimental')),
          h('label', { class: 'field', style: 'display:flex;align-items:center;gap:7px;margin-top:18px' },
            rcheck('active'), h('span', { style: 'margin:0;text-transform:none;letter-spacing:0' }, 'Active'))))));

    /* ── outputs ── */
    const outBody = h('tbody');
    const previewUnits = {};

    const drawOutputs = () => {
      outBody.innerHTML = '';
      for (const o of outs) {
        const saveO = debounce(async patch => {
          try { await DB.update('bs_recipe_outputs', `id=eq.${o.id}`, patch); App.invalidate(); toast('Saved'); }
          catch (e) { fail(e); }
        }, 600);

        /* the three linked weights: edit any two, the third follows */
        const bakedI = h('input', { class: 'cell num', type: 'number', step: 'any',
          value: o.target_baked_g ?? '', placeholder: 'baked g' });
        const lossI  = h('input', { class: 'cell num', type: 'number', step: 'any',
          value: o.baking_loss_pct ?? '', placeholder: '%' });
        const doughI = h('input', { class: 'cell num', type: 'number', step: 'any',
          value: o.piece_weight_g ?? '', placeholder: 'dough g' });

        const relink = changed => {
          const baked = numFrom(bakedI.value), loss = numFrom(lossI.value), dough = numFrom(doughI.value);
          let r;
          if (changed === 'dough' && baked != null) r = Engine.weights({ baked, dough });
          else if (changed === 'baked' && loss != null) r = Engine.weights({ baked, lossPct: loss });
          else if (changed === 'loss' && baked != null) r = Engine.weights({ baked, lossPct: loss });
          else if (changed === 'baked' && dough != null) r = Engine.weights({ baked, dough });
          else r = { baked, lossPct: loss, dough };
          if (r.dough != null && !isNaN(r.dough)) doughI.value = Math.round(r.dough * 100) / 100;
          if (r.lossPct != null && !isNaN(r.lossPct)) lossI.value = Math.round(r.lossPct * 1000) / 1000;
          if (r.baked != null && !isNaN(r.baked)) bakedI.value = Math.round(r.baked * 100) / 100;
          o.target_baked_g  = numFrom(bakedI.value);
          o.baking_loss_pct = numFrom(lossI.value);
          o.piece_weight_g  = numFrom(doughI.value);
          saveO({ target_baked_g: o.target_baked_g, baking_loss_pct: o.baking_loss_pct,
                  piece_weight_g: o.piece_weight_g });
          recompute();
        };
        bakedI.addEventListener('input', () => relink('baked'));
        lossI.addEventListener('input',  () => relink('loss'));
        doughI.addEventListener('input', () => relink('dough'));

        const of = (field, opts = {}) => h('input', {
          class: 'cell num', type: 'number', step: opts.step || 'any',
          value: o[field] ?? '',
          oninput: ev => {
            const v = ev.target.value === '' ? null : numFrom(ev.target.value);
            o[field] = v; saveO({ [field]: v }); recompute();
          },
        });

        const prodSel = h('select', { class: 'cell', onchange: ev => {
          o.product_id = ev.target.value || null; saveO({ product_id: o.product_id });
        } }, h('option', { value: '' }, '— wholesale only —'),
           ...ctx.products.map(p => h('option',
             { value: p.id, selected: p.id === o.product_id }, p.name + (p.active ? '' : ' (inactive)'))));

        const nameI = h('input', { class: 'cell', type: 'text', value: o.output_name || '',
          oninput: ev => { o.output_name = ev.target.value; saveO({ output_name: ev.target.value }); } });

        const units = h('input', { class: 'cell num', type: 'number', step: '1', value: previewUnits[o.id] ?? 0,
          oninput: ev => { previewUnits[o.id] = numFrom(ev.target.value) || 0; recompute(); } });

        outBody.append(h('tr', {},
          h('td', {}, nameI),
          h('td', {}, prodSel),
          h('td', { class: 'num' }, bakedI),
          h('td', { class: 'num' }, lossI),
          h('td', { class: 'num' }, doughI),
          h('td', { class: 'num' }, of('loss_g')),
          h('td', { class: 'num' }, of('levain_safety_units')),
          h('td', { class: 'num', style: 'background:var(--panel)' }, units),
          h('td', {}, h('button', { class: 'btn danger sm', onclick: async () => {
            if (!confirm(`Remove output "${o.output_name}"?`)) return;
            await DB.remove('bs_recipe_outputs', `id=eq.${o.id}`);
            outs.splice(outs.indexOf(o), 1); App.invalidate(); drawOutputs(); recompute();
          } }, '×'))));
      }
      if (!outs.length) outBody.append(h('tr', {}, h('td', { colspan: 9, class: 'hint', style: 'padding:12px' },
        'No outputs. Add one — a recipe needs at least one product it produces.')));
    };
    drawOutputs();

    const addOutput = async () => {
      const [row] = await DB.insert('bs_recipe_outputs', [{
        recipe_id: R.id, output_name: R.smittenbrot_name || R.name,
        sort_order: outs.length, is_default: !outs.length,
      }]);
      outs.push(row); App.invalidate(); drawOutputs(); recompute();
    };

    detail.append(h('div', { class: 'panel' },
      h('header', {}, h('h2', {}, 'Outputs'),
        h('span', { class: 'hint' }, 'several products can share one dough')),
      h('div', { class: 'body flush table-scroll' },
        h('table', {}, h('thead', {}, h('tr', {},
          h('th', {}, 'Output'), h('th', {}, 'Shop product'),
          h('th', { class: 'num' }, 'Baked g'), h('th', { class: 'num' }, 'Backverlust %'),
          h('th', { class: 'num' }, 'Teigeinlage g'), h('th', { class: 'num' }, 'Loss g'),
          h('th', { class: 'num' }, 'Levain safety'),
          h('th', { class: 'num', style: 'background:var(--panel)' }, 'Preview pcs'),
          h('th', {}, ''))), outBody)),
      h('div', { class: 'body', style: 'border-top:1px solid var(--line)' },
        h('button', { class: 'btn ghost sm', onclick: addOutput }, '+ Add output'),
        h('span', { class: 'hint', style: 'margin-left:12px' },
          'Baked · Backverlust · Teigeinlage are linked — fill any two. ' +
          '“Loss g” is your Factor bump in grams. “Levain safety” is in loaves, levain only.'))));

    /* ── blocks ── */
    const blocksHost = h('div');
    const drawBlocks = () => {
      blocksHost.innerHTML = '';
      blocks.sort((a, b) => a.sort_order - b.sort_order);
      for (const B of blocks) blocksHost.append(blockPanel(B));
      if (!blocks.length) blocksHost.append(h('div', { class: 'empty' }, 'No blocks yet.'));
    };

    function blockPanel(B) {
      const items = (ctx.itemsByBlock.get(B.id) || []).slice().sort((a, b) => a.sort_order - b.sort_order);
      const saveB = debounce(async patch => {
        try { await DB.update('bs_recipe_blocks', `id=eq.${B.id}`, patch); App.invalidate(); toast('Saved'); }
        catch (e) { fail(e); }
      }, 600);

      const sumEl = h('span', { class: 'tag' });
      const body = h('tbody');

      const drawItems = () => {
        body.innerHTML = '';
        let sum = 0;
        for (const it of items) {
          if (it.mode === 'percent') sum += Number(it.percent || 0);
          const saveI = debounce(async patch => {
            try { await DB.update('bs_block_items', `id=eq.${it.id}`, patch); App.invalidate(); }
            catch (e) { fail(e); }
          }, 600);

          /* target picker: ingredient / block / starter / (dough) */
          const targetSel = h('select', { class: 'cell' });
          targetSel.append(h('option', { value: 'base:', selected: !it.ingredient_id && !it.block_ref_id && !it.starter_id }, '(dough — base)'));
          const gI = h('optgroup', { label: 'Ingredient' });
          for (const i of ctx.ingredients)
            gI.append(h('option', { value: 'ing:' + i.id, selected: it.ingredient_id === i.id }, i.name));
          const gB = h('optgroup', { label: 'Block (preferment)' });
          for (const b2 of blocks) if (b2.id !== B.id)
            gB.append(h('option', { value: 'blk:' + b2.id, selected: it.block_ref_id === b2.id }, b2.name));
          const gS = h('optgroup', { label: 'Starter (jar)' });
          for (const s of ctx.starters)
            gS.append(h('option', { value: 'st:' + s.id, selected: it.starter_id === s.id }, s.name));
          targetSel.append(gI, gB, gS);
          targetSel.addEventListener('change', () => {
            const [k, v] = targetSel.value.split(':');
            const patch = { ingredient_id: null, block_ref_id: null, starter_id: null, is_base: false };
            if (k === 'ing') patch.ingredient_id = v;
            else if (k === 'blk') patch.block_ref_id = v;
            else if (k === 'st') patch.starter_id = v;
            else patch.is_base = true;
            Object.assign(it, patch);
            saveI(patch); drawItems(); recompute();
          });

          const pctI = h('input', { class: 'cell num', type: 'number', step: 'any',
            value: it.percent ?? '', oninput: ev => {
              it.percent = numFrom(ev.target.value); saveI({ percent: it.percent });
              drawItems(); recompute();
            } });

          const modeSel = h('select', { class: 'cell', onchange: ev => {
            it.mode = ev.target.value; saveI({ mode: it.mode }); drawItems(); recompute();
          } },
            h('option', { value: 'percent', selected: it.mode === 'percent' }, '% of base'),
            h('option', { value: 'per_unit_g', selected: it.mode === 'per_unit_g' }, 'g per piece'),
            h('option', { value: 'per_batch_g', selected: it.mode === 'per_batch_g' }, 'g per batch'));

          const baseC = h('input', { type: 'checkbox', checked: !!it.is_base, onchange: ev => {
            it.is_base = ev.target.checked;
            saveI({ is_base: it.is_base }); drawItems(); recompute();
          } });

          const noteI = h('input', { class: 'cell', type: 'text', value: it.note || '',
            placeholder: 'e.g. Alnatura, not Drax',
            oninput: ev => { it.note = ev.target.value; saveI({ note: it.note }); } });

          body.append(h('tr', {},
            h('td', {}, targetSel),
            h('td', { class: 'num' }, pctI),
            h('td', {}, modeSel),
            h('td', { style: 'text-align:center' }, baseC),
            h('td', {}, noteI),
            h('td', {}, h('button', { class: 'btn danger sm', onclick: async () => {
              await DB.remove('bs_block_items', `id=eq.${it.id}`);
              items.splice(items.indexOf(it), 1); App.invalidate(); drawItems(); recompute();
            } }, '×'))));
        }
        const bases = items.filter(i => i.is_base).length;
        sumEl.textContent = `Σ ${F.num(sum, 2)} %`;
        sumEl.className = 'tag' + (bases === 1 ? '' : ' red');
        if (bases !== 1) sumEl.textContent += bases === 0 ? ' · no base!' : ` · ${bases} bases!`;
      };
      drawItems();

      const addItem = async () => {
        const [row] = await DB.insert('bs_block_items', [{
          block_id: B.id, percent: 0, mode: 'percent', sort_order: items.length,
          ingredient_id: ctx.ingredients.length ? ctx.ingredients[0].id : null,
          is_base: !items.length,
        }]);
        items.push(row); App.invalidate(); drawItems(); recompute();
      };

      const bf = (field, opts = {}) => h('input', {
        type: opts.num ? 'number' : 'text', step: 'any', value: B[field] ?? '',
        oninput: ev => {
          const v = ev.target.value === '' ? null : (opts.num ? numFrom(ev.target.value) : ev.target.value);
          B[field] = v; saveB({ [field]: v }); if (opts.redraw) drawBlocks(); recompute();
        },
      });

      const scopeSel = h('select', { onchange: ev => {
        B.output_id = ev.target.value || null; saveB({ output_id: B.output_id }); recompute();
      } }, h('option', { value: '' }, 'whole batch'),
         ...outs.map(o => h('option', { value: o.id, selected: o.id === B.output_id }, `only ${o.output_name}`)));

      return h('div', { class: 'panel' },
        h('header', {},
          h('h2', {}, B.name || '(unnamed block)'),
          B.is_final ? h('span', { class: 'tag ink' }, 'final') : null,
          Number(B.overage_pct) ? h('span', { class: 'tag red' }, `× ${F.num(1 + Number(B.overage_pct) / 100, 2)}`) : null,
          sumEl,
          h('button', { class: 'btn ghost sm', onclick: async () => {
            const other = blocks.filter(b => b.id !== B.id);
            await DB.update('bs_recipe_blocks', `id=eq.${B.id}`, { is_final: true });
            for (const o of other) if (o.is_final) await DB.update('bs_recipe_blocks', `id=eq.${o.id}`, { is_final: false });
            blocks.forEach(b => b.is_final = b.id === B.id);
            App.invalidate(); drawBlocks(); recompute();
          } }, 'Make final'),
          h('button', { class: 'btn danger sm', onclick: async () => {
            if (!confirm(`Delete block "${B.name}"?`)) return;
            try {
              await DB.remove('bs_recipe_blocks', `id=eq.${B.id}`);
              blocks.splice(blocks.indexOf(B), 1); App.invalidate(); drawBlocks(); recompute();
            } catch (e) { fail(new Error('Another block still references this one.')); }
          } }, 'Delete')),
        h('div', { class: 'body' },
          h('div', { class: 'row' },
            h('label', { class: 'field' }, h('span', {}, 'Block name'), bf('name', { redraw: false })),
            h('label', { class: 'field' }, h('span', {}, 'Overage % (your ×1.1 = 10)'), bf('overage_pct', { num: true })),
            h('label', { class: 'field' }, h('span', {}, 'Applies to'), scopeSel),
            h('label', { class: 'field' }, h('span', {}, 'Sort'), bf('sort_order', { num: true }))),
          h('div', { class: 'table-scroll' },
            h('table', {}, h('thead', {}, h('tr', {},
              h('th', {}, 'Ingredient / block / starter'), h('th', { class: 'num' }, 'Amount'),
              h('th', {}, 'Mode'), h('th', { style: 'text-align:center' }, 'Base 100 %'),
              h('th', {}, 'Note'), h('th', {}, ''))), body)),
          h('div', { style: 'margin-top:10px' },
            h('button', { class: 'btn ghost sm', onclick: addItem }, '+ Add row'))));
    }

    const addBlock = async () => {
      const [row] = await DB.insert('bs_recipe_blocks', [{
        recipe_id: R.id, name: 'New block', sort_order: blocks.length, overage_pct: 0,
      }]);
      await DB.insert('bs_block_items', [{ block_id: row.id, percent: 100, is_base: true, sort_order: 0 }]);
      App.invalidate(); toast('Block added'); App.go('recipes', false);
    };

    detail.append(h('div', { class: 'panel' },
      h('header', {}, h('h2', {}, 'Blocks'),
        h('span', { class: 'hint' }, 'lowest sort first · the final block is the dough'),
        h('button', { class: 'btn ghost sm', onclick: addBlock }, '+ Add block')),
      h('div', { class: 'body flush' }, blocksHost)));
    drawBlocks();

    /* ── live preview ── */
    const previewBox = h('div', { class: 'derivation' });
    const warnBox = h('div');

    function recompute() {
      const c = App.cache || ctx;
      const units = {};
      let any = false;
      for (const o of outs) { units[o.id] = previewUnits[o.id] || 0; if (units[o.id] > 0) any = true; }
      if (!any) {
        previewBox.textContent = 'Set “Preview pcs” on an output above to see the grams.';
        warnBox.innerHTML = '';
        return;
      }
      let ex;
      try { ex = Engine.explodeRecipe(R.id, units, Engine.index({
        ingredients: ctx.ingredients, starters: ctx.starters, starterBuilds: ctx.starterBuilds,
        recipes: ctx.recipes, outputs: ctx.outputs, blocks: ctx.blocks, items: ctx.items,
        products: ctx.products, settings: ctx.settings,
      })); }
      catch (e) { previewBox.textContent = 'Error: ' + e.message; return; }

      const L = [];
      for (const o of ex.outputs) {
        if (o.units <= 0) continue;
        L.push(`${o.output.output_name}`);
        L.push(`  ${o.units} × ${F.num(o.weight, 0)} g` +
               (o.loss ? `  + ${F.num(o.loss, 1)} g loss` : '') +
               `   = ${F.g(o.dough + o.loss)}`);
        if (o.safety) L.push(`  levain basis: ${o.units} + ${F.num(o.safety, 2)} safety = ${F.num(o.units + o.safety, 2)} pcs`);
      }
      L.push('');
      L.push(`batch dough      ${F.g(ex.batchDough)}`);
      if (ex.batchDoughLevain !== ex.batchDough)
        L.push(`levain basis     ${F.g(ex.batchDoughLevain)}`);
      L.push('');
      for (const b of ex.blocks.slice().reverse()) {
        L.push(`${b.block.name}   (Σ ${F.num(b.pctSum, 2)} %, factor ${F.num(b.factor, 4)})`);
        for (const ln of b.lines) {
          if (ln.kind === 'base' && ln.grams === 0) continue;
          L.push(`   ${ln.label.padEnd(26).slice(0, 26)} ${String(F.num(ln.pct, 2)).padStart(8)} %  ` +
                 `${F.g(ln.grams).padStart(11)}${ln.kind === 'starter' ? '   ← from the jar' : ''}`);
        }
        L.push('');
      }
      if (ex.levainRequired) {
        const mult = ex.levainRequired > 0 ? ex.levainBuilt / (ex.batchDough / ex.batchDoughLevain * ex.levainRequired) : 0;
        L.push(`levain required ${F.g(ex.levainRequired)}  →  built ${F.g(ex.levainBuilt)}`);
        L.push(`combined levain margin vs. bare dough need: ${F.num(mult, 2)}×`);
      }
      previewBox.textContent = L.join('\n');

      /* validators */
      const problems = [...ex.warnings];
      for (const B of blocks) {
        const its = (ctx.itemsByBlock.get(B.id) || []);
        const bases = its.filter(i => i.is_base).length;
        if (bases !== 1) problems.push(`Block "${B.name}": needs exactly one 100 % base row (has ${bases}).`);
        const base = its.find(i => i.is_base);
        if (base && Number(base.percent) !== 100)
          problems.push(`Block "${B.name}": the base row should be 100 %, not ${F.num(base.percent, 2)} %.`);
      }
      if (!blocks.some(b => b.is_final && !b.output_id))
        problems.push('No final block marked — press “Make final” on the dough block.');
      warnBox.innerHTML = '';
      if (problems.length)
        warnBox.append(h('div', { class: 'warn' },
          h('strong', {}, `${problems.length} thing${problems.length > 1 ? 's' : ''} to fix: `),
          h('ul', { style: 'margin:6px 0 0;padding-left:18px' },
            ...[...new Set(problems)].map(p => h('li', {}, p)))));
    }

    detail.append(h('div', { class: 'panel' },
      h('header', {}, h('h2', {}, 'Live preview')),
      h('div', { class: 'body' }, warnBox, previewBox)));

    /* ── notes log ── */
    const notesHost = h('div');
    const noteInput = h('input', { type: 'text', placeholder: 'What happened? (saved with today\'s date)' });
    const addNote = async () => {
      const text = noteInput.value.trim(); if (!text) return;
      await DB.insert('bs_recipe_notes', [{ recipe_id: R.id, text }]);
      noteInput.value = ''; loadNotes(); toast('Noted');
    };
    noteInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addNote(); } });
    const loadNotes = async () => {
      notesHost.innerHTML = '';
      const rows = await DB.select('bs_recipe_notes',
        `select=*&recipe_id=eq.${R.id}&order=noted_on.desc,created_at.desc`);
      if (!rows.length) {
        notesHost.append(h('p', { class: 'hint', style: 'margin:0' },
          'Nothing yet. This is the place for “27.1.2026: 100% alnatura + acerolapoeder = ok!”'));
        return;
      }
      for (const n of rows) {
        notesHost.append(h('div', {
          style: 'display:flex;gap:10px;padding:6px 0;border-bottom:1px solid var(--line);font-size:0.86rem',
        },
          h('span', { class: 'mono', style: 'color:var(--grey);white-space:nowrap' }, F.date(n.noted_on)),
          h('span', { style: 'flex:1' }, n.text),
          h('button', { class: 'btn danger sm', onclick: async () => {
            if (!confirm('Delete this note?')) return;
            await DB.remove('bs_recipe_notes', `id=eq.${n.id}`); loadNotes();
          } }, '×')));
      }
    };

    detail.append(h('div', { class: 'panel' },
      h('header', {}, h('h2', {}, 'Notes'), h('span', { class: 'hint' }, 'dated, append-only')),
      h('div', { class: 'body' },
        h('div', { style: 'display:flex;gap:8px;margin-bottom:12px' },
          noteInput, h('button', { class: 'btn primary', onclick: addNote }, 'Add')),
        h('label', { class: 'field' }, h('span', {}, 'Standing description'),
          h('textarea', { value: R.notes || '',
            oninput: ev => { R.notes = ev.target.value; saveR({ notes: ev.target.value }); } }, R.notes || '')),
        notesHost)));
    loadNotes();

    recompute();
  }

  draw();
  return wrap;
};
