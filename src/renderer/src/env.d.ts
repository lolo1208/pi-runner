import type { PiRunnerApi } from '../../shared/api'
declare global {
  const __APP_VERSION__: string
  interface Window { piRunner: PiRunnerApi }
}
