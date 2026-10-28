import { describe, expect, it } from 'vitest'
import { requestThinkingSummary, thinkingText } from './pi-thinking'

describe('供应商思考文本', () => {
  it('优先使用已解析文本，避免重复展示结构化明文', () => {
    expect(thinkingText({ thinking: '已有文本', thinkingSignature: JSON.stringify([{ type: 'reasoning.text', text: '已有文本' }]) })).toBe('已有文本')
  })
  it('读取 OpenRouter 明文和摘要，不展示加密推理', () => {
    expect(thinkingText({ thinking: '', thinkingSignature: JSON.stringify([
      { type: 'reasoning.text', text: '分析问题' },
      { type: 'reasoning.encrypted', data: '不可展示的数据' },
      { type: 'reasoning.summary', summary: '检查实现' }
    ]) })).toBe('分析问题\n\n检查实现')
  })
  it('兼容 Responses 摘要与明文回退', () => {
    expect(thinkingText({ thinking: '', thinkingSignature: JSON.stringify({ type: 'reasoning', summary: [{ type: 'summary_text', text: '思考摘要' }] }) })).toBe('思考摘要')
    expect(thinkingText({ thinking: '', thinkingSignature: JSON.stringify({ type: 'reasoning', content: [{ type: 'reasoning_text', text: '推理文本' }] }) })).toBe('推理文本')
  })
  it('忽略普通签名、非法 JSON 和仅加密的内容', () => {
    for (const signature of ['reasoning_content', '{', JSON.stringify({ type: 'reasoning', encrypted_content: '密文' })]) {
      expect(thinkingText({ thinking: '', thinkingSignature: signature })).toBe('')
    }
  })
  it('请求详细摘要，保留推理强度且不启用已关闭的推理', () => {
    expect(requestThinkingSummary({ reasoning: { effort: 'high' }, model: 'test' })).toEqual({ reasoning: { effort: 'high', summary: 'detailed' }, model: 'test' })
    expect(requestThinkingSummary({ reasoning: { effort: 'none' } })).toEqual({ reasoning: { effort: 'none' } })
    expect(requestThinkingSummary({ model: 'test' })).toEqual({ model: 'test' })
  })
})
