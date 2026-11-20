import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'ParkHop',
        short_name: 'ParkHop',
        description: "Drive to a free park 'n' ride, ride the rest. Compare cost, time and reliability.",
        theme_color: '#0f5e55',
        background_color: '#f4f2ec',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Live data must stay live: only the app shell and map style/tiles are cached.
        globPatterns: ['**/*.{js,css,html,svg,png,json}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/tiles\.openfreemap\.org\//,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'map-tiles', expiration: { maxEntries: 800, maxAgeSeconds: 7 * 24 * 3600 } },
          },
        ],
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
})
