import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '../ui/button'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle, AlertDialogTrigger } from '../ui/alert-dialog'

export function DeleteRoundButton({ disabled, onDelete }: { disabled?: boolean; onDelete(): Promise<void> }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const remove = async (): Promise<void> => {
    setDeleting(true); setError('')
    try { await onDelete(); setOpen(false) }
    catch (error) { setError(error instanceof Error ? error.message : '删除失败，请重试') }
    finally { setDeleting(false) }
  }
  return <AlertDialog open={open} onOpenChange={value => { if (!deleting) { setOpen(value); setError('') } }}>
    <AlertDialogTrigger asChild><Button type="button" variant="ghost" size="icon" className="message-delete" aria-label="删除这轮对话" title={disabled ? '请等待当前任务结束后删除' : '删除这轮对话'} disabled={disabled}><Trash2 size={14} aria-hidden="true" /></Button></AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogTitle>删除这轮对话？</AlertDialogTitle>
      <AlertDialogDescription>将删除本轮用户输入、模型回复及所有工具和技能调用记录，并从后续模型上下文中移除。此操作无法撤销，已经执行的文件改动不会回滚。</AlertDialogDescription>
      {error && <p className="error" role="alert">{error}</p>}
      <AlertDialogFooter>
        <AlertDialogCancel asChild><Button variant="outline" disabled={deleting}>取消</Button></AlertDialogCancel>
        <Button variant="destructive" disabled={deleting || disabled} onClick={() => void remove()}>{deleting ? '正在删除…' : '删除整轮对话'}</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}
