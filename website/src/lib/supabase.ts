import { createBrowserClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);

/**
 * Invoke an edge function and surface ITS error message.
 *
 * `supabase.functions.invoke` resolves `{ data: null, error }` for every
 * non-2xx response WITHOUT parsing the body, so the German message the
 * function put into `{ error: ... }` never reaches the caller — checking
 * `data.error` after a failure is dead code. The body is only reachable
 * through `error.context` (the raw Response of a FunctionsHttpError; network
 * and relay errors have none, so the fallback text is used).
 */
export async function invokeEdgeFunction(
  fn: string,
  body: Record<string, unknown>,
  fallback: string,
): Promise<{ ok: boolean; message: string; data: Record<string, unknown> | null }> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (!error) return { ok: true, message: '', data: (data as Record<string, unknown>) ?? null };
  let message = fallback;
  try {
    const ctx = (error as { context?: Response }).context;
    if (ctx instanceof Response) {
      const parsed = await ctx.clone().json();
      if (parsed && typeof parsed.error === 'string' && parsed.error) message = parsed.error;
    }
  } catch {
    // Body not JSON (or already consumed) — keep the fallback text.
  }
  return { ok: false, message, data: null };
}
