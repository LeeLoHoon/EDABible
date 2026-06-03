import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  base: '/EDABible/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,
      manifest: {
        name: 'EDABible — 성경 묵상·필사',
        short_name: 'EDABible',
        description: '매일 성경 본문을 필사하고 5가지 질문과 기도로 묵상하는 노트',
        lang: 'ko',
        id: '/EDABible/',
        start_url: '/EDABible/',
        scope: '/EDABible/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#f6f1e9',
        theme_color: '#f6f1e9',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/leelohoon\.github\.io\/EDABible\/bible\/.*\.json$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'bible-json',
              expiration: {
                maxEntries: 70,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
        ],
      },
    }),
  ],
})
