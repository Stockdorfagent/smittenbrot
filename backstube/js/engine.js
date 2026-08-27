/* ═══════════════════════════════════════════════════════════════
   engine.js — the demand engine.

   Reproduces the owner's own arithmetic, generalised:

     dough        = Σ_outputs (units × piece_weight_g) + loss
     factor       = dough ÷ (Σ percent of the final block)
     item grams   = factor × percent
     nested block = referenced grams × (1 + overage_pct/100), recursed
     levain       = same, but on (units + levain_safety_units)  ← levain only
     starter seed = aggregated ACROSS RECIPES, then chained backwards

   Percentages are relative to THEIR OWN BLOCK's base — which is often not
   flour (in Tourte de meule's final block the base is the Autolysedeeg).
   ═══════════════════════════════════════════════════════════════ */

const Engine = {

  /* Build lookup tables once per screen load. */
  index(raw) {
    const ctx = Object.assign({}, raw);
    const by = (arr, k) => {
      const m = new Map();
      for (const x of arr || []) m.set(x[k], x);
      return m;
    };
    const group = (arr, k) => {
      const m = new Map();
      for (const x of arr || []) {
        if (!m.has(x[k])) m.set(x[k], []);
        m.get(x[k]).push(x);
      }
      return m;
    };
    ctx.ingById      = by(raw.ingredients, 'id');
    ctx.starterById  = by(raw.starters, 'id');
    ctx.recipeById   = by(raw.recipes, 'id');
    ctx.outputById   = by(raw.outputs, 'id');
    ctx.blockById    = by(raw.blocks, 'id');
    ctx.outputsByRecipe = group(raw.outputs, 'recipe_id');
    ctx.blocksByRecipe  = group(raw.blocks, 'recipe_id');
    ctx.itemsByBlock    = group(raw.items, 'block_id');
    ctx.buildsByStarter = group(raw.starterBuilds, 'starter_id');
    for (const list of ctx.blocksByRecipe.values())
      list.sort((a, b) => a.sort_order - b.sort_order);
    for (const list of ctx.itemsByBlock.values())
      list.sort((a, b) => a.sort_order - b.sort_order);
    for (const list of ctx.outputsByRecipe.values())
      list.sort((a, b) => a.sort_order - b.sort_order);
    for (const list of ctx.buildsByStarter.values())
      list.sort((a, b) => a.stage_no - b.stage_no);
    return ctx;
  },

  /* Does this block (or anything it references) draw on a starter?
     Items pointing at such a block get the LEVAIN factor, not the dough one. */
  blockIsLevain(block, ctx, seen) {
    seen = seen || new Set();
    if (!block || seen.has(block.id)) return false;
    seen.add(block.id);
    for (const it of ctx.itemsByBlock.get(block.id) || []) {
      if (it.starter_id) return true;
      if (it.block_ref_id &&
          this.blockIsLevain(ctx.blockById.get(it.block_ref_id), ctx, seen)) return true;
    }
    return false;
  },

  /* ── Explode ONE recipe for given unit counts ────────────────
     unitsByOutput: { [output_id]: units }                        */
  explodeRecipe(recipeId, unitsByOutput, ctx) {
    const recipe = ctx.recipeById.get(recipeId);
    const res = {
      recipe,
      outputs: [], blocks: [], warnings: [],
      ingredients: new Map(),   // ingredient_id -> grams
      starterSeeds: new Map(),  // starter_id    -> grams (seed for the levain build)
      batchDough: 0, batchDoughLevain: 0, totalUnits: 0,
      levainRequired: 0, levainBuilt: 0,
    };
    if (!recipe) { res.warnings.push('recipe not found'); return res; }

    const outs = ctx.outputsByRecipe.get(recipeId) || [];
    if (!outs.length) { res.warnings.push(`${recipe.name}: no outputs defined`); return res; }

    /* 1 — dough per output, plus the levain-only basis */
    for (const o of outs) {
      const units  = Number(unitsByOutput[o.id] || 0);
      const weight = Number(o.piece_weight_g || 0);
      const safety = Number(o.levain_safety_units || 0);
      if (units > 0 && !weight)
        res.warnings.push(`${o.output_name}: no dough weight (Teigeinlage) set — excluded`);

      const base = units * weight;
      /* loss applies once per batch, and only if this output is actually baked
         — matching the owner's IF(orders=0, 0, …) guard */
      const loss = units > 0
        ? Number(o.loss_g || 0) + base * Number(o.loss_pct || 0) / 100
        : 0;

      res.batchDough       += base + loss;
      res.batchDoughLevain += (units > 0 ? (units + safety) * weight : 0) + loss;
      res.totalUnits       += units;
      res.outputs.push({ output: o, units, safety, weight, dough: base, loss });
    }
    if (res.batchDough <= 0) return res;   // nothing ordered

    /* 2 — the final block */
    const blocks = ctx.blocksByRecipe.get(recipeId) || [];
    const final = blocks.find(b => b.is_final && !b.output_id)
               || blocks.filter(b => !b.output_id).slice(-1)[0];
    if (!final) { res.warnings.push(`${recipe.name}: no final block`); return res; }

    const visiting = new Set();

    const computeBlock = (block, targetDough, targetLevain, depth) => {
      if (visiting.has(block.id)) {
        res.warnings.push(`circular block reference at "${block.name}"`);
        return null;
      }
      if (depth > 12) { res.warnings.push('block nesting too deep'); return null; }
      visiting.add(block.id);

      const items  = ctx.itemsByBlock.get(block.id) || [];
      const pctSum = items.filter(i => i.mode === 'percent')
                          .reduce((s, i) => s + Number(i.percent || 0), 0);
      if (pctSum <= 0) res.warnings.push(`block "${block.name}": percentages sum to 0`);

      const fDough  = pctSum > 0 ? targetDough  / pctSum : 0;
      const fLevain = pctSum > 0 ? targetLevain / pctSum : 0;

      const view = {
        block, target: targetDough, pctSum,
        factor: fDough, factorLevain: fLevain, lines: [],
      };

      for (const it of items) {
        const pct = Number(it.percent || 0);
        const toLevain = !!it.starter_id ||
          (it.block_ref_id && this.blockIsLevain(ctx.blockById.get(it.block_ref_id), ctx));
        const f = toLevain ? fLevain : fDough;

        let grams;
        if (it.mode === 'per_unit_g')       grams = pct * res.totalUnits;
        else if (it.mode === 'per_batch_g') grams = pct;
        else                                grams = f * pct;

        let label = '?', kind = 'ingredient';
        if (it.ingredient_id) {
          const ing = ctx.ingById.get(it.ingredient_id);
          label = ing ? ing.name : '(missing ingredient)';
          if (!ing) res.warnings.push(`block "${block.name}": ingredient row is missing`);
          res.ingredients.set(it.ingredient_id,
            (res.ingredients.get(it.ingredient_id) || 0) + grams);

        } else if (it.starter_id) {
          const st = ctx.starterById.get(it.starter_id);
          label = st ? st.name : '(missing starter)';
          kind = 'starter';
          res.starterSeeds.set(it.starter_id,
            (res.starterSeeds.get(it.starter_id) || 0) + grams);

        } else if (it.block_ref_id) {
          const rb = ctx.blockById.get(it.block_ref_id);
          label = rb ? rb.name : '(missing block)';
          kind = 'block';
          if (rb) {
            const over = Number(rb.overage_pct || 0);
            const built = grams * (1 + over / 100);
            if (this.blockIsLevain(rb, ctx)) {
              res.levainRequired += grams;
              res.levainBuilt    += built;
            }
            computeBlock(rb, built, built, depth + 1);
          }

        } else if (it.is_base) {
          /* virtual base — the dough of the scope that referenced this block */
          label = '(dough)';
          kind = 'base';
        }

        view.lines.push({ item: it, label, kind, grams, pct, toLevain });
      }

      res.blocks.push(view);
      visiting.delete(block.id);
      return view;
    };

    computeBlock(final, res.batchDough, res.batchDoughLevain, 0);

    /* 3 — output-scoped blocks (e.g. Zadenmelange, seeded variant only).
           Their base is that output's own dough. */
    for (const b of blocks) {
      if (!b.output_id) continue;
      const oe = res.outputs.find(x => x.output.id === b.output_id);
      if (!oe || oe.units <= 0) continue;          // not baked -> skip entirely
      const items  = ctx.itemsByBlock.get(b.id) || [];
      const pctSum = items.filter(i => i.mode === 'percent')
                          .reduce((s, i) => s + Number(i.percent || 0), 0);
      if (pctSum <= 0) continue;
      /* base item is 100 -> factor must be doughOfOutput / 100 */
      const target = oe.dough * pctSum / 100;
      computeBlock(b, target, target, 0);
    }

    return res;
  },

  /* ── Chain one starter stream backwards ──────────────────────
     seedTotal = grams of starter the doughs' levain builds need,
                 already aggregated across every recipe.          */
  chainStarter(starterId, seedTotal, ctx) {
    const st = ctx.starterById.get(starterId);
    const out = { starter: st, seedTotal, stages: [], anstellgut: seedTotal, warnings: [] };
    if (!st) { out.warnings.push('starter not found'); return out; }

    const pf = Number(st.parts_flour || 0);
    const pw = Number(st.parts_water || 0);
    const ps = Number(st.parts_seed  || 0);
    const pt = pf + pw + ps;
    if (pt <= 0 || ps <= 0) {
      out.warnings.push(`${st.name}: parts not set (need flour : water : seed)`);
      return out;
    }

    /* Pre-builds, latest first: the one closest to use must yield seedTotal. */
    const builds = (ctx.buildsByStarter.get(starterId) || []).slice().reverse();
    let target = seedTotal;
    for (const b of builds) {
      const total = target * (1 + Number(b.overage_pct || 0) / 100);
      const flour = total * pf / pt;
      const water = total * pw / pt;
      const seed  = total * ps / pt;
      out.stages.push({ build: b, total, flour, water, seed });
      target = seed;
    }
    out.anstellgut = target;

    if (st.typical_amount_g && out.anstellgut > Number(st.typical_amount_g)) {
      out.warnings.push(
        `${st.name}: needs ${F.g(out.anstellgut)} of Anstellgut but the jar normally holds ` +
        `${F.g(st.typical_amount_g)} — refresh the jar or add a build stage.`);
    }
    return out;
  },

  /* ── Full bake-day demand ────────────────────────────────────
     rows: [{ output_id, recipe_id, ordered, backup }]            */
  bakeDay(bakeDate, rows, ctx) {
    const out = {
      bakeDate, perRecipe: [], warnings: [],
      ingredients: new Map(),   // ingredient_id -> grams
      levains: [],
      totalCostCents: 0,
    };

    /* group by the recipe actually chosen for each output */
    const byRecipe = new Map();
    for (const r of rows) {
      const units = Number(r.ordered || 0) + Number(r.backup || 0);
      const o = ctx.outputById.get(r.output_id);
      if (!o) continue;
      const rid = r.recipe_id || o.recipe_id;
      if (!rid) { out.warnings.push(`${o.output_name}: no recipe selected`); continue; }
      if (!byRecipe.has(rid)) byRecipe.set(rid, {});
      byRecipe.get(rid)[r.output_id] = units;
    }

    const seeds = new Map();
    for (const [rid, unitsByOutput] of byRecipe) {
      const ex = this.explodeRecipe(rid, unitsByOutput, ctx);
      out.perRecipe.push(ex);
      out.warnings.push(...ex.warnings);
      for (const [k, v] of ex.ingredients)
        out.ingredients.set(k, (out.ingredients.get(k) || 0) + v);
      /* THE key step: aggregate starter demand across ALL recipes
         BEFORE chaining. A per-product sheet cannot do this. */
      for (const [k, v] of ex.starterSeeds)
        seeds.set(k, (seeds.get(k) || 0) + v);
    }

    /* chain each stream once, on the aggregate */
    const waterId = ctx.settings && ctx.settings.water_ingredient_id;
    for (const [sid, seedTotal] of seeds) {
      if (seedTotal <= 0) continue;
      const ch = this.chainStarter(sid, seedTotal, ctx);
      out.levains.push(ch);
      out.warnings.push(...ch.warnings);
      /* the pre-builds consume real flour and water — the owner's sheet
         only splits the FINAL build, so this is more complete than it */
      const fid = ch.starter && ch.starter.flour_ingredient_id;
      for (const s of ch.stages) {
        if (fid) out.ingredients.set(fid, (out.ingredients.get(fid) || 0) + s.flour);
        else out.warnings.push(`${ch.starter.name}: no flour ingredient set`);
        if (waterId) out.ingredients.set(waterId, (out.ingredients.get(waterId) || 0) + s.water);
      }
      if (!waterId && ch.stages.length)
        out.warnings.push('No water ingredient configured in Settings — levain water not counted.');
    }

    /* flatten + cost */
    out.lines = Array.from(out.ingredients, ([id, grams]) => {
      const ing = ctx.ingById.get(id);
      const perKg = ing && ing.price_cents_per_kg != null ? Number(ing.price_cents_per_kg) : null;
      const cost = perKg != null ? perKg * grams / 1000 : null;
      if (cost != null) out.totalCostCents += cost;
      return {
        id, ing, name: ing ? ing.name : '(unknown)',
        grams, costCents: cost,
        isFlour: !!(ing && ing.is_flour),
      };
    }).sort((a, b) => (b.isFlour - a.isFlour) || (b.grams - a.grams));

    return out;
  },

  /* Water temperature — the owner's own formula (Tourte de meule I32:I36):
       Water T = ((Deeg T − Delta T) × 3) − Room T − Flour T            */
  waterTemp(doughT, deltaT, roomT, flourT) {
    if ([doughT, deltaT, roomT, flourT].some(v => v == null || v === '' || isNaN(v))) return null;
    return ((Number(doughT) - Number(deltaT)) * 3) - Number(roomT) - Number(flourT);
  },

  /* dough = baked / (1 − loss/100). Solve for whichever field is missing. */
  weights({ baked, lossPct, dough }) {
    const b = baked == null || baked === '' ? null : Number(baked);
    const l = lossPct == null || lossPct === '' ? null : Number(lossPct);
    const d = dough == null || dough === '' ? null : Number(dough);
    if (b != null && l != null && l < 100) return { baked: b, lossPct: l, dough: b / (1 - l / 100) };
    if (b != null && d != null && d > 0)   return { baked: b, lossPct: (1 - b / d) * 100, dough: d };
    if (d != null && l != null)            return { baked: d * (1 - l / 100), lossPct: l, dough: d };
    return { baked: b, lossPct: l, dough: d };
  },
};
