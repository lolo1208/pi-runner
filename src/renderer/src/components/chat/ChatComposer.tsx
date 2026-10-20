import { memoWithStableCallbacks } from '../../lib/memo-with-callbacks'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ArrowUp, Check, LoaderCircle, Square } from 'lucide-react'
import { ComposerAddMenu, ComposerSkillTags, useLocalSkills } from './ComposerAddMenu'
import { useSlashSkillPicker } from './SlashSkillPicker'
import { MessageQueue, type MessageQueueProps } from './MessageQueue'
import { IntentModePicker } from './IntentModePicker'
import { PermissionModePicker } from './PermissionModePicker'
import type { PermissionMode, IntentMode } from '../../../../shared/models'
import { MAX_ATTACHMENT_BYTES, MAX_MESSAGE_ATTACHMENTS, type ChatImage, type ModelProfileView, type ModelProviderConnection } from '../../../../shared/models'
import { attachmentMime } from '../../../../shared/attachments'
import { ChatImages } from './ChatImages'
import { ConversationModelPicker } from './ConversationModelPicker'

const TEXT_ATTACHMENT_MIN_CHARACTERS = 2000
const TEXT_ATTACHMENT_MIN_LINES = 20

interface ChatComposerProps extends MessageQueueProps {
  active?: boolean
  onCancelEdit?: () => void
  intentMode?: IntentMode
  onIntentChange?(mode: IntentMode): void
  permissionMode?: PermissionMode
  onPermissionChange?: (mode: PermissionMode) => Promise<void>
  profile: ModelProfileView | undefined
  profiles?: ModelProfileView[]
  providers?: ModelProviderConnection[]
  onSelectModel?: (id: string) => void
  /** 快捷面板内修改当前模型的推理档位。 */
  onThinkingChange?: (profile: ModelProfileView, value: boolean | string | null) => Promise<void> | void
  prompt: string
  images: ChatImage[]
  skillIds?: string[]
  onSkillsChange?: (ids: string[]) => void
  isBusy: boolean
  stopping?: boolean
  hasMessages: boolean
  settingsDisabled?: boolean
  sendWithCtrlEnter: boolean
  onPromptChange: (prompt: string) => void
  onImagesChange: (images: ChatImage[]) => void
  onOpenSettings: (section?: 'models' | 'skills') => void
  onSend: () => void
  onCancel: () => void
}

