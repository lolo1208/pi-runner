import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { ChangedFile } from '../../../shared/api'
import type { AgentSnapshot } from '../../../shared/models'
import { checkRoundFileStates, PROJECT_FILES_RESTORED, type RoundFileState } from './useRoundFileState'

export interface RoundChangesData {
  status: 'waiting' | 'loading' | 'loaded' | 'error'
  files?: ChangedFile[]
  error?: string
  fileState?: RoundFileState
  beforeFileState?: RoundFileState
}

export const roundChangesKey = (round: AgentSnapshot): string => JSON.stringify([round.project, round.before.hash, round.after.hash])

/** 同一会话只提交一个快照请求，始终从最新的可见范围选择下一项。 */
export function useRoundChanges(rounds: AgentSnapshot[], visible: string[], active: boolean, disabled: boolean, ready: boolean, retainedRounds?: AgentSnapshot[]) {
  const [data, setData] = useState<Record<string, RoundChangesData>>({})
  const cache = useRef(new Map<string, RoundChangesData>())
  const input = useRef({ rounds, visible, active: false, disabled, ready })
  const generation = useRef(0)
  const checkVersion = useRef(0)
  const checked = useRef(new Map<string, { version: number; at: number }>())
  const running = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mounted = useRef(false)
  const pumpRef = useRef<() => Promise<void>>(async () => {})
  const retainedKeys = useRef<Set<string> | null>(null)
  const knownProjects = useRef(new Set<string>())

  const publish = useCallback((key: string, value: RoundChangesData): void => {
    if (retainedKeys.current && !retainedKeys.current.has(key)) return
    cache.current.set(key, value)
    // 缓存保留已访问结果，React 状态仅复制当前挂载范围。
    if (mounted.current && input.current.rounds.some(round => roundChangesKey(round) === key)) setData(previous => ({ ...previous, [key]: value }))
  }, [])
  const schedule = useCallback((delay = 0): void => {
    if (!mounted.current || running.current || !input.current.active || !input.current.ready) return
    if (timer.current !== undefined) clearTimeout(timer.current)
    timer.current = setTimeout(() => { timer.current = undefined; void pumpRef.current() }, delay)
  }, [])
  const pump = async (): Promise<void> => {
    const current = input.current
    if (running.current || !mounted.current || !current.active || !current.ready) return
    const keys = current.rounds.map(roundChangesKey)
    const visibleSet = new Set(current.visible)
    const visibleRounds = current.rounds.filter(round => visibleSet.has(roundChangesKey(round)))
    const lastVisible = keys.reduce((last, key, index) => visibleSet.has(key) ? index : last, -1)
    const firstVisible = keys.findIndex(key => visibleSet.has(key))
    const order = firstVisible < 0 ? [...current.rounds].reverse() : [
      ...visibleRounds,
      ...current.rounds.slice(lastVisible + 1),
      // 可见轮次之间可能夹着暂时未相交的卡片，也属于后续补充范围。
      ...current.rounds.slice(firstVisible, lastVisible + 1).filter(round => !visibleSet.has(roundChangesKey(round))).reverse(),
      ...current.rounds.slice(0, firstVisible).reverse()
    ]
    const waiting = (round: AgentSnapshot): boolean => !cache.current.has(roundChangesKey(round)) || cache.current.get(roundChangesKey(round))!.status === 'waiting'
    const visibleNext = visibleRounds.find(waiting)
    const next = visibleNext ?? order.find(waiting)
    const visibleFinished = !visibleNext
    const checkCandidates = visibleFinished && !current.disabled
      ? (next ? visibleRounds : current.rounds).filter(round => {
        const key = roundChangesKey(round)
        return cache.current.get(key)?.status === 'loaded' && checked.current.get(key)?.version !== checkVersion.current
      }) : []
    const session = generation.current
    const version = checkVersion.current
    const valid = (): boolean => mounted.current && input.current.active && generation.current === session
    running.current = true
    try {
      if (checkCandidates.length) {
        // 可见列表先显示再检查；背景列表补齐后集中检查，避免逐轮扫描项目。
        const project = checkCandidates[0].project
        const batch = checkCandidates.filter(round => round.project === project)
        try {
          const states = await checkRoundFileStates(batch)
          if (valid() && checkVersion.current === version && !input.current.disabled) {
            const eligible = new Set(input.current.rounds.map(roundChangesKey))
            for (const round of batch) {
              const key = roundChangesKey(round)
              if (!eligible.has(key)) continue
              checked.current.set(key, { version, at: Date.now() })
              publish(key, { ...cache.current.get(key)!, beforeFileState: states[round.before.hash], fileState: states[round.after.hash] })
            }
          }
        } catch {
          if (valid() && checkVersion.current === version && !input.current.disabled) {
            const eligible = new Set(input.current.rounds.map(roundChangesKey))
            for (const round of batch) {
              const key = roundChangesKey(round)
              if (!eligible.has(key)) continue
              const previous = cache.current.get(key)
              if (!previous) continue
              checked.current.set(key, { version, at: Date.now() })
              const fallback = (state?: RoundFileState): RoundFileState => state === 'matches' || state === 'different' ? state : 'error'
              publish(key, { ...previous, beforeFileState: fallback(previous.beforeFileState), fileState: fallback(previous.fileState) })
            }
          }
        }
      } else if (next) {
        const key = roundChangesKey(next)
        publish(key, { status: 'loading' })
        try {
          const files = await window.piRunner.getChanges(next.before.hash, next.after.hash, next.project)
          if (valid() && input.current.rounds.some(round => roundChangesKey(round) === key)) publish(key, { status: 'loaded', files })
          else publish(key, { status: 'waiting' })
        } catch (error) {
          if (valid()) publish(key, { status: 'error', error: error instanceof Error ? error.message : '文件改动读取失败，请重试' })
          else publish(key, { status: 'waiting' })
        }
      }
    } finally {
      running.current = false
      if (next || checkCandidates.length) schedule()
    }
  }
  useLayoutEffect(() => { pumpRef.current = pump })
  useLayoutEffect(() => {
    if (!retainedRounds) return
    const keys = new Set(retainedRounds.map(roundChangesKey))
    retainedKeys.current = keys
    knownProjects.current = new Set(retainedRounds.map(round => round.project))
    for (const key of cache.current.keys()) if (!keys.has(key)) { cache.current.delete(key); checked.current.delete(key) }
  }, [retainedRounds])

  useLayoutEffect(() => {
    mounted.current = true
    const invalidate = (event: Event): void => {
      if (knownProjects.current.has((event as CustomEvent<string>).detail)) {
        checkVersion.current++
        schedule(250)
      }
    }
    const focus = (): void => {
      if (!input.current.active) return
      // 外部编辑后切回窗口即可核对，连续焦点通知由调度器合并。
      checkVersion.current++
      schedule(250)
    }
    window.addEventListener(PROJECT_FILES_RESTORED, invalidate)
    window.addEventListener('focus', focus)
    return () => {
      mounted.current = false
      generation.current++
      if (timer.current !== undefined) clearTimeout(timer.current)
      window.removeEventListener(PROJECT_FILES_RESTORED, invalidate)
      window.removeEventListener('focus', focus)
    }
  }, [])

  useLayoutEffect(() => {
    if (input.current.active !== active) generation.current++
    if (disabled && !input.current.disabled) checkVersion.current++
    if (active && !input.current.active) {
      for (const [key, last] of checked.current) if (Date.now() - last.at >= 60000) checked.current.delete(key)
    }
    input.current = { rounds, visible, active, disabled, ready }
    if (!retainedRounds) for (const round of rounds) knownProjects.current.add(round.project)
    setData(previous => {
      const next: Record<string, RoundChangesData> = {}
      for (const round of rounds) {
        const key = roundChangesKey(round)
        const value = cache.current.get(key)
        if (value) next[key] = value
      }
      const keys = Object.keys(next)
      return keys.length === Object.keys(previous).length && keys.every(key => previous[key] === next[key]) ? previous : next
    })
    if (!active && timer.current !== undefined) { clearTimeout(timer.current); timer.current = undefined }
    schedule()
  }, [rounds, visible, active, disabled, ready])

  const retry = useCallback((round: AgentSnapshot): void => {
    const key = roundChangesKey(round)
    if (cache.current.get(key)?.status !== 'error') return
    publish(key, { status: 'waiting' })
    schedule()
  }, [publish, schedule])
  return { data, retry }
}
