import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Textarea } from '@/components/ui/textarea'
import { ArrowRightToLine, FolderOpen } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { MAX_CUSTOM_PROMPT_LENGTH } from '../../../shared/models'
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
  const [draftPrompt, setDraftPrompt] = useState(prompt)
  const [promptFocused, setPromptFocused] = useState(false)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = promptRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [draftPrompt])
  const chooseDirectory = (): void => {
    void window.piRunner.pickProjectDirectory?.().then(chosen => { if (chosen) setDraftDirectory(chosen) }).catch(() => undefined)
  }
  return <Modal open onOpenChange={open => { if (!open && !isBusy) onClose() }} title="项目信息" closeLabel="关闭项目信息" closeDisabled={isBusy} contentClassName="project-edit-dialog">
    {error && <p role="alert" className="error">{error}</p>}
    <div className="project-edit-fields">
      <div className="project-edit-field">
        <Label htmlFor="project-edit-name">项目名称</Label>
          <Input id="project-edit-name" value={draftName} maxLength={MAX_PROJECT_NAME_LENGTH} disabled={isBusy} onChange={event => setDraftName(event.target.value)} />
        </div>
        <div className="project-edit-field">
          <Label htmlFor="project-edit-directory">项目目录</Label>
          <div className="project-edit-directory">
            <Input id="project-edit-directory" value={draftDirectory} disabled={isBusy} onChange={event => setDraftDirectory(event.target.value)} />
            <Tooltip><TooltipTrigger asChild><span className="inline-flex" tabIndex={isBusy ? 0 : undefined}><Button variant="outline" size="icon" aria-label="选择目录" disabled={isBusy} onClick={chooseDirectory}><FolderOpen size={15} /></Button></span></TooltipTrigger><TooltipContent>选择目录</TooltipContent></Tooltip>
          </div>
          <p className="hint">修改目录后，此项目的对话会关联到新目录。当前有任务运行时，目录切换会在任务结束后生效。</p>
        </div>
        <div className="project-edit-field">
          <Label htmlFor="project-edit-prompt">项目提示词</Label>
          <div className="custom-prompt-input" data-suggestion-visible={promptFocused && draftPrompt === ''}>
          <Textarea ref={promptRef} id="project-edit-prompt" rows={2} className="project-edit-prompt" maxLength={MAX_CUSTOM_PROMPT_LENGTH} value={draftPrompt} placeholder="修改完成后，跳过复杂的测试和验证。" disabled={isBusy} onFocus={() => setPromptFocused(true)} onBlur={() => setPromptFocused(false)} onChange={event => setDraftPrompt(event.target.value)} onKeyDown={event => {
            if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && !event.nativeEvent.isComposing && draftPrompt === '') {
              event.preventDefault()
              setDraftPrompt('修改完成后，跳过复杂的测试和验证。')
            }
          }} />
          {promptFocused && draftPrompt === '' && <div className="custom-prompt-placeholder" aria-hidden="true">修改完成后，跳过复杂的测试和验证。 <kbd><ArrowRightToLine size={12} />Tab</kbd></div>}
          </div>
          <p className="hint">修改从下一轮对话生效。</p>
        </div>
      </div>
      <div className="project-edit-actions">
        <Button disabled={isBusy} onClick={onClose}>取消</Button>
        <Button className="project-edit-save primary" disabled={isBusy || !draftDirectory.trim()} onClick={() => onSave({ name: draftName, directory: draftDirectory.trim(), prompt: draftPrompt })}>保存</Button>
      </div>
      {isBusy && <p className="hint" role="status">正在保存项目信息…</p>}
  </Modal>
}
