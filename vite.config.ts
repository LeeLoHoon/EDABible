import { readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin, type ResolvedConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// 어떤 빌드가 기기에 떴는지 확인용 — package.json 버전을 주입(예: 1.0.0)
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const base = process.env.VERCEL === '1' ? '/' : '/EDABible/'
const requestedTarget = process.env.APP_TARGET
const appTarget =
  requestedTarget === 'binder' || requestedTarget === 'all' || requestedTarget === 'sermon'
    ? requestedTarget
    : 'note'
// 1.5.74 이하의 autoUpdate 클라이언트는 waiting SW에 SKIP_WAITING을 보내지 못한다.
// prompt 방식으로 넘어가는 첫 빌드만 즉시 활성화하고, 이후 버전부터 안내를 기다린다.
const promptUpdateMigrationBuild = '1.5.75'
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
    description: '말씀 묵상 노트·주간 말씀 묵상·에다 SPL 바인더',
  },
  sermon: {
    name: '주간 말씀 묵상',
    shortName: '말씀 묵상',
    description: '주일 설교 본문과 묵상 포인트를 한 주 동안 묵상하는 앱',
  },
}[appTarget]
const targetAppEntry = resolve(process.cwd(), `src/targetApp.${appTarget}.tsx`)

function emitVersionFile(): Plugin {
  return {
    name: 'emit-version-file',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify({ version: pkg.version, target: appTarget }, null, 2)}\n`,
      })
    },
  }
}

function pruneUnusedPublicAssets() {
  let config: ResolvedConfig

  return {
    name: 'prune-unused-public-assets',
    configResolved(resolvedConfig: ResolvedConfig) {
      config = resolvedConfig
    },
    closeBundle() {
      const outDir = config.build.outDir
      // 주간 말씀 묵상은 성경 본문을 쓰지만 바인더 PDF(100MB+)는 필요 없다
      if (appTarget === 'note' || appTarget === 'sermon') {
        rmSync(resolve(outDir, 'binder'), { recursive: true, force: true })
      }
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
    emitVersionFile(),
    pruneUnusedPublicAssets(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      manifest: {
        name: appMeta.name,
        short_name: appMeta.shortName,
        description: appMeta.description,
        lang: 'ko',
        // base 기준으로 계산해야 GitHub Pages(/EDABible/) 설치 앱이 404 루트를
        // 열지 않는다. Vercel(base '/')에서는 기존 값과 동일하게 유지된다.
        id: appTarget === 'binder' || appTarget === 'sermon' ? `${base}${appTarget}` : base,
        start_url: base,
        scope: base,
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
        skipWaiting: pkg.version === promptUpdateMigrationBuild,
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
                      maxEntries: 140,
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
