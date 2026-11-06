/** 分段输出普通 JSON 数据；不对会话数组、消息数组或对象执行整块 stringify。 */
export function* conversationJsonChunks(value: unknown): Generator<string> {
  function* tokens(item: unknown): Generator<string> {
    if (Array.isArray(item)) {
      yield '['
      for (let index = 0; index < item.length; index++) {
        if (index) yield ','
        yield* tokens(item[index] ?? null)
      }
      yield ']'
    } else if (item && typeof item === 'object') {
      yield '{'
      let first = true
      for (const key of Object.keys(item)) {
        const field = (item as Record<string, unknown>)[key]
        if (field === undefined) continue
        if (!first) yield ','
        first = false
        yield JSON.stringify(key); yield ':'; yield* tokens(field)
      }
      yield '}'
    } else yield JSON.stringify(item) ?? 'null'
  }
  let pending = ''
  for (const token of tokens(value)) {
    if (pending.length + token.length > 32 * 1024) { if (pending) yield pending; pending = '' }
    if (token.length >= 32 * 1024) yield token
    else pending += token
  }
  if (pending) yield pending
}
