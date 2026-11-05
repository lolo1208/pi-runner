import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Copy, Download, File, FileText, Music, Video, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Modal } from '@/components/ui/modal'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import type { ChatImage } from '../../../../shared/models'
import { attachmentKind, attachmentSize, attachmentText, formatAttachmentSize } from '../../../../shared/attachments'
import { useTranscriptOverlay, useTranscriptState } from './TranscriptState'
import { fileIcon } from '../FileIcon'

interface Props { images: ChatImage[]; onRemove?: (id: string) => void; disabled?: boolean }

export function ChatImages({ images, onRemove, disabled }: Props): React.JSX.Element {
  const { showOverlay, overlay } = useTranscriptOverlay()
  const [unreadable, setUnreadable] = useTranscriptState('unreadable-attachments', () => new Set<string>())
  const markUnreadable = (id: string): void => setUnreadable(items => new Set([...items, id]))
  const setPreview = (image: ChatImage): void => showOverlay(close => <AttachmentPreview image={image} images={images} onClose={close} onUnreadable={markUnreadable} />)
  return <>
    <div className="chat-images" aria-label="文件附件">
      {images.map(image => {
        const fileKind = attachmentKind(image)
        const mime = image.dataUrl.slice(5, image.dataUrl.indexOf(';'))
        const canPreview = !unreadable.has(image.id) && (fileKind === 'image' || fileKind === 'text' || ((fileKind === 'audio' || fileKind === 'video') && Boolean(document.createElement(fileKind).canPlayType(mime))))
        const Icon = fileKind === 'text' ? FileText : fileKind === 'audio' ? Music : fileKind === 'video' ? Video : File
        const label = fileKind === 'image' ? '图片' : '附件'
        const contents = fileKind === 'image' && !unreadable.has(image.id)
          ? <img src={image.dataUrl} alt={image.name} onError={() => markUnreadable(image.id)} />
          : <><Icon size={20} aria-hidden="true" /><span className="chat-file-info"><span>{image.name}</span><small>{formatAttachmentSize(attachmentSize(image))}{!canPreview ? ' · 无法预览' : ''}</small></span></>
        return <div className={`chat-image${fileKind !== 'image' || unreadable.has(image.id) ? ' chat-file' : ''}`} key={image.id}>
          <Button type="button" className="chat-image-open" title={image.name} aria-label={`预览${label} ${image.name}`} onClick={() => setPreview(image)}>{contents}</Button>
          {onRemove && <Button type="button" className="chat-image-remove" aria-label={`删除${label} ${image.name}`} disabled={disabled} onClick={() => onRemove(image.id)}><X size={13} /></Button>}
        </div>
      })}
    </div>
    {overlay}
  </>
}

