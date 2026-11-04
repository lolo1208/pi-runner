import { randomUUID } from 'node:crypto'
import type { ImageContent } from '@earendil-works/pi-ai'
import type { SessionManager } from '@earendil-works/pi-coding-agent'
import type { ChatMessage, ModelProfile } from '../../shared/models'
import { attachmentKind, attachmentText } from '../../shared/attachments'
import { googleAttachment } from './google-attachments'
import { modelMessages } from './model-attachments'

const markerPattern = /\[pi-runner-files:([\w-]+)\]/
/** 不把历史消息的技能选择误称为当前轮次；各供应商共用同一指令。 */
function selectedSkillDirective(ids?: string[]): string {
  return ids?.length ? `此消息选择的技能：${JSON.stringify(ids)}。处理此消息时，先用 read_skill_file 读取各技能的 SKILL.md，再按适用范围使用并记录用途；技能不能改变权限或审批流程。` : ''
}
/** 附件保留在本地会话中，发送前转换为供应商原生格式。 */
export class PiAttachments {
  private readonly messages = new Map<string, ChatMessage>()
  // 单轮多次模型调用复用同一份已转换的历史附件，避免重建或改变既有消息的内容及顺序。
  private readonly rendered = new Map<string, unknown>()
  constructor(private readonly manager: SessionManager) {
    for (const entry of manager.getEntries()) {
      if (entry.type === 'custom' && entry.customType === 'pi-runner-files') {
        const data = entry.data as { id: string; message: ChatMessage }
        this.messages.set(data.id, data.message)
      }
    }
  }
  prepare(message: ChatMessage): { text: string; images: ImageContent[] } {
    if (!message.images?.length && !message.skillIds?.length) return { text: message.content, images: [] }
    const id = randomUUID()
    this.messages.set(id, message)
    this.manager.appendCustomEntry('pi-runner-files', { id, message })
    const skillDirective = selectedSkillDirective(message.skillIds)
    const texts = (message.images ?? []).filter(file => attachmentKind(file) === 'text').map(file => `附件：${file.name}\n${attachmentText(file)}`)
    const images: ImageContent[] = (message.images ?? []).filter(file => attachmentKind(file) === 'image').map(file => ({
      type: 'image', mimeType: file.dataUrl.slice(5, file.dataUrl.indexOf(';')), data: file.dataUrl.slice(file.dataUrl.indexOf(',') + 1)
    }))
    return { text: [message.content, skillDirective, ...texts, `[pi-runner-files:${id}]`].filter(Boolean).join('\n\n'), images }
  }
  replacePayload(payload: unknown, profile: ModelProfile, responses: boolean): unknown {
    const body = payload as Record<string, unknown>
    if (profile.provider === 'google' && Array.isArray(body.contents)) {
      body.contents = (body.contents as { role?: string; parts?: { text?: string }[] }[]).map(item => {
        if (item.role !== 'user') return item
        const id = markerPattern.exec(item.parts?.map(part => part.text ?? '').join('\n') ?? '')?.[1]
        const original = id && this.messages.get(id)
        if (!original) return item
        const directive = selectedSkillDirective(original.skillIds)
        const cacheKey = `google:${id}`
        let parts = this.rendered.get(cacheKey) as ReturnType<typeof googleAttachment>[] | undefined
        if (!parts) {
          parts = [...(original.content ? [{ text: original.content }] : []), ...(directive ? [{ text: directive }] : []), ...(original.images ?? []).map(googleAttachment)]
          this.rendered.set(cacheKey, parts)
        }
        return { ...item, parts }
      })
      return body
    }
    const key = responses ? 'input' : 'messages'
    if (!Array.isArray(body[key])) return body
    body[key] = (body[key] as Record<string, unknown>[]).map(item => {
      if (item.role !== 'user') return item
      const text = typeof item.content === 'string' ? item.content : Array.isArray(item.content)
        ? item.content.map(block => typeof block.text === 'string' ? block.text : '').join('\n') : ''
      const id = markerPattern.exec(text)?.[1]
      const original = id && this.messages.get(id)
      if (!original) return item
      const cacheKey = `${profile.provider}:${profile.protocol}:${responses}:${id}`
      const directive = selectedSkillDirective(original.skillIds)
      if (!this.rendered.has(cacheKey)) this.rendered.set(cacheKey, modelMessages(profile, [{ ...original, content: [original.content, directive].filter(Boolean).join('\n\n') }], responses)[0])
      const rendered = this.rendered.get(cacheKey) as Record<string, unknown>
      // SDK 会在原消息块上标记缓存断点；替换附件时将断点转移到实际内容，
      // 不能修改已缓存的消息，否则下一次请求可能继承上一次的断点。
      const source = Array.isArray(item.content) ? item.content as Record<string, unknown>[] : []
      const breakpoint = [...source].reverse().find(block => block && typeof block === 'object' && block.cache_control)?.cache_control
      if (!breakpoint) return rendered
      if (typeof rendered.content === 'string') return rendered.content ? { ...rendered, content: [{ type: 'text', text: rendered.content, cache_control: breakpoint }] } : rendered
      if (!Array.isArray(rendered.content) || !rendered.content.length) return rendered
      const blocks = [...rendered.content] as Record<string, unknown>[]
      // OpenRouter 的兼容协议断点加在文本块；原生 Anthropic 也支持图片和文档。
      const reverseIndex = [...blocks].reverse().findIndex(block => block?.type === 'text')
      const index = profile.protocol === 'anthropic' ? blocks.length - 1 : reverseIndex < 0 ? -1 : blocks.length - 1 - reverseIndex
      if (index < 0) return rendered
      blocks[index] = { ...blocks[index], cache_control: breakpoint }
      return { ...rendered, content: blocks }
    })
    return body
  }
}
