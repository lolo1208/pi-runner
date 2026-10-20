import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChatImage } from '../../../shared/models'
import { BufferedAction, FLUSH_DRAFTS_EVENT } from '../lib/buffered-updates'

/** 输入只更新本地状态，向工作台同步草稿时才触发全局更新。 */
export function useDraftSync(prompt: string, images: ChatImage[], skillIds: string[], active: boolean,
  onChange: ((prompt: string, images: ChatImage[], skillIds: string[]) => void) | undefined) {
  const latest = useRef({ prompt, images, skillIds, onChange })
  latest.current = { prompt, images, skillIds, onChange }
  const [buffer] = useState(() => new BufferedAction(() => {
    const draft = latest.current
    draft.onChange?.(draft.prompt, draft.images, draft.skillIds)
  }, 250, 1000))
  const immediate = useRef(false)
  useLayoutEffect(() => {
    buffer.schedule()
    if (!active || immediate.current) { immediate.current = false; buffer.flush() }
  }, [prompt, images, skillIds, active, buffer])
  useEffect(() => {
    const flush = (): void => buffer.flush()
    window.addEventListener(FLUSH_DRAFTS_EVENT, flush)
    window.addEventListener('blur', flush)
    return () => {
      window.removeEventListener(FLUSH_DRAFTS_EVENT, flush)
      window.removeEventListener('blur', flush)
      buffer.flush()
    }
  }, [buffer])
  return { flush: useCallback(() => buffer.flush(), [buffer]), immediate }
}
