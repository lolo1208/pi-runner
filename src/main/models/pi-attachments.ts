import { randomUUID } from 'node:crypto'
import type { ImageContent } from '@earendil-works/pi-ai'
import type { SessionManager } from '@earendil-works/pi-coding-agent'
import type { ChatMessage, ModelProfile } from '../../shared/models'
import { attachmentKind, attachmentText } from '../../shared/attachments'
import { googleAttachment } from './google-attachments'
import { modelMessages } from './model-attachments'

const markerPattern = /\[pi-runner-files:([\w-]+)\]/
/** 附件保留在本地会话中，发送前转换为供应商原生格式。 */
export class PiAttachments {
  private readonly messages = new Map<string, ChatMessage>()
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
    const texts = (message.images ?? []).filter(file => attachmentKind(file) === 'text').map(file => `附件：${file.name}\n${attachmentText(file)}`)
    const images: ImageContent[] = (message.images ?? []).filter(file => attachmentKind(file) === 'image').map(file => ({
      type: 'image', mimeType: file.dataUrl.slice(5, file.dataUrl.indexOf(';')), data: file.dataUrl.slice(file.dataUrl.indexOf(',') + 1)
    }))
    return { text: [message.content, ...texts, `[pi-runner-files:${id}]`].filter(Boolean).join('\n\n'), images }
  }
  replacePayload(payload: unknown, profile: ModelProfile, responses: boolean): unknown {
    const body = payload as Record<string, unknown>
    if (profile.provider === 'google' && Array.isArray(body.contents)) {
      body.contents = (body.contents as { role?: string; parts?: { text?: string }[] }[]).map(item => {
        if (item.role !== 'user') return item
        const id = markerPattern.exec(item.parts?.map(part => part.text ?? '').join('\n') ?? '')?.[1]
        const original = id && this.messages.get(id)
        if (!original) return item
        return { ...item, parts: [
          ...(original.content ? [{ text: original.content }] : []),
          ...(original.images ?? []).map(googleAttachment)
        ] }
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
      return modelMessages(profile, [original], responses)[0]
    })
    return body
  }
}
