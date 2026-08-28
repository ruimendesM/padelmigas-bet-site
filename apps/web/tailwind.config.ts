import type { Config } from 'tailwindcss';

/**
 * Mobile-first by default: no `sm:`-and-up assumption anywhere in the base styles. The palette is
 * chosen so text on `surface`/`surface-muted` clears 4.5:1 (SC-011).
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#0b1220',
        surface: '#111a2e',
        'surface-muted': '#1b2540',
        border: '#2a3757',
        ink: '#f4f7ff',
        'ink-muted': '#a9b6d4',
        accent: '#4ade80',
        'accent-ink': '#052e14',
        warn: '#fbbf24',
        danger: '#f87171',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      maxWidth: {
        content: '46rem',
      },
    },
  },
  plugins: [],
};

export default config;
