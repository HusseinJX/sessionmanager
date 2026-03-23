/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/renderer/index.html',
    './src/renderer/src/**/*.{js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        'bg-base': '#0d1117',
        'bg-card': '#161b22',
        'bg-overlay': '#1c2128',
        'border-subtle': '#30363d',
        'text-primary': '#e6edf3',
        'text-muted': '#8b949e',
        'accent-green': '#3fb950',
        'accent-yellow': '#d29922',
        'accent-red': '#f85149',
        'accent-blue': '#388bfd'
      },
      fontFamily: {
        mono: ['Menlo', 'Monaco', 'Courier New', 'monospace']
      }
    }
  },
  plugins: []
}
