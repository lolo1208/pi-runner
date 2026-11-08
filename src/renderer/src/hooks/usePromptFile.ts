import { useEffect, useRef, useState } from 'react'
import { registerPromptSaver } from '../lib/prompt-save-flush'

/** 草稿、磁盘基线与失败状态分离；失败不会污染后续读取队列。 */
export function usePromptFile(root: string | null, legacy: string, autoSave = false) {
  const [draft, setDraft] = useState(legacy)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const state = useRef({ root, baseline: legacy, draft: legacy, dirty: false, generation: 0, ready: false })
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const enqueue = <T,>(action: () => Promise<T>): Promise<T> => {
    const pending = queue.current.catch(() => {}).then(action)
    queue.current = pending.catch(() => {})
    return pending
  }
  const read = (discard = false): Promise<string> => {
    const current = state.current
    const generation = current.generation
    return enqueue(async () => {
      if (generation !== state.current.generation || current.root !== root) throw new Error('提示词目录已切换，请重试')
      const value = await window.piRunner.syncPromptFile(root, legacy)
      if (generation !== state.current.generation) return value
      if (!discard && current.dirty) {
        if (value !== current.baseline) setError('提示词文件已变化，草稿已保留。请重新加载或确认覆盖。')
      } else {
        current.baseline = value; current.draft = value; current.dirty = false
        setDraft(value); setError('')
      }
      current.ready = true; setReady(true)
      return value
    }).catch(e => {
      if (generation === state.current.generation) setError(e instanceof Error ? e.message : String(e))
      throw e
    })
  }
  const save = (overwrite = false): Promise<string> => {
    const current = state.current
    const generation = current.generation
    return enqueue(async () => {
      if (generation !== state.current.generation || current.root !== root || !current.ready) throw new Error('提示词尚未加载完成，请重新加载后重试')
      // 发送前等待保存期间的新输入也落盘，避免本轮使用半旧草稿。
      do {
        if (!current.dirty) return window.piRunner.syncPromptFile(root, legacy)
        const value = current.draft
        const expected = overwrite ? await window.piRunner.syncPromptFile(root, legacy) : current.baseline
        const saved = await window.piRunner.syncPromptFile(root, '', value, expected)
        if (generation !== state.current.generation) return saved
        current.baseline = saved; current.dirty = current.draft !== saved; setError('')
        overwrite = false
        if (!current.dirty) return saved
      } while (current.dirty)
      return current.baseline
    }).catch(e => {
      if (generation === state.current.generation) setError(e instanceof Error ? e.message : '提示词保存失败')
      throw e
    })
  }
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    if (!autoSave) return
    return registerPromptSaver(async () => {
      if (state.current.dirty) await saveRef.current()
      else await queue.current
    })
  }, [autoSave])
  const change = (value: string): void => {
    state.current.draft = value; state.current.dirty = value !== state.current.baseline
    setDraft(value)
  }
  useEffect(() => {
    state.current = { root, baseline: legacy, draft: legacy, dirty: false, generation: state.current.generation + 1, ready: false }
    setReady(false); setDraft(legacy); setError('')
    void read().catch(() => {})
    const focus = (): void => { void read().catch(() => {}) }
    const visibility = (): void => { if (!document.hidden) focus() }
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      window.removeEventListener('focus', focus)
      document.removeEventListener('visibilitychange', visibility)
      state.current.generation++
    }
  }, [root])
  useEffect(() => {
    if (!autoSave || !ready || !state.current.dirty || error) return
    const timer = window.setTimeout(() => { void save().catch(() => {}) }, 400)
    return () => window.clearTimeout(timer)
  }, [draft, autoSave, ready, error])
  return { draft, change, ready: ready && state.current.root === root, error, read, save, dirty: () => state.current.dirty }
}
