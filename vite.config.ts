import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Point every built chunk at the third-party notices.
 *
 * Each chunk is a copy of someone else's code. Rollup's `output.banner` does not
 * survive: Vite minifies afterwards and strips it as an ordinary comment, so it
 * landed in 0 of 125 chunks. Prepending in `generateBundle` runs after
 * minification.
 */
const noticesBanner = (): Plugin => ({
  name: 'notices-banner',
  apply: 'build',
  enforce: 'post',
  generateBundle(_options, bundle) {
    const banner =
      '/* AI Flowchart Collaborator canvas. MIT licensed. Bundles third-party ' +
      'software under its own licences: see THIRD_PARTY_NOTICES.md. */\n'
    for (const file of Object.values(bundle)) {
      if (file.type === 'chunk') file.code = banner + file.code
    }
  },
})

export default defineConfig({
  plugins: [react(), noticesBanner()],
  // No `define` block. The process/global shims here previously existed for
  // Excalidraw 0.17's UMD bundle; 0.18 ships real ESM without those references.
  //
  // The old 'process.env.NODE_ENV': '"development"' was actively harmful: it did
  // not fail the build, it silently shipped DEVELOPMENT React into production
  // and fought 0.18's development/production export conditions.
  //
  // If the browser console ever shows "process is not defined", re-add only:
  //   define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development') }
  // Never hardcode a value.
  build: {
    // Stable, unhashed filenames. dist/ is committed so the plugin works from a
    // clone with no install step, and content hashes would make every rebuild
    // add ~8 MB of new blobs to git history instead of overwriting the old ones.
    // Cache-busting is not needed: the MCP server serves these with no-cache.
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
    chunkSizeWarningLimit: 2000,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  optimizeDeps: {
    include: ['@excalidraw/excalidraw'],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
  },
})
