import { powerSaveBlocker } from 'electron'

/**
 * 会话运行期间阻止系统休眠。
 * 使用 prevent-app-suspension：保持系统活跃、阻止睡眠/休眠，但允许屏幕自动关闭和自动锁屏。
 */
export class SleepBlocker {
  private blockerId: number | null = null

  /** active 为 true 时开始阻止休眠；为 false 时恢复系统默认电源行为。 */
  setActive(active: boolean): void {
    if (active === this.isActive()) return
    if (active) this.blockerId = powerSaveBlocker.start('prevent-app-suspension')
    else if (this.blockerId !== null) {
      if (powerSaveBlocker.isStarted(this.blockerId)) powerSaveBlocker.stop(this.blockerId)
      this.blockerId = null
    }
  }

  isActive(): boolean {
    return this.blockerId !== null && powerSaveBlocker.isStarted(this.blockerId)
  }

  /** 应用退出或渲染进程异常退出时强制释放。 */
  stop(): void {
    if (this.blockerId !== null) {
      if (powerSaveBlocker.isStarted(this.blockerId)) powerSaveBlocker.stop(this.blockerId)
      this.blockerId = null
    }
  }
}
