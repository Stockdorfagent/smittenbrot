/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // Colours are CSS variables (RGB triplets in globals.css) so the dark
      // palette can swap them under prefers-color-scheme without touching
      // the components; `/60`-style opacity modifiers keep working.
      colors: {
        'smitten-primary': 'rgb(var(--smitten-primary) / <alpha-value>)',
        'smitten-secondary': 'rgb(var(--smitten-secondary) / <alpha-value>)',
        'smitten-accent': 'rgb(var(--smitten-accent) / <alpha-value>)',
        'smitten-bg': 'rgb(var(--smitten-bg) / <alpha-value>)',
        'smitten-surface': 'rgb(var(--smitten-surface) / <alpha-value>)',
        'smitten-cream': 'rgb(var(--smitten-cream) / <alpha-value>)',
        'smitten-text': 'rgb(var(--smitten-text) / <alpha-value>)',
        'smitten-strip': 'rgb(var(--smitten-strip) / <alpha-value>)',
        'smitten-on-accent': 'rgb(var(--smitten-on-accent) / <alpha-value>)',
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
