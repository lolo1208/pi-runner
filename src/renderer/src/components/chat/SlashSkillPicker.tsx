import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Check, Puzzle } from 'lucide-react'
import type { LocalSkill } from '../../../../shared/skills'
import type { useLocalSkills } from './ComposerAddMenu'
import { Button } from '@/components/ui/button'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'

interface SlashQuery { start: number; end: number; query: string }

/** 仅在独立词开头识别斜杠，避免网址和文件路径触发技能菜单。 */
function slashQuery(prompt: string, caret: number): SlashQuery | null {
  if (caret < 0) return null
  const match = /(?:^|\s)\/([^/\s]*)$/.exec(prompt.slice(0, caret))
  if (!match) return null
  return { start: caret - match[1].length - 1, end: caret, query: match[1] }
}

export function useSlashSkillPicker({ prompt, textareaRef, available, skillIds, onSkillsChange, onPromptChange, disabled }: {
  prompt: string
  textareaRef: RefObject<HTMLTextAreaElement | null>
  available: ReturnType<typeof useLocalSkills>
  skillIds: string[]
  onSkillsChange(ids: string[]): void
  onPromptChange(prompt: string): void
  disabled: boolean
}) {
  const listId = useId()
  const [caret, setCaret] = useState(0)
  const [focused, setFocused] = useState(false)
  const [composing, setComposing] = useState(false)
  const [dismissedStart, setDismissedStart] = useState<number | null>(null)
  const [highlight, setHighlight] = useState({ query: '', index: 0 })
  const candidate = focused && !composing && !disabled ? slashQuery(prompt, caret) : null
  const query = candidate?.start === dismissedStart ? null : candidate
  const key = query ? `${query.start}:${query.query.toLocaleLowerCase()}` : ''
  const skills = query ? available.skills.filter(skill => skill.enabled && skill.name.toLocaleLowerCase().includes(query.query.toLocaleLowerCase()) && (skillIds.includes(skill.id) || skillIds.length < 32)) : []
  const activeIndex = highlight.query === key ? Math.min(highlight.index, Math.max(0, skills.length - 1)) : 0
  const activeSkill = skills[activeIndex]
  const open = Boolean(query)

  useEffect(() => { if (open) available.refresh() }, [open])

  const updateCaret = (): void => {
    const textarea = textareaRef.current
    if (!textarea) return
    setCaret(textarea.selectionStart === textarea.selectionEnd ? textarea.selectionStart : -1)
  }
  const select = (skill: LocalSkill): void => {
    if (!query) return
    if (!skillIds.includes(skill.id)) onSkillsChange([...skillIds, skill.id])
    onPromptChange(prompt.slice(0, query.start) + prompt.slice(query.end))
    setCaret(query.start); setDismissedStart(query.start)
    requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true })
      textareaRef.current?.setSelectionRange(query.start, query.start)
    })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!query || event.nativeEvent.isComposing || event.keyCode === 229) return false
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDismissedStart(query.start); return true }
    if (event.key === 'Enter') { event.preventDefault(); if (activeSkill) select(activeSkill); return true }
    if ((event.key === 'Tab' || event.key === 'ArrowDown' || event.key === 'ArrowUp') && skills.length && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      const direction = event.key === 'ArrowUp' || event.key === 'Tab' && event.shiftKey ? -1 : 1
      setHighlight({ query: key, index: (activeIndex + direction + skills.length) % skills.length })
      return true
    }
    return false
  }
  return {
    popup: query ? <SlashSkillPicker listId={listId} anchor={textareaRef} skills={skills} activeIndex={activeIndex} selectedIds={skillIds} error={available.error} loading={available.loading} retry={available.refresh} onSelect={select} onHighlight={index => setHighlight({ query: key, index })} /> : null,
    inputProps: {
      'aria-controls': open ? listId : undefined,
      'aria-expanded': open,
      'aria-autocomplete': 'list' as const,
      'aria-activedescendant': open && activeSkill ? `${listId}-${activeSkill.id}` : undefined,
      onFocus: () => { setFocused(true); updateCaret() },
      onBlur: () => setFocused(false),
      onSelect: updateCaret,
      onCompositionStart: () => setComposing(true),
      onCompositionEnd: () => { setComposing(false); updateCaret() }
    },
    onChange: () => {
      const textarea = textareaRef.current
      setFocused(document.activeElement === textarea)
      if (textarea && dismissedStart !== null && textarea.value[dismissedStart] !== '/') setDismissedStart(null)
      updateCaret()
    },
    onKeyDown
  }
}

function SlashSkillPicker({ listId, anchor, skills, activeIndex, selectedIds, error, loading, retry, onSelect, onHighlight }: {
  listId: string; anchor: RefObject<HTMLTextAreaElement | null>; skills: LocalSkill[]; activeIndex: number; selectedIds: string[]
  error: string; loading: boolean; retry(): void; onSelect(skill: LocalSkill): void; onHighlight(index: number): void
}): React.JSX.Element {
  const popupRef = useRef<HTMLDivElement>(null)
  const virtualRef = useRef<VirtuosoHandle>(null)
  const [position, setPosition] = useState({ left: 0, bottom: 0, width: 360, maxHeight: 320 })
  useLayoutEffect(() => {
    const textarea = anchor.current
    const composer = textarea?.closest('form')
    if (!composer) return
    const place = (): void => {
      const rect = composer.getBoundingClientRect()
      const width = Math.min(420, rect.width, window.innerWidth - 16)
      setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), bottom: window.innerHeight - rect.top + 8, width, maxHeight: Math.max(80, Math.min(360, rect.top - 16)) })
    }
    place()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    observer?.observe(composer)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { observer?.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [anchor])
  useEffect(() => {
    if (skills.length > 40) virtualRef.current?.scrollIntoView({ index: activeIndex })
    else popupRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIndex, skills[activeIndex]?.id, skills.length > 40])
  const renderSkill = (index: number, skill: LocalSkill): React.JSX.Element => <div key={skill.id} id={`${listId}-${skill.id}`} role="option" aria-selected={index === activeIndex} aria-posinset={index + 1} aria-setsize={skills.length} className="slash-skill-option" onMouseMove={() => onHighlight(index)} onClick={() => onSelect(skill)}>
    <Puzzle size={16} aria-hidden="true" /><div><span className="slash-skill-name">{skill.name}</span>{skill.description && <p>{skill.description}</p>}</div>{selectedIds.includes(skill.id) && <Check size={15} aria-label="已选择" />}
  </div>

  return createPortal(<div ref={popupRef} className="slash-skill-picker file-context-menu" style={position} onMouseDown={event => event.preventDefault()}>
    <div className="slash-skill-heading"><span>选择技能</span><span>Tab 切换 · Enter 选中 · Esc 关闭</span></div>
    <div id={listId} role="listbox" aria-label="已启用的技能" className="slash-skill-options">
      {error ? <div className="slash-skill-empty" role="alert">{error}<Button type="button" variant="ghost" size="sm" onClick={retry}>重新读取</Button></div> : skills.length > 40 ? <Virtuoso ref={virtualRef} data={skills} style={{ height: Math.max(54, position.maxHeight - 54) }} defaultItemHeight={54} increaseViewportBy={100} computeItemKey={(_, skill) => skill.id} itemContent={renderSkill} />
        : skills.length ? skills.map((skill, index) => renderSkill(index, skill)) : <p className="slash-skill-empty" role="status">{loading ? '正在读取技能…' : '没有匹配的已启用技能'}</p>}
    </div>
  </div>, document.body)
}
