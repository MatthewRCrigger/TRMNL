import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Tauri expects a fixed port and no auto-open.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // src-tauri is watched by cargo, not vite.
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    target: 'safari15',
    minify: 'esbuild',
    sourcemap: false,
  },
})
