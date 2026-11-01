import { Kbd } from '@/components/ui/kbd'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ArrowRightToLine } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { MAX_CUSTOM_PROMPT_LENGTH } from '../../../shared/models'

interface EditPromptFieldProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  hint: string
  placeholder: string
  disabled?: boolean
  suggestion?: string
}

export function EditPromptField({ id, label, value, onChange, hint, placeholder, disabled, suggestion }: EditPromptFieldProps): React.JSX.Element {
  const promptRef = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = promptRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`
  }, [value])
  const [focused, setFocused] = useState(false)
  const showSuggestion = Boolean(suggestion && focused && !value)
  return <div className="edit-info-field edit-info-prompt-field">
    <div className="edit-info-field-heading"><Label htmlFor={id}>{label}</Label><span>可选</span></div>
    <div className="custom-prompt-input" data-suggestion-visible={showSuggestion}>
      <Textarea ref={promptRef} id={id} className="edit-info-prompt" rows={1} maxLength={MAX_CUSTOM_PROMPT_LENGTH} value={value} placeholder={placeholder} disabled={disabled} aria-describedby={`${id}-hint`} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onChange={event => onChange(event.target.value)} onKeyDown={event => {
        if (suggestion && !value && event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && !event.nativeEvent.isComposing) {
          event.preventDefault()
          onChange(suggestion)
        }
      }} />
      {showSuggestion && <div className="custom-prompt-placeholder" aria-hidden="true">{suggestion} <Kbd><ArrowRightToLine size={12} />Tab</Kbd></div>}
    </div>
    <p id={`${id}-hint`} className="hint">{hint}</p>
  </div>
}