function AttachmentPreview({ image, images, onClose, onUnreadable }: { image: ChatImage; images: ChatImage[]; onClose: () => void; onUnreadable: (id: string) => void }): React.JSX.Element {
  const [preview, setPreview] = useState(image)
  const kind = attachmentKind(preview)
  const [unreadable, setUnreadable] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const index = images.findIndex(item => item.id === preview.id)
  const navigate = useCallback((direction: number): void => {
    const next = index + direction
    if (next < 0 || next >= images.length) return
    setPreview(images[next])
    setUnreadable(false)
    setSaveError('')
  }, [images, index])
  useEffect(() => {
    if (images.length < 2) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || (event.target instanceof HTMLElement && event.target.closest('audio, video, [role="menu"]'))) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      navigate(event.key === 'ArrowLeft' ? -1 : 1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [images.length, navigate])
  const save = async (): Promise<void> => {
    setSaving(true)
    setSaveError('')
    try { await window.piRunner.saveAttachment(preview.name, preview.dataUrl) }
    catch { setSaveError('附件保存失败，请检查保存位置的访问权限和剩余空间后重试') }
    finally { setSaving(false) }
  }
  const saveButton = <Tooltip><TooltipTrigger asChild><span className={`inline-flex${kind === 'image' ? ' image-preview-save-anchor' : ''}`} tabIndex={saving ? 0 : undefined}><Button type="button" variant="ghost" size="icon" className={`modal-close attachment-save${kind === 'image' ? ' image-preview-save' : ''}`} aria-label="另存为" disabled={saving} onClick={() => void save()}><Download size={16} aria-hidden="true" /></Button></span></TooltipTrigger><TooltipContent>另存为</TooltipContent></Tooltip>
  const errorMessage = saveError && <p className="attachment-save-error" role="alert">{saveError}</p>
  const markUnreadable = (): void => { setUnreadable(true); onUnreadable(preview.id) }
  const copyImage = async (): Promise<void> => {
    setSaveError('')
    try { await window.piRunner.copyAttachment(preview.name, preview.dataUrl) }
    catch { setSaveError('复制图片文件失败，请检查系统剪贴板后重试') }
  }
  const navigation = images.length > 1 && <>
    <Button type="button" variant="ghost" size="icon" className="image-preview-nav image-preview-nav-previous" aria-label="上一个文件" disabled={index <= 0} onClick={() => navigate(-1)}><ChevronLeft size={24} aria-hidden="true" /></Button>
    <Button type="button" variant="ghost" size="icon" className="image-preview-nav image-preview-nav-next" aria-label="下一个文件" disabled={index >= images.length - 1} onClick={() => navigate(1)}><ChevronRight size={24} aria-hidden="true" /></Button>
  </>
  const fallback = <div className="attachment-preview-fallback">{fileIcon(preview.name)}<span>{preview.name}</span><small>此文件无法预览</small></div>
  // 图片使用沉浸灯箱，其余附件沿用通用弹窗（标题栏、关闭按钮与遮罩一致）。
  if (kind === 'image') return <Modal open onOpenChange={open => { if (!open) onClose() }} title={`图片预览：${preview.name}`}
    bare closeOnBackdropClick closeExtra={saveButton} contentClassName="image-preview-content" onOpenAutoFocus={event => { event.preventDefault(); (event.currentTarget as HTMLElement).focus() }} closeClassName="image-preview-close" closeLabel="关闭图片预览">
    {errorMessage}
    {navigation}
    {unreadable ? fallback
      : <ContextMenu><ContextMenuTrigger asChild><img src={preview.dataUrl} alt={preview.name} onError={markUnreadable} /></ContextMenuTrigger>
        <ContextMenuContent aria-label="图片操作">
          <ContextMenuItem onSelect={() => void copyImage()}><Copy size={14} aria-hidden="true" />复制文件</ContextMenuItem>
          <ContextMenuItem disabled={saving} onSelect={() => void save()}><Download size={14} aria-hidden="true" />另存为</ContextMenuItem>
        </ContextMenuContent></ContextMenu>}
  </Modal>
  const text = kind === 'text' ? attachmentText(preview) : ''
  const Icon = kind === 'audio' ? Music : kind === 'video' ? Video : kind === 'text' ? FileText : File
  const mime = preview.dataUrl.slice(5, preview.dataUrl.indexOf(';'))
  const unsupported = (kind === 'audio' || kind === 'video') && !document.createElement(kind).canPlayType(mime)
  return <Modal open onOpenChange={open => { if (!open) onClose() }} closeLabel="关闭附件预览" closeExtra={saveButton} onOpenAutoFocus={event => { event.preventDefault(); (event.currentTarget as HTMLElement).focus() }}
    title={<span className="file-preview-title"><Icon size={17} aria-hidden="true" />
      <span className="file-preview-name">{preview.name}</span>
      {kind === 'text' && <span className="file-preview-subtitle">{textAttachmentMeta(text, preview)}</span>}
    </span>}
    contentClassName={`attachment-preview-dialog${kind === 'text' ? ' attachment-preview-text-dialog' : ' attachment-preview-media-dialog'}`}>
    {navigation}
    {errorMessage}
    {unreadable || unsupported || kind === 'file' ? fallback
      : kind === 'text' ? <TextAttachmentPreview key={preview.id} name={preview.name} text={text} />
      : kind === 'audio' ? <audio key={preview.id} src={preview.dataUrl} controls aria-label={preview.name} onError={markUnreadable} />
      : kind === 'video' ? <video key={preview.id} src={preview.dataUrl} controls playsInline aria-label={preview.name} onError={markUnreadable} /> : fallback}
  </Modal>
}

function textAttachmentMeta(text: string, file: ChatImage): string {
  const lines = text ? text.split(/\r\n|\r|\n/).length : 0
  const characters = text.replace(/\r\n|\r|\n/g, '').length
  return `${lines} 行 · ${characters.toLocaleString('zh-CN')} 字符 · ${formatAttachmentSize(attachmentSize(file))}`
}

/** 文本附件正文：等宽滚动区，右上角是与代码块一致的图标复制按钮。 */
function TextAttachmentPreview({ name, text }: { name: string; text: string }): React.JSX.Element {
  return <div className="file-preview-body">
    <pre className="file-preview-text" tabIndex={0} aria-label={`${name} 内容`}>{text}</pre>
    <CopyAttachmentText text={text} />
  </div>
}

function CopyAttachmentText({ text }: { text: string }): React.JSX.Element {
  const [status, setStatus] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle')
  useEffect(() => {
    if (status !== 'copied' && status !== 'error') return
    const timer = setTimeout(() => setStatus('idle'), 2000)
    return () => clearTimeout(timer)
  }, [status])
  const copy = async (): Promise<void> => {
    setStatus('copying')
    try {
      await window.piRunner.copyText(text)
      setStatus('copied')
    } catch {
      setStatus('error')
    }
  }
  const label = status === 'copied' ? '已复制' : status === 'error' ? '复制失败，请重试' : '复制内容'
  return <Tooltip><TooltipTrigger asChild><span className="inline-flex" tabIndex={status === 'copying' ? 0 : undefined}><Button type="button" variant="ghost" size="sm" className="file-preview-copy" aria-label={label} disabled={status === 'copying'} onClick={() => void copy()}>
    {status === 'copied' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
    <span role="status" aria-live="polite">{status === 'copied' || status === 'error' ? label : ''}</span>
  </Button></span></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>
}