function ChatComposerView({ active = true, queue = [], editingId, queuePaused, onResumeQueue, onEditQueued, onDeleteQueued, onReorderQueued, onCancelEdit, intentMode = 'execute', onIntentChange, permissionMode = 'default', onPermissionChange, profile, profiles, providers, onSelectModel, onThinkingChange, prompt, images, skillIds = [], onSkillsChange = () => {}, isBusy, stopping = false, hasMessages, settingsDisabled, sendWithCtrlEnter, onPromptChange, onImagesChange, onOpenSettings, onSend, onCancel }: ChatComposerProps): React.JSX.Element {
  const localSkills = useLocalSkills()
  const promptId = useId()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const readingRef = useRef(false)
  const [reading, setReading] = useState(false)
  const [imageError, setImageError] = useState('')
  const slashSkills = useSlashSkillPicker({ prompt, textareaRef, available: localSkills, skillIds, onSkillsChange, onPromptChange, disabled: reading || !active })
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform) || navigator.userAgent.includes('Macintosh')
  const sendShortcut = isMac ? '⌘ + Enter' : 'Ctrl + Enter'

  const resizeRef = useRef<() => void>(() => {})
  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    const resize = () => {
      if (!textarea.clientWidth) return
      const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight) || 25.2
      textarea.style.height = '0px'
      const height = Math.max(lineHeight, textarea.scrollHeight)
      textarea.style.height = `${Math.min(height, lineHeight * 8)}px`
      textarea.style.overflowY = height > lineHeight * 8 ? 'auto' : 'hidden'
    }
    resizeRef.current = resize
    resize()
    let width = textarea.clientWidth
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (textarea.clientWidth !== width) { width = textarea.clientWidth; resize() }
    })
    observer?.observe(textarea)
    return () => { observer?.disconnect(); resizeRef.current = () => {} }
  }, [])
  useLayoutEffect(() => { if (active) resizeRef.current() }, [prompt, images.length, active])

  useEffect(() => { if (editingId && active) textareaRef.current?.focus() }, [editingId, active])

  const addImages = async (files: File[]): Promise<void> => {
    if (readingRef.current || !files.length) return
    setImageError('')
    if (images.length + files.length > MAX_MESSAGE_ATTACHMENTS) { setImageError(`最多添加 ${MAX_MESSAGE_ATTACHMENTS} 个附件。`); return }
    if (files.some(file => file.size > MAX_ATTACHMENT_BYTES)) { setImageError('每个附件不能超过 32 MB。'); return }
    readingRef.current = true; setReading(true)
    try {
      const added = await Promise.all(files.map(file => new Promise<ChatImage>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const data = String(reader.result).split(',')[1] ?? ''
          const mime = attachmentMime(file.name, file.type)
          resolve({ id: crypto.randomUUID(), name: file.name.slice(0, 255) || '粘贴的附件', dataUrl: `data:${mime};base64,${data}` })
        }
        reader.onerror = () => reject(new Error('附件读取失败，请重试。'))
        reader.onabort = () => reject(new Error('附件读取已取消，请重试。'))
        reader.readAsDataURL(file)
      })))
      onImagesChange([...images, ...added])
    } catch (error) { setImageError(error instanceof Error ? error.message : '附件读取失败，请重试。') }
    finally { readingRef.current = false; setReading(false) }
  }

  return <form className="composer" onClick={event => {
    const target = event.target
    if (!(target instanceof HTMLElement) || !event.currentTarget.contains(target)) return
    if (target.closest('button, a, input, textarea, select, label, [role="button"], [role="combobox"], [role="menuitem"], [contenteditable="true"], [tabindex], .chat-image')) return
    textareaRef.current?.focus({ preventScroll: true })
  }} onSubmit={event => { event.preventDefault(); if (!readingRef.current && (editingId || !settingsDisabled)) onSend() }} onDragOver={event => {
    if (event.dataTransfer.types.includes('Files')) event.preventDefault()
  }} onDrop={event => {
    if (!event.dataTransfer.files.length) return
    event.preventDefault(); void addImages(Array.from(event.dataTransfer.files))
  }}>
    <MessageQueue queue={queue} editingId={editingId} queuePaused={queuePaused} onResumeQueue={onResumeQueue} onEditQueued={reading ? undefined : onEditQueued} onDeleteQueued={reading ? undefined : onDeleteQueued} onReorderQueued={onReorderQueued} />
    {editingId && <div className="queue-edit-status"><span>{queuePaused ? '正在编辑队列消息，保存后队列保持暂停' : '正在编辑队列消息，保存后继续执行'}</span><Button type="button" variant="ghost" size="sm" disabled={reading} onClick={onCancelEdit}>取消编辑</Button></div>}
    {active && images.length > 0 && <ChatImages images={images} disabled={reading} onRemove={id => onImagesChange(images.filter(image => image.id !== id))} />}
    <ComposerSkillTags ids={skillIds} skills={localSkills.skills} disabled={reading} onChange={onSkillsChange} />
    {imageError && <p className="composer-image-error" role="alert">{imageError}</p>}
    <input ref={fileRef} type="file" multiple hidden aria-label="选择文件附件" onChange={event => {
      void addImages(Array.from(event.target.files ?? [])); event.target.value = ''
    }} />
    <Label className="sr-only" htmlFor={promptId}>消息</Label>
    {slashSkills.popup}
    <Textarea {...slashSkills.inputProps} ref={textareaRef} rows={1} id={promptId} aria-label="消息" value={prompt} maxLength={32000} placeholder={hasMessages ? '继续聊一聊…' : '描述你想完成的任务…'} onChange={event => { onPromptChange(event.target.value); slashSkills.onChange() }} onPaste={event => {
      const files = Array.from(event.clipboardData.items).filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((file): file is File => Boolean(file))
      if (files.length) { event.preventDefault(); void addImages(files); return }
      const text = event.clipboardData.getData('text/plain')
      if (text.length >= TEXT_ATTACHMENT_MIN_CHARACTERS || text.split(/\r\n|\r|\n/).length >= TEXT_ATTACHMENT_MIN_LINES) {
        event.preventDefault()
        let name = '粘贴内容'
        for (let index = 2; images.some(file => file.name === name); index++) name = `粘贴内容-${index}`
        void addImages([new File([text], name, { type: 'text/plain' })])
      }
    }} onKeyDown={event => {
      if (slashSkills.onKeyDown(event)) return
      if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229) return
      const shouldSend = sendWithCtrlEnter ? (isMac ? event.metaKey : event.ctrlKey) : !event.shiftKey
      if (shouldSend) { event.preventDefault(); if (!readingRef.current && (editingId || !settingsDisabled)) onSend() }
    }} />
    {active && <div className="composer-actions">
      <div className="composer-tools">
        <ComposerAddMenu available={localSkills} ids={skillIds} onChange={onSkillsChange} disabled={reading} filesDisabled={reading || images.length >= MAX_MESSAGE_ATTACHMENTS} onConfigureSkills={() => onOpenSettings('skills')} onAddFiles={() => fileRef.current?.click()} />
        <IntentModePicker mode={intentMode} onChange={onIntentChange} disabled={isBusy || settingsDisabled} />
        {reading ? <span className="composer-mode">正在添加附件…</span> : <PermissionModePicker mode={permissionMode} disabled={isBusy || settingsDisabled || !onPermissionChange} onChange={onPermissionChange ?? (async () => {})} />}
      </div>
      <div>
        <ConversationModelPicker profile={profile} profiles={profiles ?? (profile ? [profile] : [])} providers={providers} disabled={isBusy || settingsDisabled} onSelect={onSelectModel ?? (() => undefined)} onThinkingChange={onThinkingChange} onOpenSettings={onOpenSettings} />
        {isBusy && <>
          {stopping && <span className="composer-stop-status" role="status">正在停止任务…</span>}
          <Button type="button" className="send-button stop-button" aria-label={stopping ? '正在停止任务' : '取消请求'} title={stopping ? '正在停止任务…' : '停止任务'} disabled={stopping} onClick={onCancel}>{stopping ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : <Square size={14} aria-hidden="true" />}</Button>
        </>}
        <Button type="submit" className={`send-button${editingId ? ' queue-save-button' : ''}`} aria-label={editingId ? '保存队列消息' : '发送消息'} title={`${editingId ? '保存队列消息' : isBusy ? '加入队列' : '发送消息'}（${sendWithCtrlEnter ? sendShortcut : 'Enter'}）`} disabled={(!editingId && (!profile || settingsDisabled)) || reading || (!prompt.trim() && !images.length)}>{editingId ? <><Check size={15} />保存</> : <ArrowUp size={19} />}</Button>
      </div>
    </div>}
  </form>
}

export const ChatComposer = memoWithStableCallbacks(ChatComposerView)
