import { spawnSync } from 'node:child_process'

const requested = process.env.APP_TARGET
const target = requested === 'binder' || requested === 'all' || requested === 'sermon' ? requested : 'note'

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

// Vercel git 배포는 저장소 vercel.json의 outputDirectory("dist")가 프로젝트
// 설정보다 우선한다. 어떤 APP_TARGET이든 기본 dist로 내보내야 배포가 성공한다.
// 분리 산출물(dist-sermon/dist-all)이 필요하면 npm run build:sermon / build:all을 사용한다.
const viteArgs = ['vite', 'build']

run('npx', viteArgs, { APP_TARGET: target })
