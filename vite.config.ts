import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [
    react(),
    crx({ manifest }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    rollupOptions: {
      // The Anthropic SDK's Managed Agents worker dynamically imports a
      // Node-only agent-toolset (node:crypto/fs/path). That code path is never
      // reached in the extension; externalize node builtins so the dead chunk
      // doesn't break the browser build.
      external: [/^node:/],
      input: {
        graph: path.resolve(__dirname, 'src/graph/index.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: {
      port: 5173,
    },
  },
})
