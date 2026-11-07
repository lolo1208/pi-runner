import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { ConversationState } from '../../../shared/conversations'
import { conversationPatch } from '../../../shared/conversation-patches'
import { BufferedSave, FLUSH_DRAFTS_EVENT } from '../lib/buffered-updates'
import { conversationDraftChanges, conversationSaveError, deferRunningTranscripts, withoutLegacyMessageUnset } from '../lib/conversation-persistence'

const NO_BUSY_TASKS: readonly string[] = []

export function useConversationPersistence(loaded: boolean, tasks: ConversationState['tasks'], selectedId: string | null,
  onError: (message: string) => void, busyIds: readonly string[] = NO_BUSY_TASKS, initialState?: ConversationState | null): void {
  const ready = useRef(loaded)
  ready.current = loaded
  const errorCallback = useRef(onError)
  errorCallback.current = onError
  const mounted = useRef(true)
  const acknowledged = useRef<ConversationState | null>(null)
  const bufferedState = useRef<ConversationState | null>(null)
  const latestState = useRef<ConversationState>({ version: 1, tasks, selectedId })
  latestState.current = { version: 1, tasks, selectedId }
  const [save] = useState(() => new BufferedSave<ConversationState>(async state => {
    // 缺少增量协议时明确失败，不能悄悄回退为全库跨 IPC 复制。
    if (!window.piRunner.saveConversationPatch) throw new Error('会话增量保存接口不可用，请重启或更新应用。')
    if (!acknowledged.current) acknowledged.current = await window.piRunner.loadConversations()
    // 纯文字草稿与选中态只写轻量覆盖层，不追加增量日志、不重写全库；消息、队列、图片等仍走全量增量。
    const draftChanges = conversationDraftChanges(acknowledged.current, state, true)
    if (draftChanges !== null) {
      if (draftChanges.length || state.selectedId !== acknowledged.current.selectedId) {
        if (!window.piRunner.saveConversationDrafts) throw new Error('会话草稿保存接口不可用，请重启或更新应用。')
        await window.piRunner.saveConversationDrafts(draftChanges, state.selectedId)
      }
      acknowledged.current = state
      return
    }
    const patch = withoutLegacyMessageUnset(acknowledged.current, conversationPatch(acknowledged.current, state))
    // 只过滤变化字段中的流式占位，不遍历所有历史与附件。
    for (const update of patch.updates) if (update.fields.messages) {
      update.fields.messages = update.fields.messages.filter(message => !message.historyId?.startsWith('live-thinking:') && !message.historyId?.startsWith('live:'))
    }
    if (patch.updates.length || patch.order || patch.selectedId !== acknowledged.current.selectedId) await window.piRunner.saveConversationPatch(patch)
    // 仅成功落盘后推进基线；失败重试仍会包含所有尚未保存的改动。
    acknowledged.current = state
  }, error => {
    if (mounted.current) errorCallback.current(conversationSaveError(error))
  }))
  useLayoutEffect(() => {
    if (loaded) {
      // 使用实际读取的基线，启动时也不再把全部会话原样传回主进程。
      acknowledged.current ??= initialState ?? null
      bufferedState.current ??= initialState ?? null
      const state = deferRunningTranscripts(bufferedState.current, { version: 1, tasks, selectedId }, busyIds)
      bufferedState.current = state
      save.schedule(state)
    }
  }, [loaded, tasks, selectedId, busyIds, save, initialState])

  useEffect(() => {
    mounted.current = true
    const flush = async (): Promise<void> => {
      if (!ready.current) throw new Error('会话尚未成功读取，请等待加载完成后重试退出。')
      // 同步收集所有会话的最新草稿，再由布局副作用把最新快照交给保存队列。
      flushSync(() => window.dispatchEvent(new Event(FLUSH_DRAFTS_EVENT)))
      // 退出或失焦时不延后运行态，保存当前完整状态，失败仍保留重试队列。
      bufferedState.current = latestState.current
      save.schedule(latestState.current)
      try { await save.flush() }
      catch (error) {
        errorCallback.current(conversationSaveError(error, true))
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
      if (ready.current) {
        bufferedState.current = latestState.current
        save.schedule(latestState.current)
      }
      void save.flush().catch(() => {})
    }
  }, [save])
}
