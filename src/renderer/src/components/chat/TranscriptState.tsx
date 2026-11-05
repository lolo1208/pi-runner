import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type Dispatch, type ReactNode, type SetStateAction } from 'react'

/** 只保存已交互消息的轻量状态，不保留离屏消息的组件或 DOM。 */
export class TranscriptState {
  private values = new Map<string, unknown>()
  private listeners = new Map<string, Set<() => void>>()

  read<T>(key: string, initial: T | (() => T)): T {
    if (!this.values.has(key)) this.values.set(key, typeof initial === 'function' ? (initial as () => T)() : initial)
    return this.values.get(key) as T
  }

  write<T>(key: string, initial: T | (() => T), action: SetStateAction<T>): void {
    const previous = this.read(key, initial)
    const next = typeof action === 'function' ? (action as (value: T) => T)(previous) : action
    if (Object.is(previous, next)) return
    this.values.set(key, next)
    this.listeners.get(key)?.forEach(listener => listener())
  }

  subscribe(key: string, listener: () => void): () => void {
    const listeners = this.listeners.get(key) ?? new Set()
    listeners.add(listener)
    this.listeners.set(key, listeners)
    return () => {
      listeners.delete(listener)
      if (!listeners.size) this.listeners.delete(key)
    }
  }

  retain(keys: Set<string>): void {
    for (const key of this.values.keys()) if (!keys.has(key.split('/')[0])) this.values.delete(key)
  }
}

const StateContext = createContext<{ store: TranscriptState; scope: string } | null>(null)
type ShowOverlay = (render: (close: () => void) => ReactNode) => void
const OverlayContext = createContext<ShowOverlay | null>(null)

export function TranscriptProvider({ store, active, children }: { store: TranscriptState; active: boolean; children: ReactNode }): React.JSX.Element {
  const [overlay, setOverlay] = useState<ReactNode>(null)
  // 隐藏不等于释放：清掉弹窗元素及其附件、差异正文和回调闭包。
  useEffect(() => { if (!active) setOverlay(null) }, [active])
  const show = useCallback<ShowOverlay>(render => setOverlay(render(() => setOverlay(null))), [])
  const state = useMemo(() => ({ store, scope: '' }), [store])
  return <StateContext.Provider value={state}><OverlayContext.Provider value={show}>
    {children}
    {active && overlay}
  </OverlayContext.Provider></StateContext.Provider>
}

export function TranscriptScope({ id, children }: { id: string; children: ReactNode }): React.JSX.Element {
  const parent = useContext(StateContext)
  const value = useMemo(() => parent ? { store: parent.store, scope: parent.scope ? `${parent.scope}/${id}` : id } : null, [parent, id])
  return <StateContext.Provider value={value}>{children}</StateContext.Provider>
}

/** 独立使用组件时仍使用本地状态；虚拟列表中按消息标识保存。 */
export function useTranscriptState<T>(name: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const context = useContext(StateContext)
  const [local, setLocal] = useState(initial)
  const key = `${context?.scope}/${name}`
  const subscribe = useCallback((listener: () => void) => context?.store.subscribe(key, listener) ?? (() => {}), [context, key])
  const read = useCallback(() => context ? context.store.read(key, initial) : local, [context, key, initial, local])
  const value = useSyncExternalStore(subscribe, read, read)
  const setValue = useCallback<Dispatch<SetStateAction<T>>>(action => {
    if (context) context.store.write(key, initial, action)
    else setLocal(action)
  }, [context, key, initial])
  return [value, setValue]
}

/** 弹窗挂在会话层，触发它的消息卸载后仍可继续查看。 */
export function useTranscriptOverlay(): { showOverlay: ShowOverlay; overlay: ReactNode } {
  const inherited = useContext(OverlayContext)
  const [overlay, setOverlay] = useState<ReactNode>(null)
  const showOverlay = useCallback<ShowOverlay>(render => {
    if (inherited) inherited(render)
    else setOverlay(render(() => setOverlay(null)))
  }, [inherited])
  return { showOverlay, overlay }
}
