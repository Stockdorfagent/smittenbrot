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
        display: ['Inter', 'system-ui', 'sans-serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
