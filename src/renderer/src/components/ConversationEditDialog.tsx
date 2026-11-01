import { EditInfoForm } from '@/components/EditInfoForm'
import { EditPromptField } from '@/components/EditPromptField'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { useState } from 'react'
import { MAX_CONVERSATION_NAME_LENGTH } from '../../../shared/prompts'
import type { Task } from '../app-types'

interface ConversationEditDialogProps {
  task: Task
  onClose: () => void
  onSave: (next: { title: string; prompt: string }) => void
}

export function ConversationEditDialog({ task, onClose, onSave }: ConversationEditDialogProps): React.JSX.Element {
  const [title, setTitle] = useState(task.title)
  const [prompt, setPrompt] = useState(task.prompt ?? '')
  return <Modal open onOpenChange={open => { if (!open) onClose() }} title="编辑会话信息" description="设置此会话的名称和专属指令。" closeLabel="关闭会话信息" contentClassName="edit-info-dialog">
    <EditInfoForm onClose={onClose} saveDisabled={!title.trim()} onSave={() => { if (title.trim()) onSave({ title: title.trim(), prompt }) }}>
      <div className="edit-info-field">
        <Label htmlFor="conversation-edit-name">会话名称</Label>
        <Input id="conversation-edit-name" autoFocus required maxLength={MAX_CONVERSATION_NAME_LENGTH} value={title} onChange={event => setTitle(event.target.value)} />
      </div>
      <EditPromptField id="conversation-edit-prompt" label="会话提示词" value={prompt} onChange={setPrompt} placeholder="为此会话添加固定指令…" hint="提示词优先级：会话 > 项目 > 全局。" />
    </EditInfoForm>
  </Modal>
}
