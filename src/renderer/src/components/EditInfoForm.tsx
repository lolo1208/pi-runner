import { Button } from '@/components/ui/button'
import type { FormEvent, ReactNode } from 'react'

interface EditInfoFormProps {
  children: ReactNode
  onSave: () => void
  onClose: () => void
  saveDisabled?: boolean
  busy?: boolean
}

export function EditInfoForm({ children, onSave, onClose, saveDisabled, busy }: EditInfoFormProps): React.JSX.Element {
  const submit = (event: FormEvent): void => { event.preventDefault(); onSave() }
  return <form className="edit-info-form" onSubmit={submit}>
    <div className="edit-info-fields">{children}</div>
    <div className="edit-info-footer">
      {busy && <span className="hint" role="status">正在保存…</span>}
      <div className="edit-info-actions">
        <Button type="button" variant="outline" disabled={busy} onClick={onClose}>取消</Button>
        <Button type="submit" className="primary" disabled={saveDisabled || busy}>保存</Button>
      </div>
    </div>
  </form>
}
