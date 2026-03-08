/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['DM Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        // Semantic tokens — map to CSS vars
        page:    'var(--page-bg)',
        sidebar: 'var(--sidebar-bg)',
        card:    'var(--card-bg)',
        card2:   'var(--card-bg-2)',
        input:   'var(--input-bg)',
        border:  'var(--border)',
        'border-soft': 'var(--border-soft)',
        t1:      'var(--text-1)',
        t2:      'var(--text-2)',
        t3:      'var(--text-3)',
        t4:      'var(--text-4)',
        accent:  'var(--blue)',
        'accent-light': 'var(--blue-light)',
        'accent-mid':   'var(--blue-mid)',
        'accent-dark':  'var(--blue-dark)',
        success: 'var(--green)',
        'success-light': 'var(--green-light)',
        danger:  'var(--red)',
        'danger-light': 'var(--red-light)',
        warn:    'var(--amber)',
        'warn-light': 'var(--amber-light)',
      },
      boxShadow: {
        card:    'var(--shadow-card)',
        'card-hov': 'var(--shadow-card-hov)',
        modal:   'var(--shadow-modal)',
      },
      borderRadius: {
        card:  '14px',
        input: '9px',
      },
    },
  },
  plugins: [],
};
