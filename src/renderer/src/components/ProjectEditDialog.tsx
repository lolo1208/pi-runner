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
  const [draftPrompt, setDraftPrompt] = useState(prompt)
  const chooseDirectory = (): void => {
    void window.piRunner.pickProjectDirectory?.().then(chosen => { if (chosen) setDraftDirectory(chosen) }).catch(() => undefined)
  }
  return <Modal open onOpenChange={open => { if (!open && !isBusy) onClose() }} title="编辑项目信息" description="设置项目名称、工作目录和项目专属指令。" closeLabel="关闭项目信息" closeDisabled={isBusy} contentClassName="edit-info-dialog">
    {error && <p role="alert" className="error">{error}</p>}
    <EditInfoForm onClose={onClose} busy={isBusy} saveDisabled={!draftDirectory.trim()} onSave={() => onSave({ name: draftName, directory: draftDirectory.trim(), prompt: draftPrompt })}>
      <div className="edit-info-field">
        <Label htmlFor="project-edit-name">项目名称</Label>
          <Input id="project-edit-name" value={draftName} maxLength={MAX_PROJECT_NAME_LENGTH} disabled={isBusy} onChange={event => setDraftName(event.target.value)} />
        </div>
        <div className="edit-info-field">
          <Label htmlFor="project-edit-directory">项目目录</Label>
          <div className="project-edit-directory">
            <Input id="project-edit-directory" value={draftDirectory} disabled={isBusy} onChange={event => setDraftDirectory(event.target.value)} />
            <Tooltip><TooltipTrigger asChild><span className="inline-flex" tabIndex={isBusy ? 0 : undefined}><Button type="button" variant="outline" size="icon" aria-label="选择目录" disabled={isBusy} onClick={chooseDirectory}><FolderOpen size={15} /></Button></span></TooltipTrigger><TooltipContent>选择目录</TooltipContent></Tooltip>
          </div>
          <p className="hint">修改目录后，此项目的对话会关联到新目录。当前有任务运行时，目录切换会在任务结束后生效。</p>
        </div>
        <EditPromptField id="project-edit-prompt" label="项目提示词" value={draftPrompt} onChange={setDraftPrompt} disabled={isBusy} placeholder="修改完成后直接输出最终代码，无需测试用例和繁琐说明。" suggestion="修改完成后直接输出最终代码，无需测试用例和繁琐说明。" hint="修改从下一轮对话生效。" />
    </EditInfoForm>
  </Modal>
}
