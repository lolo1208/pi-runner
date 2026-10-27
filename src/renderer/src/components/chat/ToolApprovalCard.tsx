import { useState } from 'react'
import { FilePenLine, FilePlus2, FileSearch, ShieldQuestion, Terminal, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import type { ToolApproval } from '../../../../shared/models'

function operation(approval: ToolApproval) {
  const file = typeof approval.args.path === 'string' ? approval.args.path : ''
  const command = typeof approval.args.command === 'string' ? approval.args.command : ''
  const deletion = /^(?:rm|del|erase|Remove-Item)\s+(?:(?:-[\w-]+)\s+)*(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))\s*$/i.exec(command)
  const target = file || (deletion ? deletion[1] ?? deletion[2] ?? deletion[3] : '')
  const name = target.split(/[\\/]/).filter(Boolean).at(-1) ?? ''
  if (deletion || ['delete', 'remove', 'rmdir'].includes(approval.tool)) return { title: `请求删除${name ? ` ${name}` : '文件或目录'}`, path: target || approval.cwd, icon: Trash2 }
  if (approval.tool === 'mkdir') return { title: `请求创建目录 ${name}`, path: file, icon: FilePlus2 }
  if (['move', 'copy'].includes(approval.tool)) return { title: `请求${approval.tool === 'move' ? '移动或重命名' : '复制'} ${name}`, path: `${file} → ${String(approval.args.destination ?? '')}`, icon: FilePenLine }
  if (approval.tool === 'edit') return { title: `请求修改 ${name || '文件'}`, path: file, icon: FilePenLine }
  if (approval.tool === 'write') return { title: `请求写入 ${name || '文件'}`, path: file, icon: FilePlus2 }
  if (approval.tool === 'download') return { title: `请求下载 ${name || '文件'}`, path: `${String(approval.args.url ?? '')} → ${file}`, icon: FilePlus2 }
  if (['read', 'ls', 'find', 'grep', 'stat'].includes(approval.tool)) return { title: `请求访问 ${name || '文件或目录'}`, path: file || approval.cwd, icon: FileSearch }
  if (command) return { title: '请求执行终端命令', path: approval.cwd, icon: Terminal }
  return { title: '请求批准操作', path: file || approval.cwd, icon: ShieldQuestion }
}

export function ToolApprovalCard({ approval, onRespond, onViewDetails, repeat, onRepeatChange }: { approval: ToolApproval; onRespond(allow: boolean): Promise<void>; onViewDetails(): void; repeat: boolean; onRepeatChange(repeat: boolean): void }): React.JSX.Element {
  const [answering, setAnswering] = useState(false)
  const summary = operation(approval)
  const Icon = summary.icon
  const respond = (allow: boolean): void => { if (answering) return; setAnswering(true); void onRespond(allow).finally(() => setAnswering(false)) }
  return <section className="tool-approval-card" aria-label="工具操作审批">
    <Icon size={18} aria-hidden="true" />
    <div className="tool-approval-summary"><strong>{summary.title}</strong><small title={summary.path}>{summary.path}</small></div>
    <div className="tool-approval-actions"><Button type="button" variant="ghost" className="tool-approval-details" onClick={onViewDetails}>查看详情</Button>{!approval.mustConfirm && <label className="tool-approval-repeat"><Checkbox checked={repeat} onCheckedChange={value => onRepeatChange(value === true)} /><span>重复不再提醒</span></label>}<Button type="button" variant="outline" disabled={answering} onClick={() => respond(false)}>拒绝</Button><Button type="button" className="tool-approval-approve" disabled={answering} onClick={() => respond(true)}>批准</Button></div>
  </section>
}
