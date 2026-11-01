import type { Part } from '@google/genai'
import type { ChatAttachment } from '../../shared/models'
import { ATTACHMENT_DATA_URL, attachmentKind, attachmentText } from '../../shared/attachments'
import { ModelError } from './model-validation'

const supportedMimeTypes = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif',
  'audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp3', 'audio/aiff', 'audio/x-aiff', 'audio/aac', 'audio/ogg', 'audio/flac', 'audio/x-flac', 'audio/mp4',
  'video/mp4', 'video/mpeg', 'video/mov', 'video/quicktime', 'video/avi', 'video/x-msvideo', 'video/x-flv', 'video/mpg', 'video/webm', 'video/wmv', 'video/3gpp',
  'application/pdf'
])
/** 使用明确的 MIME 白名单，避免将“任意音频/视频”误报为已支持。 */
export function googleAttachment(file: ChatAttachment): Part {
  if (attachmentKind(file) === 'text') return { text: `附件：${file.name}\n${attachmentText(file)}` }
  const match = ATTACHMENT_DATA_URL.exec(file.dataUrl)
  const mime = match?.[1].toLowerCase()
  if (!match || !mime || !supportedMimeTypes.has(mime)) throw new ModelError(`Google 不支持附件“${file.name}”的格式，请将图片转为 PNG/JPEG，音视频转为受支持格式，或将文档转为文本/PDF`)
  return { inlineData: { mimeType: mime, data: match[2] } }
}
