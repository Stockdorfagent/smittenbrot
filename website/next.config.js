/** @type {import('next').NextConfig} */
const nextConfig = {
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
      { source: '/shop/:path*', destination: '/products', permanent: true },
      { source: '/baking-schedule', destination: '/how-it-works', permanent: true },
      { source: '/baking-schedule/:path*', destination: '/how-it-works', permanent: true },
    ];
  },
};

module.exports = nextConfig;
