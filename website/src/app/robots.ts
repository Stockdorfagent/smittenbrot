import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // account, checkout and admin areas carry nothing for search engines
        disallow: ['/admin', '/api/', '/cart', '/checkout', '/login', '/profile', '/orders', '/subscriptions/create', '/subscriptions/edit', '/auth/', '/abmelden'],
      },
    ],
    sitemap: 'https://smittenbrot.de/sitemap.xml',
  };
}
