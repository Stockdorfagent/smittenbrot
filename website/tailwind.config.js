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
        display: ['Donau', 'Inter', 'system-ui', 'sans-serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
