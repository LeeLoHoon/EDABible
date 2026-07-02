import { readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type ResolvedConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// 어떤 빌드가 기기에 떴는지 확인용 — package.json 버전을 주입(예: 1.0.0)
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const base = process.env.VERCEL === '1' ? '/' : '/EDABible/'
const appTarget = process.env.APP_TARGET === 'binder' || process.env.APP_TARGET === 'all' ? process.env.APP_TARGET : 'note'
const appMeta = {
  note: {
    name: '말씀 묵상 노트',
    shortName: '묵상 노트',
    description: '매일 성경 본문을 필사하고 5가지 질문과 기도로 묵상하는 노트',
  },
  binder: {
    name: '에다 SPL 바인더',
    shortName: 'SPL 바인더',
    description: '에다 SPL 바인더 PDF를 넘기며 필기하고 책갈피를 남기는 앱',
  },
  all: {
    name: 'EDABible',
    shortName: 'EDABible',
    description: '말씀 묵상 노트와 에다 SPL 바인더',
  },
}[appTarget]
const targetAppEntry = resolve(process.cwd(), `src/targetApp.${appTarget}.tsx`)

function pruneUnusedPublicAssets() {
  let config: ResolvedConfig

  return {
    name: 'prune-unused-public-assets',
    configResolved(resolvedConfig: ResolvedConfig) {
      config = resolvedConfig
    },
    closeBundle() {
      const outDir = config.build.outDir
      if (appTarget === 'note') rmSync(resolve(outDir, 'binder'), { recursive: true, force: true })
      if (appTarget === 'binder') rmSync(resolve(outDir, 'bible'), { recursive: true, force: true })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base,
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  resolve: {
    alias: {
      'virtual:target-app': targetAppEntry,
    },
  },
  define: {
    __BUILD__: JSON.stringify(pkg.version),
    __APP_TARGET__: JSON.stringify(appTarget),
  },
  plugins: [
    react(),
    tailwindcss(),
    pruneUnusedPublicAssets(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,
      manifest: {
        name: appMeta.name,
        short_name: appMeta.shortName,
        description: appMeta.description,
        lang: 'ko',
        id: appTarget === 'binder' ? '/binder' : '/',
        start_url: '/',
        scope: '/',
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
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        runtimeCaching: [
          ...(appTarget === 'binder'
            ? []
            : [
                {
                  urlPattern: /\/bible\/.*\.json$/,
                  handler: 'NetworkFirst' as const,
                  options: {
                    cacheName: `bible-json-${pkg.version}`,
                    networkTimeoutSeconds: 5,
                    expiration: {
                      maxEntries: 70,
                      maxAgeSeconds: 60 * 60 * 24 * 30,
                    },
                  },
                },
              ]),
        ],
      },
    }),
  ],
})
