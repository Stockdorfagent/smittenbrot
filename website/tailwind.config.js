/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'smitten-primary': '#f8120e',
        'smitten-secondary': '#6B7280',
        'smitten-accent': '#1A1A1A',
        'smitten-bg': '#FFFFFF',
        'smitten-cream': '#F3F4F6',
        'smitten-text': '#1A1A1A',
      },
      fontFamily: {
        // "Donau" (the logo font) is not shipped as a webfont; it rendered
        // inconsistently — clean/straight (Inter) for visitors without it,
        // rounder for machines that have it installed. Use Inter everywhere;
        // the wordmark is the logo image.
        // var(--font-inter) is the actual next/font-loaded Inter (see layout.tsx).
        // Referencing it guarantees font-display/font-body match the body font
        // everywhere — the literal 'Inter' fallback would otherwise resolve to a
        // locally-installed font (e.g. Donau) and render inconsistently.
        display: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        body: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
