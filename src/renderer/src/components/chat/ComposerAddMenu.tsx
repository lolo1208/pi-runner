import { useEffect, useState } from 'react'
import { Check, ChevronRight, FilePlus, Plus, Puzzle, Settings2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from '@/components/ui/dropdown-menu'
import type { LocalSkill } from '../../../../shared/skills'
import { unwrapModelResult } from '../../model-result'

export function useLocalSkills(): { skills: LocalSkill[]; error: string; loading: boolean; refresh(): void } {
  const [skills, setSkills] = useState<LocalSkill[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let current = true
    if (!window.piRunner?.getSkills) { setLoading(false); return }
    setLoading(true)
    void window.piRunner.getSkills().then(unwrapModelResult).then(value => { if (current) { setSkills(value); setError('') } }).catch(e => { if (current) setError(e instanceof Error ? e.message : '技能读取失败，请重试') }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [revision])
  useEffect(() => {
    const refresh = (): void => setRevision(value => value + 1)
    window.addEventListener('skills-changed', refresh)
    return () => window.removeEventListener('skills-changed', refresh)
  }, [])
  return { skills, error, loading, refresh: () => setRevision(value => value + 1) }
}

export function ComposerSkillTags({ ids, skills, disabled, onChange }: { ids: string[]; skills: LocalSkill[]; disabled?: boolean; onChange(ids: string[]): void }): React.JSX.Element | null {
  if (!ids.length) return null
  return <div className="composer-skill-tags" aria-label="已选择的技能">{ids.map(id => {
    const skill = skills.find(item => item.id === id)
    const name = skill?.name ?? '不可用的技能'
    return <span className="composer-skill-tag" key={id}><Puzzle size={13} aria-hidden="true" /><span>{name}{skill && !skill.enabled ? '（已禁用）' : ''}</span><Button type="button" variant="ghost" size="icon" disabled={disabled} aria-label={`移除技能 ${name}`} onClick={() => onChange(ids.filter(value => value !== id))}><X size={12} /></Button></span>
  })}</div>
}

export function ComposerAddMenu({ available, ids, onChange, onAddFiles, onConfigureSkills, filesDisabled, disabled }: { available: ReturnType<typeof useLocalSkills>; ids: string[]; onChange(ids: string[]): void; onAddFiles(): void; onConfigureSkills(): void; filesDisabled: boolean; disabled?: boolean }): React.JSX.Element {
  const [selectedPage, setPage] = useState(0)
  const enabled = available.skills.filter(skill => skill.enabled)
  const pages = Math.max(1, Math.ceil(enabled.length / 40))
  const page = Math.min(selectedPage, pages - 1)
  return <Tooltip><DropdownMenu onOpenChange={open => { if (open) { available.refresh(); setPage(0) } }}><TooltipTrigger asChild><DropdownMenuTrigger asChild><Button type="button" className="attach-image-button" aria-label="添加附件" disabled={disabled}><Plus size={17} /></Button></DropdownMenuTrigger></TooltipTrigger>
    <DropdownMenuContent side="top" align="start" sideOffset={8}>
      <DropdownMenuItem disabled={filesDisabled} onSelect={onAddFiles}><FilePlus size={16} />添加图片或其他文件</DropdownMenuItem>
      <DropdownMenuSub><DropdownMenuSubTrigger><Puzzle size={16} />选择技能<ChevronRight className="skill-menu-chevron" size={14} /></DropdownMenuSubTrigger><DropdownMenuSubContent sideOffset={4} className="composer-skills-menu">
        {available.error ? <><div className="file-context-menu-error" role="alert">{available.error}</div><DropdownMenuItem onSelect={event => { event.preventDefault(); available.refresh() }}>重新读取</DropdownMenuItem></> : enabled.length ? enabled.slice(page * 40, (page + 1) * 40).map(skill => <Tooltip key={skill.id}><TooltipTrigger asChild><DropdownMenuItem onSelect={() => onChange(ids.includes(skill.id) ? ids.filter(id => id !== skill.id) : [...ids, skill.id])} disabled={!ids.includes(skill.id) && ids.length >= 32}><Puzzle size={14} /><span className="skill-menu-name">{skill.name}</span>{ids.includes(skill.id) && <Check size={14} aria-label="已选择" />}</DropdownMenuItem></TooltipTrigger>{skill.description && <TooltipContent side="right">{skill.description}</TooltipContent>}</Tooltip>) : <DropdownMenuItem disabled>{available.loading ? '正在读取技能…' : '暂无已启用的技能，请在设置中安装或启用'}</DropdownMenuItem>}
        {pages > 1 && <><DropdownMenuItem disabled={page === 0} onSelect={event => { event.preventDefault(); setPage(page - 1) }}>上一页技能</DropdownMenuItem><div className="hint" role="status">第 {page + 1} / {pages} 页 · 输入 / 可搜索全部技能</div><DropdownMenuItem disabled={page === pages - 1} onSelect={event => { event.preventDefault(); setPage(page + 1) }}>下一页技能</DropdownMenuItem></>}
        <DropdownMenuItem onSelect={onConfigureSkills}><Settings2 size={14} />配置技能</DropdownMenuItem>
      </DropdownMenuSubContent></DropdownMenuSub>
    </DropdownMenuContent>
  </DropdownMenu><TooltipContent side="top" sideOffset={6}>添加图片、其他文件或技能</TooltipContent></Tooltip>
}
