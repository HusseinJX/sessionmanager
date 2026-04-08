/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/renderer/index.html',
    './src/renderer/src/**/*.{js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        'bg-base': '#0d0d0f',
        'bg-card': '#141416',
        'bg-overlay': '#1a1a1d',
        'sidebar': '#111113',
        'border-subtle': '#2a2a2e',
        'text-primary': '#ececec',
        'text-muted': '#6e6e7a',
        'accent-green': '#3fb950',
        'accent-yellow': '#d29922',
        'accent-red': '#f85149',
        'accent-blue': '#4d8ef0'
      },
      fontFamily: {
        mono: ['Menlo', 'Monaco', 'Courier New', 'monospace']
      }
    }
  },
  plugins: []
}
