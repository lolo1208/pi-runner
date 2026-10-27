export type InterfaceFont = 'inter' | 'system' | 'segoe' | 'yahei'
import { MAX_CUSTOM_PROMPT_LENGTH } from '../../shared/models'
import { normalizeCompressionThreshold } from '../../shared/context'
export type ThemePreference = 'light' | 'dark' | 'system'
export interface Preferences { theme: ThemePreference; inlineDiff: boolean; sendWithCtrlEnter: boolean; systemNotifications: boolean; preventSleep: boolean; font: InterfaceFont; fontSize: number; customPrompt: string; compressionThreshold: number }
export const defaultPreferences: Preferences = { theme: 'light', inlineDiff: false, sendWithCtrlEnter: true, systemNotifications: true, preventSleep: true, font: 'inter', fontSize: 14, customPrompt: '', compressionThreshold: 80 }
export function readPreferences(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem('pi-runner.preferences') ?? '{}')
    const fontSize = Number(value?.fontSize)
    return {
      theme: ['light', 'dark', 'system'].includes(value?.theme) ? value.theme : 'light',
      inlineDiff: value?.inlineDiff === true,
      // Preferences saved before the shortcut existed should receive the new enabled default once.
      sendWithCtrlEnter: value?.sendWithCtrlEnterVersion === 1 ? value?.sendWithCtrlEnter !== false : true,
      systemNotifications: value?.systemNotifications !== false,
      preventSleep: value?.preventSleep !== false,
      font: ['inter', 'system', 'segoe', 'yahei'].includes(value?.font) ? value.font : 'inter',
      fontSize: Number.isFinite(fontSize) ? Math.max(12, Math.min(20, fontSize)) : 14,
      compressionThreshold: normalizeCompressionThreshold(value?.compressionThreshold),
      customPrompt: typeof value?.customPrompt === 'string' ? value.customPrompt.slice(0, MAX_CUSTOM_PROMPT_LENGTH) : ''
    }
  } catch { return defaultPreferences }
}
