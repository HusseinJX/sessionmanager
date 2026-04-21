import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // esbuild's minifier miscompiles xterm.js's requestMode (drops `let r`
  // while keeping `r ||= {}`, throwing ReferenceError under strict mode
  // when any TUI sends DECRQM). terser handles the logical-assignment
  // operator correctly.
  build: {
    minify: 'terser',
  },
  server: {
    port: 5175,
    strictPort: true,
  },
})
