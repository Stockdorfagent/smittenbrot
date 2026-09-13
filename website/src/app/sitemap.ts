import type { MetadataRoute } from 'next';

const SITE = 'https://smittenbrot.de';
export const revalidate = 3600; // product list changes rarely; refresh hourly

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const staticPages: MetadataRoute.Sitemap = [
    { url: `${SITE}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE}/products`, lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${SITE}/subscriptions`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${SITE}/how-it-works`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${SITE}/about`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE}/app`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE}/faq`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${SITE}/zahlung-abholung`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${SITE}/contact`, lastModified: now, changeFrequency: 'yearly', priority: 0.4 },
    { url: `${SITE}/en`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${SITE}/impressum`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${SITE}/datenschutz`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${SITE}/agb`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
  ];
  // Active products by slug (public read via the anon key; RLS allows it).
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/products?select=slug,updated_at&active=eq.true&slug=not.is.null`,
      { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! }, next: { revalidate: 3600 } },
    );
    const products: { slug: string; updated_at: string | null }[] = res.ok ? await res.json() : [];
    return [
      ...staticPages,
      ...products.map((p) => ({ url: `${SITE}/products/${p.slug}`, lastModified: p.updated_at ? new Date(p.updated_at) : now, changeFrequency: 'weekly' as const, priority: 0.8 })),
    ];
  } catch {
    return staticPages;
  }
}
