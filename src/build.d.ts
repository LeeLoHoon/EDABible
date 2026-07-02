/** vite.config.ts의 define으로 주입되는 빌드 식별자(git 短해시) */
declare const __BUILD__: string

/** 배포 타깃: 묵상 노트(note), SPL 바인더(binder), 통합(all) */
declare const __APP_TARGET__: 'note' | 'binder' | 'all'

declare module 'virtual:target-app' {
  const App: React.ComponentType
  export default App
}
