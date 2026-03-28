/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'bg-base': '#0d1117',
        'bg-card': '#161b22',
        'bg-overlay': '#1c2128',
        'text-primary': '#e6edf3',
        'text-muted': '#8b949e',
        'border-subtle': '#30363d',
        'accent-green': '#3fb950',
        'accent-red': '#ff7b72',
        'accent-blue': '#388bfd',
        'accent-yellow': '#d29922',
      },
    },
  },
  plugins: [],
}
