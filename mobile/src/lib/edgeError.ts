/**
 * supabase-js hides the function's response body on a non-2xx: invoke()
 * resolves { data: null, error } without parsing it, so the engine's German
 * message is only reachable through error.context. Falls back to `fallback`
 * for network errors (no context) and non-JSON bodies.
 */
export async function edgeErrorMessage(error: unknown, fallback: string): Promise<string> {
  try {
    const ctx = (error as { context?: { json(): Promise<{ error?: unknown }> } }).context;
    if (ctx && typeof ctx.json === 'function') {
      const parsed = await ctx.json();
      if (parsed && typeof parsed.error === 'string' && parsed.error) return parsed.error;
    }
  } catch {
    // keep the fallback
  }
  return fallback;
}
