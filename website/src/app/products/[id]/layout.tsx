import type { Metadata } from 'next';

/**
 * Per-product title/description for search engines and link previews. The
 * page itself is a client component, so the metadata is produced here in the
 * (server) layout from the same public product data the page shows.
 */
export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const isUuid = /^[0-9a-f-]{36}$/i.test(params.id);
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/products?select=name,slug,description,cover_image_url&${isUuid ? 'id' : 'slug'}=eq.${encodeURIComponent(params.id)}&limit=1`,
      { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! }, next: { revalidate: 3600 } },
    );
    const [p] = res.ok ? await res.json() : [];
    if (!p) return { title: 'Produkt' };
    const prose = (p.description ?? '').split('\n\n')[0].trim();
    const desc = prose.length > 160 ? prose.slice(0, 157).trimEnd() + '…' : prose;
    return {
      title: { absolute: `${p.name} | Smittenbrot` },
      description: desc || `${p.name} von Smittenbrot, Sauerteigbäckerei in Stockdorf.`,
      alternates: { canonical: `/products/${p.slug ?? params.id}` },
      openGraph: { title: `${p.name} | Smittenbrot`, description: desc, images: p.cover_image_url ? [{ url: p.cover_image_url }] : undefined },
    };
  } catch {
    return { title: 'Produkt' };
  }
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
