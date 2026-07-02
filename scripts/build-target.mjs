import { spawnSync } from 'node:child_process'

const target = process.env.APP_TARGET === 'binder' || process.env.APP_TARGET === 'all' ? process.env.APP_TARGET : 'note'

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...env },
  })

  if (result.status !== 0) process.exit(result.status ?? 1)
}

if (target !== 'binder') run('npm', ['run', 'build:bible'])

run('npx', ['tsc', '-b'], { APP_TARGET: target })

const viteArgs = ['vite', 'build']
if (target === 'all') viteArgs.push('--outDir', 'dist-all')

run('npx', viteArgs, { APP_TARGET: target })
