/** @type {import('next').NextConfig} */
const nextConfig = {
  // The production-plan route reads templates/production-plan.xlsx at runtime;
  // Vercel only ships files the bundler can trace, so include them explicitly.
  experimental: {
    outputFileTracingIncludes: { '/api/admin/production-plan': ['./templates/**'] },
  },
  images: {
    domains: ['your-storage.supabase.co'],
  },
  // Old Squarespace URLs (from its sitemap, 09.09.2026). Printed flyers, Google
  // results and bookmarks still point at these paths; without redirects every
  // one of them would 404 after the domain cutover.
  async redirects() {
    return [
      { source: '/home', destination: '/', permanent: true },
      { source: '/so-funktioniert-es', destination: '/how-it-works', permanent: true },
      { source: '/shop', destination: '/products', permanent: true },
      // old Squarespace product pages → new slugs (specific ones first)
      { source: '/shop/p/stockdorf-sourdough', destination: '/products/stockdorf-sourdough', permanent: true },
      { source: '/shop/p/rye-wheat-sourdough', destination: '/products/rye-wheat-sourdough', permanent: true },
      { source: '/shop/p/la-brioche', destination: '/products/brioche', permanent: true },
      { source: '/shop/p/baguette', destination: '/products/baguette', permanent: true },
      { source: '/shop/p/focaccia', destination: '/products/focaccia-naturale', permanent: true },
      { source: '/shop/p/ciabatta', destination: '/products/ciabatta-naturale', permanent: true },
      { source: '/shop/:path*', destination: '/products', permanent: true },
      { source: '/baking-schedule', destination: '/how-it-works', permanent: true },
      { source: '/baking-schedule/:path*', destination: '/how-it-works', permanent: true },
    ];
  },
};

module.exports = nextConfig;
