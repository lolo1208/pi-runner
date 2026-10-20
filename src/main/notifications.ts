import { BrowserWindow, Notification, screen } from 'electron'
import type { AppNotification, NotificationKind } from '../shared/api'

// macOS 使用系统通知气泡；Windows 使用自定义的桌面右下角气泡窗口。
// 两类气泡都按通知类型区分图标与颜色，避免用户需要打开应用才能判断发生了什么。

const BUBBLE_WIDTH = 380
const BUBBLE_HEIGHT = 108
const BUBBLE_MARGIN = 16
const BUBBLE_GAP = 10
const BUBBLE_DISMISS_MS = 6000
const MAX_BUBBLES = 4

const BUBBLE_WINDOW_STYLE = { frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, show: false, hasShadow: false } as const

const KIND_ICONS: Record<NotificationKind, { color: string; svg: string }> = {
  success: { color: '#2f9e63', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="m8.4 12.5 2.6 2.6 4.8-5.4" /></svg>' },
  failure: { color: '#d64545', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="m9.2 9.2 5.6 5.6" /><path d="m14.8 9.2-5.6 5.6" /></svg>' },
  input: { color: '#c07a14', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="M9.6 9.6a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1.1.9-1.1 1.7" /><circle cx="12" cy="16.6" r=".8" fill="currentColor" stroke="none" /></svg>' }
}

let bubbles: BrowserWindow[] = []

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}

function bubbleHtml(notification: AppNotification): string {
  const { color, svg } = KIND_ICONS[notification.kind]
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:" />
<style>
html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; }
body { box-sizing: border-box; padding: 6px; font-family: "Microsoft YaHei UI", "Segoe UI", system-ui, -apple-system, sans-serif; -webkit-user-select: none; user-select: none; }
.bubble { box-sizing: border-box; display: flex; align-items: flex-start; gap: 12px; height: 100%; padding: 14px 16px; border: 1px solid rgba(15, 23, 42, 0.08); border-radius: 12px; background: rgba(255, 255, 255, 0.98); box-shadow: 0 10px 30px rgba(15, 23, 42, 0.24); }
.icon { flex-shrink: 0; width: 26px; height: 26px; color: ${color}; }
.icon svg { width: 100%; height: 100%; }
.content { flex: 1; min-width: 0; }
.title { margin: 0; color: #1b1b1b; font-size: 13px; font-weight: 600; line-height: 1.4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.body { margin: 4px 0 0; color: #6b7280; font-size: 12px; line-height: 1.5; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
@media (prefers-color-scheme: dark) {
  .bubble { border-color: rgba(255, 255, 255, 0.1); background: rgba(30, 32, 36, 0.98); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55); }
  .title { color: #f3f4f6; }
  .body { color: #9ca3af; }
}
</style></head>
<body><div class="bubble"><span class="icon">${svg}</span><div class="content"><p class="title">${escapeHtml(notification.title)}</p><p class="body">${escapeHtml(notification.body)}</p></div></div></body></html>`
}

function layoutBubbles(): void {
  if (!bubbles.length) return
  const { workArea } = screen.getPrimaryDisplay()
  const right = workArea.x + workArea.width - BUBBLE_MARGIN
  let bottom = workArea.y + workArea.height - BUBBLE_MARGIN
  for (const window of bubbles) {
    const [width, height] = window.getSize()
    window.setPosition(Math.round(right - width), Math.round(bottom - height))
    bottom -= height + BUBBLE_GAP
  }
}

function closeBubble(window: BrowserWindow): void {
  bubbles = bubbles.filter(item => item !== window)
  if (!window.isDestroyed()) window.destroy()
}

function closeAllBubbles(): void {
  const pending = bubbles
  bubbles = []
  for (const window of pending) if (!window.isDestroyed()) window.destroy()
}

/** 关闭全部自定义气泡，应用退出前调用。 */
export function closeAllNotifications(): void {
  closeAllBubbles()
}

function showBubble(notification: AppNotification, activate: () => void): void {
  const window = new BrowserWindow({ ...BUBBLE_WINDOW_STYLE, width: BUBBLE_WIDTH, height: BUBBLE_HEIGHT, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false } })
  window.setAlwaysOnTop(true, 'screen-saver')
  if (process.platform === 'darwin') window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  bubbles.push(window)
  layoutBubbles()
  void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(bubbleHtml(notification))}`)
  window.once('ready-to-show', () => {
    // 按内容实际高度自适应窗口，避免固定高度下方留出大片空白。
    void window.webContents.executeJavaScript('Math.ceil(document.querySelector(".bubble").getBoundingClientRect().height) + 12', true)
      .then(height => {
        if (!window.isDestroyed()) window.setSize(BUBBLE_WIDTH, Math.min(Math.max(Math.round(height), 64), BUBBLE_HEIGHT))
      })
      .catch(() => {})
      .finally(() => { if (!window.isDestroyed()) { window.showInactive(); layoutBubbles() } })
  })
  const timer = setTimeout(() => closeBubble(window), BUBBLE_DISMISS_MS)
  // 点击气泡时窗口获得焦点：关闭气泡并把主窗口带到前台。
  window.on('focus', () => { closeAllBubbles(); activate() })
  window.on('closed', () => { clearTimeout(timer); bubbles = bubbles.filter(item => item !== window); layoutBubbles() })
  if (bubbles.length > MAX_BUBBLES) closeBubble(bubbles[0])
}

function showSystemNotification(notification: AppNotification, activate: () => void): void {
  if (!Notification.isSupported()) return
  const systemNotification = new Notification({ title: notification.title, body: notification.body })
  systemNotification.on('click', activate)
  systemNotification.show()
}

/** 按平台弹出通知：macOS 走系统通知，Windows 走桌面右下角自定义气泡。 */
export function showNotification(notification: AppNotification, activate: () => void): void {
  const safe: AppNotification = {
    kind: notification.kind,
    title: String(notification.title ?? '').slice(0, 120) || 'Pi Runner · 行动派',
    body: String(notification.body ?? '').slice(0, 240)
  }
  if (process.platform === 'win32') showBubble(safe, activate)
  else showSystemNotification(safe, activate)
}
