# Smittenbrot Backstube

Internal production-planning tool for the baker. **Not** part of the customer app or
the public website. Local only — no deploy, no build step, no app store.

Design document: `../../BACKSTUBE-PLAN.md`

## Run it

```bash
bash ~/Smittenbrot-App/smittenbrot-website/backstube/start.sh
```

Opens <http://localhost:8420> and asks for a 6-digit code (same login as the shop
admin). The session persists, so normally it is just there.

Stop it with Ctrl-C.

## What is where

```
index.html              shell + login
css/app.css             CI: #f8120e / #1A1A1A / #6B7280 / #FFFFFF / #F3F4F6, Inter
js/config.js            project URL + anon key  (NEVER the service_role key)
js/lib.js               auth (GoTrue), REST (PostgREST), formatting, DOM helpers
js/engine.js            THE demand engine — blocks, overages, levain back-chain
js/app.js               router, nav, shared data cache
js/screens/*.js         Bake day · Recipes · Levains · Ingredients
migrations/*.sql        schema, applied to Supabase project aoryok
```

## Security

- All 22 `bs_` tables are RLS-locked to `is_admin()`. Only the anon key ships here;
  it is public by design and already inside the public website's JS bundle.
- The server binds to `127.0.0.1`, so nothing on the network can reach it.
- Do not move this folder inside `smittenbrot-website/website/` — Vercel would publish it.

## Units

Grams and millilitres internally, everywhere. kg is display only. Money is integer
net cents. Dates are shown dd.mm.yyyy.

## The engine in one page

```
dough        = Σ_outputs (units × Teigeinlage) + loss_g
factor       = dough ÷ (Σ percent of the final block)
item grams   = factor × percent                    ← percent of THAT BLOCK's base
nested block = referenced grams × (1 + overage_pct/100), recursed
levain       = same, but computed on (units + levain_safety_units)
starter seed = aggregated ACROSS RECIPES, then chained backwards to Anstellgut
```

Validated against `Tourte de meule`: reproduces the sheet's Factor of 7.4114 and the
`SL door 4 delen` seed divisor exactly. See the notes in `BACKSTUBE-PLAN.md` §3.
