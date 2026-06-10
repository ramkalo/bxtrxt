import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// When deploying to GitHub Pages the site lives at /repo-name/.
// Set VITE_BASE env var in your GitHub Actions workflow (or .env) to match.
// For a custom domain (or username.github.io root), leave it as '/'.
const base = process.env.VITE_BASE ?? '/'

export default defineConfig({
  root: '.',
  base,
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
  server: {
    open: true,
  },
  plugins: [
    VitePWA({
      registerType: 'prompt',

      // We register the SW manually from src/main.js (via virtual:pwa-register)
      // so we can show a "reload to update" prompt — disable auto-injection to
      // avoid a duplicate registration.
      injectRegister: false,

      // Files from public/ to include in the service worker precache
      includeAssets: ['favicon.ico', 'bxtrxt-icon.svg', 'apple-touch-icon-180x180.png', '*.png'],

      manifest: {
        name: 'BXTRXT',
        short_name: 'BXTRXT',
        description: 'Retro photo effects editor — grain, VHS, CRT, and more.',
        theme_color: '#0a0a1a',
        background_color: '#0a0a1a',
        display: 'standalone',
        orientation: 'portrait-primary',
        scope: base,
        start_url: base,
        categories: ['photo', 'utilities'],
        icons: [
          {
            src: 'pwa-64x64.png',
            sizes: '64x64',
            type: 'image/png',
          },
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },

      workbox: {
        // Precache all compiled JS/CSS/HTML + fonts. All fonts (including
        // JetBrains Mono) are self-hosted, so there are no runtime network
        // dependencies — the app is fully offline-first.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
      },
    }),
  ],
})
