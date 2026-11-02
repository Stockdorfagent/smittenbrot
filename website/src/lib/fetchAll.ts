/**
 * PostgREST silently caps a response at the project's max_rows (Supabase default
 * 1000) — no error, just fewer rows. The admin dashboard, the customers page and
 * "Vergangene anzeigen" read whole tables, so once the shop passes 1000 orders
 * their sums would quietly be wrong (code review 02.11.2026, finding 16).
 * Pages through the query in fixed chunks instead. The builder must carry a
 * deterministic order (add `.order(...)` before calling).
 */
type Pageable<T> = {
  range(from: number, to: number): PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
};

export async function fetchAll<T>(build: () => Pageable<T>, pageSize = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}
