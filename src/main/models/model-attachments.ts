import type { ChatAttachment, ChatMessage, ModelProfile } from '../../shared/models'
import { attachmentKind, attachmentText } from '../../shared/attachments'
import { ModelError } from './model-validation'

export function useFileResponses(profile: ModelProfile, messages: ChatMessage[]): boolean {
  if (profile.provider === 'custom') return profile.protocol === 'openai-compatible' && profile.compatibleApi === 'responses'
  return profile.provider === 'openai' && profile.protocol !== 'anthropic' && messages.some(message => message.images?.some(file => attachmentKind(file) === 'file' && !file.dataUrl.startsWith('data:application/pdf;')))
}

export function modelMessages(profile: ModelProfile, messages: ChatMessage[], responses: boolean): unknown[] {
  const anthropic = profile.protocol === 'anthropic'
  const ollama = profile.provider === 'ollama'
  const textBlock = (text: string): object => ({ type: responses ? 'input_text' : 'text', text })
  const unsupported = (file: ChatAttachment, hint: string): never => {
    throw new ModelError(`当前模型接口无法接收附件“${file.name}”：${hint}。请选择支持此文件的模型服务，或移除附件后重试`)
  }
  return messages.map(message => {
    if (!message.images?.length) return { role: message.role, content: message.content }
    const texts: string[] = []
    const imageData: string[] = []
    const blocks = message.images.map(file => {
      const kind = attachmentKind(file)
      const mime = file.dataUrl.slice(5, file.dataUrl.indexOf(';')).toLowerCase()
      const data = file.dataUrl.slice(file.dataUrl.indexOf(',') + 1)
      if (kind === 'text') {
        const text = `附件：${file.name}\n${attachmentText(file)}`
        texts.push(text)
        return textBlock(text)
      }
      if (ollama) {
        if (kind !== 'image') return unsupported(file, 'Ollama 当前接入支持文本和图片')
        imageData.push(data)
        return null
      }
      if (kind === 'image') {
        if (anthropic) {
          if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime)) return unsupported(file, 'Claude 需要 PNG、JPEG、WebP 或 GIF 图片')
          return { type: 'image', source: { type: 'base64', media_type: mime, data } }
        }
        return responses ? { type: 'input_image', image_url: file.dataUrl }
          : { type: 'image_url', image_url: { url: file.dataUrl } }
      }
      if (anthropic) {
        if (mime !== 'application/pdf') return unsupported(file, 'Claude 当前接入支持文本、图片和 PDF')
        return { type: 'document', title: file.name, source: { type: 'base64', media_type: mime, data } }
      }
      if (kind === 'audio') {
        if (responses) return unsupported(file, '含非 PDF 文档的会话暂不支持音频输入，请新建音频会话')
        const format = mime === 'audio/mpeg' ? 'mp3' : ['audio/wav', 'audio/x-wav', 'audio/wave'].includes(mime) ? 'wav' : file.name.split('.').at(-1)?.toLowerCase()
        if (profile.provider === 'openai' && !['mp3', 'wav'].includes(format ?? '')) return unsupported(file, 'OpenAI 音频输入需要 MP3 或 WAV')
        if (profile.provider === 'vllm') return { type: 'audio_url', audio_url: { url: file.dataUrl } }
        return { type: 'input_audio', input_audio: { data, format } }
      }
      if (kind === 'video') {
        if (profile.provider === 'openai' || profile.provider === 'deepseek') return unsupported(file, '当前接入接口不支持原始视频输入')
        return { type: 'video_url', video_url: { url: file.dataUrl } }
      }
      return responses ? { type: 'input_file', filename: file.name, file_data: file.dataUrl }
        : { type: 'file', file: { filename: file.name, file_data: file.dataUrl } }
    })
    if (ollama) return { role: message.role, content: [...texts, message.content].filter(Boolean).join('\n\n'), ...(imageData.length ? { images: imageData } : {}) }
    return { role: message.role, content: [...blocks, ...(message.content ? [textBlock(message.content)] : [])] }
  })
}
