import { Resvg } from '@resvg/resvg-js'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// favicon.svg가 아이콘 원본 — 여기서 PNG들을 생성한다. (node scripts/gen-icons.mjs)
const svg = readFileSync(join(root, 'public/favicon.svg'), 'utf8')

const targets = [
  ['public/pwa-192.png', 192],
  ['public/pwa-512.png', 512],
  ['public/apple-touch-icon.png', 180],
]

for (const [out, size] of targets) {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size } })
  const png = resvg.render().asPng()
  writeFileSync(join(root, out), png)
  console.log(`✓ ${out} (${size}px, ${png.length} bytes)`)
}
