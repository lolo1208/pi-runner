import { useEffect, useRef, useState } from 'react'
import type { AgentSnapshot } from '../../../shared/models'

export const PROJECT_FILES_RESTORED = 'pi-runner:project-files-restored'
export type RoundFileState = 'checking' | 'matches' | 'different' | 'error'

/** 调用方控制检查时机，只传入已加载聊天范围内需要检查的快照。 */
export async function checkRoundFileStates(snapshots: AgentSnapshot[]): Promise<Record<string, RoundFileState>> {
  const groups = new Map<string, Set<string>>()
  for (const round of snapshots) {
    const hashes = groups.get(round.project) ?? new Set<string>()
    hashes.add(round.before.hash); hashes.add(round.after.hash)
    groups.set(round.project, hashes)
  }
  const states: Record<string, RoundFileState> = {}
  for (const [project, hashes] of groups) {
    const matches = new Set(await window.piRunner.getMatchingCheckpoints([...hashes], project))
    for (const hash of hashes) states[hash] = matches.has(hash) ? 'matches' : 'different'
  }
  return states
}

/** 同项目的轮次合并检查，避免每张文件卡重复捕获整个项目。 */
export function useRoundFileState(snapshots: AgentSnapshot[], disabled: boolean, active: boolean): Record<string, RoundFileState> {
  const [states, setStates] = useState<Record<string, RoundFileState>>({})
  const lastChecks = useRef(new Map<string, { at: number; targets: string }>())
  const dirty = useRef(true)
  const targets = JSON.stringify(snapshots.map(round => [round.project, round.before.hash, round.after.hash]))
  useEffect(() => {
    const projects = new Set((JSON.parse(targets) as [string, string, string][]).map(([project]) => project))
    // 隐藏的会话也记住同项目已被恢复，重新打开时不沿用过期结果。
    const invalidate = (event: Event): void => {
      if (projects.has((event as CustomEvent<string>).detail)) dirty.current = true
    }
    window.addEventListener(PROJECT_FILES_RESTORED, invalidate)
    return () => window.removeEventListener(PROJECT_FILES_RESTORED, invalidate)
  }, [targets])
  useEffect(() => {
    if (disabled) dirty.current = true
    if (!active || disabled) return
    const groups = new Map<string, string[]>()
    for (const [project, before, after] of JSON.parse(targets) as [string, string, string][]) groups.set(project, [...new Set([...groups.get(project) ?? [], before, after])])
    if (!groups.size) return
    let disposed = false
    let running = false
    let pending = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async (force: boolean): Promise<void> => {
      if (disposed) return
      if (running) { pending ||= force; return }
      const due = [...groups].filter(([project, hashes]) => {
        const last = lastChecks.current.get(project)
        return force || !last || last.targets !== JSON.stringify(hashes) || Date.now() - last.at >= 60000
      })
      if (!due.length) return
      running = true
      let failed = false
      try {
        await Promise.all(due.map(async ([project, hashes]) => {
          try {
            const matches = new Set(await window.piRunner.getMatchingCheckpoints(hashes, project))
            if (!disposed) {
              lastChecks.current.set(project, { at: Date.now(), targets: JSON.stringify(hashes) })
              setStates(previous => ({ ...previous, ...Object.fromEntries(hashes.map(hash => [hash, matches.has(hash) ? 'matches' : 'different'])) }))
            }
          } catch {
            failed = true
            // 已有结果时复查失败不打断显示；首次检查失败才提供重试入口。
            if (!disposed) setStates(previous => ({ ...previous, ...Object.fromEntries(hashes.map(hash => [hash, previous[hash] === 'matches' || previous[hash] === 'different' ? previous[hash] : 'error'])) }))
          }
        }))
      } finally {
        running = false
        if (!disposed && !failed) dirty.current = false
        if (pending && !disposed) { pending = false; schedule(true) }
      }
    }
    // 合并连续切窗、恢复通知与状态切换，后台复查不清空已知结果。
    const schedule = (force: boolean): void => {
      dirty.current ||= force
      if (running) { pending ||= force; return }
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => { timer = undefined; void refresh(dirty.current) }, 250)
    }
    const onFocus = (): void => { schedule(true) }
    const onRestore = (event: Event): void => {
      if (groups.has((event as CustomEvent<string>).detail)) schedule(true)
    }
    schedule(false)
    window.addEventListener('focus', onFocus)
    window.addEventListener(PROJECT_FILES_RESTORED, onRestore)
    return () => {
      disposed = true
      if (timer !== undefined) clearTimeout(timer)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener(PROJECT_FILES_RESTORED, onRestore)
    }
  }, [targets, disabled, active])
  return states
}
