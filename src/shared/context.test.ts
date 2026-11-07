import { describe, expect, it } from 'vitest'
import { estimateTextTokens } from './context'

describe('estimateTextTokens', () => {
  it('ASCII 字符按 0.25 计，非 ASCII 按 1 计，并向上取整', () => {
    expect(estimateTextTokens('')).toBe(0)
    expect(estimateTextTokens('a')).toBe(1)
    expect(estimateTextTokens('abcd')).toBe(1) // 4 * 0.25 = 1
    expect(estimateTextTokens('中文')).toBe(2)
    expect(estimateTextTokens('a中')).toBe(2) // 0.25 + 1 = 1.25 -> 2
    expect(estimateTextTokens('ab中文cd')).toBe(3) // 4 * 0.25 + 2 = 3
  })
  it('混合字符与旧实现结果一致', () => {
    const samples = ['', 'hello', '你好世界', '混合 mixed 文本', '\u007f', '\u0080', 'é', '😀']
    for (const text of samples) {
      // 参考实现：逐字符正则
      let expected = 0
      for (const character of text) expected += /[^\x00-\x7F]/.test(character) ? 1 : .25
      expect(estimateTextTokens(text)).toBe(Math.ceil(expected))
    }
  })
})
