import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { Textarea } from '@/components/ui/textarea'
import { useState } from 'react'
import { MAX_CUSTOM_PROMPT_LENGTH } from '../../../shared/models'
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
  return <Modal open onOpenChange={open => { if (!open) onClose() }} title="会话信息" closeLabel="关闭会话信息" contentClassName="conversation-edit-dialog">
    <form onSubmit={event => { event.preventDefault(); if (title.trim()) onSave({ title: title.trim(), prompt }) }}>
      <div className="conversation-edit-fields">
        <div className="conversation-edit-field">
          <Label htmlFor="conversation-edit-name">会话名称</Label>
          <Input id="conversation-edit-name" autoFocus required maxLength={MAX_CONVERSATION_NAME_LENGTH} value={title} onChange={event => setTitle(event.target.value)} />
        </div>
        <div className="conversation-edit-field">
          <Label htmlFor="conversation-edit-prompt">会话提示词</Label>
          <Textarea id="conversation-edit-prompt" rows={5} maxLength={MAX_CUSTOM_PROMPT_LENGTH} value={prompt} aria-describedby="conversation-edit-prompt-hint" placeholder="为此会话添加固定指令…" onChange={event => setPrompt(event.target.value)} />
          <p id="conversation-edit-prompt-hint" className="hint">指令冲突时，会话提示词优先于项目提示词，项目提示词优先于全局提示词。留空则使用项目和全局提示词，修改从下一次发送生效。</p>
        </div>
      </div>
      <div className="modal-actions">
        <Button type="button" variant="outline" onClick={onClose}>取消</Button>
        <Button type="submit" className="primary" disabled={!title.trim()}>保存</Button>
      </div>
    </form>
  </Modal>
}
