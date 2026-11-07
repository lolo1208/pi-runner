import { describe, expect, it } from 'vitest'
import type { ConversationState } from '../../../shared/conversations'
import type { ConversationPatch } from '../../../shared/conversation-patches'
import { conversationDraftChanges, conversationSaveError, evictRestoredMessages, persistentConversationState, withoutLegacyMessageUnset } from './conversation-persistence'

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

  it('淘汰已恢复的闲置会话消息，保留运行中、未恢复与仍需要展示的会话', () => {
    const tasks: ConversationState['tasks'] = [
      { id: 'current', title: 'a', preview: '', project: null, messages: [{ role: 'user', content: 'hi', historyId: 'h1' }] },
      { id: 'restored-idle', title: 'b', preview: '预览', project: null, messages: [{ role: 'assistant', content: '大段正文', historyId: 'h2' }] },
      { id: 'legacy', title: 'c', preview: '', project: null, messages: [{ role: 'user', content: '旧版' }] },
      { id: 'empty', title: 'd', preview: '', project: null }
    ]
    const next = evictRestoredMessages(tasks, new Set(['current']), new Set(['current', 'restored-idle']))
    expect(next.find(task => task.id === 'current')!.messages).toHaveLength(1)
    expect(next.find(task => task.id === 'restored-idle')!.messages).toBeUndefined()
    expect(next.find(task => task.id === 'restored-idle')!.title).toBe('b')
    expect(next.find(task => task.id === 'legacy')!.messages).toHaveLength(1)
    expect(next.find(task => task.id === 'empty')!.messages).toBeUndefined()
    // 无可淘汰内容时返回同一引用，避免无谓重渲染。
    expect(evictRestoredMessages(next, new Set(['current']), new Set(['current', 'restored-idle']))).toBe(next)
  })

  it('旧版会话消息不会被增量置空，原生历史副本允许清除', () => {
    const previous: ConversationState = { version: 1, selectedId: null, tasks: [
      { id: 'native', title: 'a', preview: '', project: null, messages: [{ role: 'user', content: 'hi', historyId: 'h1' }] },
      { id: 'legacy', title: 'b', preview: '', project: null, messages: [{ role: 'user', content: '旧版' }] }
    ] }
    const patch: ConversationPatch = { updates: [
      { id: 'native', fields: {}, unset: ['messages'] },
      { id: 'legacy', fields: {}, unset: ['messages'] }
    ], selectedId: null }
    const next = withoutLegacyMessageUnset(previous, patch)
    // 原生历史副本可清除，旧版消息保留。
    expect(next.updates.find(update => update.id === 'native')!.unset).toContain('messages')
    expect(next.updates.find(update => update.id === 'legacy')!.unset).not.toContain('messages')
    // 不修改传入对象。
    expect(patch.updates.find(update => update.id === 'legacy')!.unset).toContain('messages')
    // 无变化时保持原引用。
    const nativeOnly: ConversationPatch = { updates: [{ id: 'native', fields: {}, unset: ['messages'] }], selectedId: null }
    expect(withoutLegacyMessageUnset(previous, nativeOnly)).toBe(nativeOnly)
  })

  it('仅草稿或选中态变化时返回草稿增量，其它字段变化返回 null', () => {
    const previous: ConversationState = { version: 1, selectedId: 't1', tasks: [
      { id: 't1', title: '一', preview: '', project: null, draft: '旧草稿', draftSkillIds: ['s1'], messages: [{ role: 'user', content: 'hi', historyId: 'h1' }] },
      { id: 't2', title: '二', preview: '', project: null, draft: '二草稿' }
    ] }
    const next = { version: 1 as const, selectedId: 't2', tasks: [
      { ...previous.tasks[0], draft: '新草稿' },
      { ...previous.tasks[1], draftSkillIds: ['s2'] }
    ] }
    expect(conversationDraftChanges(previous, next, true)).toEqual([
      { id: 't1', draft: '新草稿', draftSkillIds: ['s1'] },
      { id: 't2', draft: '二草稿', draftSkillIds: ['s2'] }
    ])
    // 消息变化 → null
    const withMessages: ConversationState = { version: 1, selectedId: 't1', tasks: [{ ...previous.tasks[0], messages: [{ role: 'user', content: 'x', historyId: 'h2' }] }] }
    expect(conversationDraftChanges(previous, withMessages, true)).toBeNull()
    // 草稿图片变化 → null（图片走全量增量）
    const withImages: ConversationState = { version: 1, selectedId: 't1', tasks: [{ ...previous.tasks[0], draftImages: [{ id: 'img', name: 'img.png', dataUrl: 'data:image/png;base64,AA==' }] }] }
    expect(conversationDraftChanges(previous, withImages, true)).toBeNull()
    // 会话顺序变化 → null
    const reordered: ConversationState = { version: 1, selectedId: 't1', tasks: [previous.tasks[1], previous.tasks[0]] }
    expect(conversationDraftChanges(previous, reordered, true)).toBeNull()
  })
})
