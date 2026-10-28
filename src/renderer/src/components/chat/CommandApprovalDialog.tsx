import { useState } from 'react'
import { Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Modal } from '@/components/ui/modal'
import { SyntaxCode } from './SyntaxCode'
import { AiReviewBadge } from './AiReviewBadge'
import { highlightCommand } from '../../lib/command-syntax'
import { approvalCommand, commandApprovalNotice } from '../../lib/tool-approval'
import type { ToolApproval } from '../../../../shared/models'

/**
 * 终端命令审批弹窗：命令本体使用代码高亮，批准或拒绝直接作用于本次调用。
 * 关闭弹窗不会批准操作，待审批命令仍保留在会话入口处。
 */
export function CommandApprovalDialog({ open, onOpenChange, approval, repeat, onRepeatChange, onRespond }: {
  open: boolean
  onOpenChange(open: boolean): void
  approval: ToolApproval
  repeat: boolean
  onRepeatChange(repeat: boolean): void
  onRespond(allow: boolean): Promise<void>
}): React.JSX.Element {
  const [answering, setAnswering] = useState(false)
  const command = approvalCommand(approval)
  // 默认模式的“逐次确认”说明不展示，只保留额外批准原因。
  const notice = commandApprovalNotice(approval)
  // 审批失败由调用方提示，这里只负责按钮的忙碌状态，避免未处理的 Promise 拒绝。
  const respond = (allow: boolean): void => { if (answering) return; setAnswering(true); void onRespond(allow).catch(() => {}).finally(() => setAnswering(false)) }
  return <Modal open={open} onOpenChange={onOpenChange} title={<span className="tool-approval-file-title"><Terminal size={18} aria-hidden="true" /><span>请求执行终端命令</span><AiReviewBadge show={approval.aiReviewed} /></span>}
    description={notice} contentClassName="command-approval-dialog">
    <div className="command-approval-body">
      <div className="command-approval-meta"><span>工作目录</span><span className="command-approval-cwd" title={approval.cwd}>{approval.cwd}</span></div>
      <div className="command-approval-command">
        <span className="command-approval-label">命令</span>
        <SyntaxCode code={command} language="shell" copyable tokens={highlightCommand(command)} />
      </div>
    </div>
    <footer className="command-approval-footer">
      {!approval.mustConfirm && <label className="tool-approval-repeat"><Checkbox checked={repeat} onCheckedChange={value => onRepeatChange(value === true)} /><span>重复不再提醒</span></label>}
      <div className="command-approval-actions">
        <Button type="button" variant="outline" disabled={answering} onClick={() => respond(false)}>拒绝</Button>
        <Button type="button" className="tool-approval-approve" disabled={answering} onClick={() => respond(true)}>批准</Button>
      </div>
    </footer>
  </Modal>
}
