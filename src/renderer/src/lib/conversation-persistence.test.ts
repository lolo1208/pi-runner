import { describe, expect, it } from 'vitest'
import type { ConversationState } from '../../../shared/conversations'
import { conversationSaveError, persistentConversationState } from './conversation-persistence'

describe('本地会话保存快照', () => {
  it('排除实时思考和工具占位记录，保留正式历史与旧版消息且不修改展示数据', () => {
    const state: ConversationState = { version: 1, selectedId: 'task', tasks: [{
      id: 'task', title: '测试', preview: '', project: null, draft: '草稿',
      messages: [
        { role: 'user', content: '问题', historyId: 'user-1' },
        { role: 'assistant', content: '', historyId: 'live-thinking:request:123', call: { work: [{ id: 'thinking', kind: 'thinking', content: '思考摘要' }] } },
        { role: 'assistant', content: '', historyId: 'live:request' },
        { role: 'assistant', content: '正式回复', historyId: 'assistant-1', call: { work: [{ id: 'thinking', kind: 'thinking', content: '思考摘要', completed: true }] } },
        { role: 'assistant', content: '旧版回复' }
      ]
    }] }
    const saved = persistentConversationState(state)
    expect(saved.tasks[0].messages?.map(message => message.content)).toEqual(['问题', '正式回复', '旧版回复'])
    expect(saved.tasks[0].messages?.[1].call?.work[0].content).toBe('思考摘要')
    expect(saved.tasks[0].draft).toBe('草稿')
    expect(state.tasks[0].messages).toHaveLength(5)
  })
  it('保留没有消息的会话', () => {
    const state: ConversationState = { version: 1, selectedId: null, tasks: [{ id: 'empty', title: '', preview: '', project: null }] }
    expect(persistentConversationState(state)).toEqual(state)
  })
  it('显示真正的保存错误，未知错误才提示检查磁盘', () => {
    expect(conversationSaveError(new Error('会话消息格式无效'))).toContain('原因：会话消息格式无效')
    expect(conversationSaveError(new Error('EACCES'), true)).toContain('暂时无法退出。原因：EACCES')
    expect(conversationSaveError(undefined)).toContain('请检查磁盘空间和访问权限')
  })
})
