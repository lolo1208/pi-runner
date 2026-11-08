import { usePromptFile } from '../hooks/usePromptFile'
import { PromptFileActions } from './PromptFileActions'
import { EditInfoForm } from '@/components/EditInfoForm'
import { EditPromptField } from '@/components/EditPromptField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { FolderOpen } from 'lucide-react'
import { useState } from 'react'
import { defaultProjectName, MAX_PROJECT_NAME_LENGTH } from '../project-meta'

interface ProjectEditDialogProps {
  root: string
  name: string
  directory: string
  prompt: string
  isBusy: boolean
  error: string
  onClose: () => void
  onSave: (next: { name: string; directory: string; prompt: string }) => void
}

export function ProjectEditDialog({ root, name, directory, prompt, isBusy, error, onClose, onSave }: ProjectEditDialogProps): React.JSX.Element {
  const [draftName, setDraftName] = useState(name || defaultProjectName(root))
  const [draftDirectory, setDraftDirectory] = useState(directory)
  const [promptDirectory, setPromptDirectory] = useState(directory)
  const [saving, setSaving] = useState(false)
  const file = usePromptFile(promptDirectory, promptDirectory === root ? prompt : '')
  const busy = isBusy || saving
  const switchDirectory = (value: string): void => {
    const next = value.trim()
    if (!next || next === promptDirectory) return
    if (file.dirty() && !window.confirm('切换目录将丢弃当前未保存的提示词草稿，是否继续？')) {
      setDraftDirectory(promptDirectory)
      return
    }
    setDraftDirectory(next); setPromptDirectory(next)
  }
  const save = async (): Promise<void> => {
    if (busy || !file.ready || draftDirectory.trim() !== promptDirectory) return
    setSaving(true)
    try {
      const savedPrompt = await file.save()
      onSave({ name: draftName, directory: promptDirectory, prompt: savedPrompt })
    } catch { /* 文件错误由共用操作区显示，保留草稿。 */ }
    finally { setSaving(false) }
  }
  const chooseDirectory = (): void => {
    void window.piRunner.pickProjectDirectory?.().then(chosen => { if (chosen) switchDirectory(chosen) }).catch(() => undefined)
  }
  return <Modal open onOpenChange={open => { if (!open && !busy) onClose() }} title="编辑项目信息" description="设置项目名称、工作目录和项目专属指令。" closeLabel="关闭项目信息" closeDisabled={busy} contentClassName="edit-info-dialog">
    {error && <p role="alert" className="error">{error}</p>}
    <PromptFileActions error={file.error} reload={() => file.read(true)} retry={() => file.save()} overwrite={() => file.save(true)} />
    <EditInfoForm onClose={onClose} busy={busy} saveDisabled={!file.ready || !draftDirectory.trim() || draftDirectory.trim() !== promptDirectory} onSave={() => { void save() }}>
      <div className="edit-info-field">
        <Label htmlFor="project-edit-name">项目名称</Label>
          <Input id="project-edit-name" value={draftName} maxLength={MAX_PROJECT_NAME_LENGTH} disabled={busy} onChange={event => setDraftName(event.target.value)} />
        </div>
        <div className="edit-info-field">
          <Label htmlFor="project-edit-directory">项目目录</Label>
          <div className="project-edit-directory">
            <Input id="project-edit-directory" value={draftDirectory} disabled={busy} onChange={event => setDraftDirectory(event.target.value)} onBlur={() => switchDirectory(draftDirectory)} />
            <Tooltip><TooltipTrigger asChild><span className="inline-flex" tabIndex={busy ? 0 : undefined}><Button type="button" variant="outline" size="icon" aria-label="选择目录" disabled={busy} onClick={chooseDirectory}><FolderOpen size={15} /></Button></span></TooltipTrigger><TooltipContent>选择目录</TooltipContent></Tooltip>
          </div>
          <p className="hint">修改目录后，此项目的对话会关联到新目录。当前有任务运行时，目录切换会在任务结束后生效。</p>
        </div>
        <EditPromptField id="project-edit-prompt" label="项目提示词" value={file.draft} onChange={file.change} disabled={busy || !file.ready || draftDirectory.trim() !== promptDirectory} placeholder="修改完成后直接输出最终代码，无需测试用例和繁琐说明。" suggestion="修改完成后直接输出最终代码，无需测试用例和繁琐说明。" hint="保存到当前目录的 AGENTS.md，从下一轮对话生效。切换目录会读取目标目录已有的提示词。" />
    </EditInfoForm>
  </Modal>
}
