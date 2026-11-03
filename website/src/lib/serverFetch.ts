/**
 * fetch for server-side Supabase clients (API routes, server components).
 *
 * Next.js 14 patches the global fetch and stores GET responses in its Data
 * Cache — on Vercel that cache survives deployments. supabase-js uses that
 * fetch, so the REST reads of our route handlers were cached for a year
 * (`revalidate: 31536000` entries for pr_ingredients, pr_recipes, orders, even
 * auth/v1/user were found on disk on 03.11.2026): the bake-sheet Excel kept
 * showing a recipe version from 18.10. after the owner had saved v2, and
 * `export const dynamic = 'force-dynamic'` on the route did not prevent it.
 * Every server client passes this fetch, which asks for no caching at all.
 */
export const noStoreFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, cache: 'no-store' });
