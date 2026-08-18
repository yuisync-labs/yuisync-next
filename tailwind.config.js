/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg:      'var(--bg)',
        surface: 'var(--surface)',
        card:    'var(--card)',
        border:  'var(--border)',
        text:    'var(--text)',
        muted:   'var(--muted)',
        danger:  'var(--danger)',
        success: 'var(--success)',
        warn:    'var(--warn)',
      },
      fontFamily: {
        display: ['Outfit', 'sans-serif'],
        body:    ['Nunito', 'sans-serif'],
      },
      borderRadius: { xl2: '1.25rem', xl3: '1.5rem' },
      boxShadow: {
        'amber': '0 0 24px rgba(245,158,11,.25)',
        'card':  '0 4px 24px rgba(0,0,0,.45)',
        'glow':  '0 0 16px rgba(245,158,11,.35)',
      },
      opacity: {
        '2':  '0.02',
        '8':  '0.08',
        '12': '0.12',
        '15': '0.15',
      },
      animation: {
        'fade-up':   'fadeUp .35s ease both',
        'slide-in':  'slideIn .25s ease both',
        'pulse-dot': 'pulseDot 2s infinite',
      },
      keyframes: {
        fadeUp:   { from: { opacity: 0, transform: 'translateY(16px)' }, to: { opacity: 1, transform: 'none' } },
        slideIn:  { from: { opacity: 0, transform: 'translateX(16px)' }, to: { opacity: 1, transform: 'none' } },
        pulseDot: { '0%,100%': { opacity: 1 }, '50%': { opacity: .4 } },
      },
    },
  },
  plugins: [],
}
