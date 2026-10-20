import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { ConversationState } from '../../../shared/conversations'
import { BufferedSave, FLUSH_DRAFTS_EVENT } from '../lib/buffered-updates'

export function useConversationPersistence(loaded: boolean, tasks: ConversationState['tasks'], selectedId: string | null,
  onError: (message: string) => void): void {
  const ready = useRef(loaded)
  ready.current = loaded
  const errorCallback = useRef(onError)
  errorCallback.current = onError
  const mounted = useRef(true)
  const [save] = useState(() => new BufferedSave<ConversationState>(state => window.piRunner.saveConversations(state), () => {
    if (mounted.current) errorCallback.current('会话未能保存到本地，请检查磁盘空间和访问权限。')
  }))
  useLayoutEffect(() => {
    if (loaded) save.schedule({ version: 1, tasks, selectedId })
  }, [loaded, tasks, selectedId, save])

  useEffect(() => {
    mounted.current = true
    const flush = async (): Promise<void> => {
      if (!ready.current) throw new Error('会话尚未成功读取，请等待加载完成后重试退出。')
      // 同步收集所有会话的最新草稿，再由布局副作用把最新快照交给保存队列。
      flushSync(() => window.dispatchEvent(new Event(FLUSH_DRAFTS_EVENT)))
      try { await save.flush() }
      catch (error) {
        errorCallback.current('会话未能保存到本地，请检查磁盘空间和访问权限后重试退出。')
        throw error
      }
    }
    const unsubscribe = window.piRunner.onFlushConversations?.(flush)
    const onBlur = (): void => { void flush().catch(() => {}) }
    window.addEventListener('blur', onBlur)
    return () => {
      mounted.current = false
      unsubscribe?.()
      window.removeEventListener('blur', onBlur)
      void save.flush().catch(() => {})
    }
  }, [save])
}
