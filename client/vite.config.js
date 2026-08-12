import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// Stamped into the bundle so a player can read back which build their device
// is actually running. Hashed assets are cached for a year, so "did my browser
// pick up the deploy?" is otherwise unanswerable without devtools.
const pkg = JSON.parse(readFileSync(path.resolve(dirname, 'package.json'), 'utf8'))
const gitShort = () => {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: dirname, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    // No git on the box, or a tarball deploy — the date still identifies it.
    return 'nogit'
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __BUILD__: JSON.stringify({
      version: pkg.version,
      commit: gitShort(),
      builtAt: new Date().toISOString(),
    }),
  },
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      // The sound bench ships too. Vite builds index.html and nothing else
      // unless told, and without this the page 404s in production — which is
      // no use to anyone who wasn't running the dev server.
      input: {
        main: path.resolve(dirname, 'index.html'),
        sounds: path.resolve(dirname, 'sounds.html'),
      },
    },
  },
})
