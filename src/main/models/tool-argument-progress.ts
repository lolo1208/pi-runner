interface ToolArgumentSnapshot {
  type: string
  arguments?: unknown
}

/** 各工具独立计数：优先使用原始增量，兼容仅返回参数快照的供应商。 */
export class ToolArgumentProgress {
  private readonly deltas = new Map<number, number>()

  clear(): void { this.deltas.clear() }

  update(index: number, phase: 'toolcall_start' | 'toolcall_delta' | 'toolcall_end', delta: string | undefined, snapshot: ToolArgumentSnapshot | undefined): number | undefined {
    if (phase === 'toolcall_start') this.deltas.delete(index)
    if (phase === 'toolcall_delta' && delta) {
      this.deltas.set(index, (this.deltas.get(index) ?? 0) + Buffer.byteLength(delta, 'utf8'))
    }
    const streamed = this.deltas.get(index)
    if (streamed && streamed > 0 && phase !== 'toolcall_end') return streamed
    // 有些兼容服务不发送 delta，仅在 partial 或结束事件中提供解析后的参数。
    // 不累计快照，避免重复计数；空对象通常是 SDK 的初始占位，不视为已收到数据。
    if (snapshot?.type !== 'toolCall' || snapshot.arguments == null) return streamed
    const args = snapshot.arguments
    if (typeof args === 'object' && Object.keys(args).length === 0) return streamed
    if (args === '') return streamed
    const serialized = JSON.stringify(args)
    // 结束时补齐只发送了部分增量的接口；不让序列化差异导致显示值回退。
    const bytes = Math.max(streamed ?? 0, serialized ? Buffer.byteLength(serialized, 'utf8') : 0)
    return bytes > 0 ? bytes : undefined
  }
}
