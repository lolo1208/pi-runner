// 视图状态独立于会话内容保存，切换后无需等待会话的延迟落盘。
export function readWorkspaceViewState<T>(key: string, fallback: T, validate: (value: unknown) => value is T): T {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(`pi-runner.${key}`) ?? 'null')
    return validate(value) ? value : fallback
  } catch { return fallback }
}

export function writeWorkspaceViewState(key: string, value: unknown): void {
  try { localStorage.setItem(`pi-runner.${key}`, JSON.stringify(value)) }
  catch { /* 本地存储不可用时仍保留当前窗口的视图状态。 */ }
}

export function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}
