import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, Download, FileArchive, FolderOpen, FolderPlus, Puzzle, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import type { LocalSkill } from '../../../../shared/skills'
import { unwrapModelResult } from '../../model-result'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Modal } from '@/components/ui/modal'
import { Tooltip } from 'radix-ui'
import { Tooltip as ShadcnTooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { PagedList } from '../PagedList'
import { Input } from '@/components/ui/input'

function SkillDescription({ text }: { text: string }): React.JSX.Element {
  const ref = useRef<HTMLParagraphElement>(null)
  const [truncated, setTruncated] = useState(false)
  const [open, setOpen] = useState(false)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => {
      const clipped = element.clientHeight > 0 && element.scrollHeight > element.clientHeight
      setTruncated(clipped)
      if (!clipped) setOpen(false)
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(element)
    return () => observer?.disconnect()
  }, [text])
  return <Tooltip.Root open={truncated && open} onOpenChange={setOpen}>
    <Tooltip.Trigger asChild><p ref={ref} className="skill-description" tabIndex={truncated ? 0 : undefined}>{text}</p></Tooltip.Trigger>
    {truncated && <Tooltip.Portal><Tooltip.Content className="skill-description-tooltip" side="top" align="start" sideOffset={6} collisionPadding={12}>{text}</Tooltip.Content></Tooltip.Portal>}
  </Tooltip.Root>
}

export function SkillsSettingsSection({ onBusyChange }: { onBusyChange(busy: boolean): void }): React.JSX.Element {
  const [skills, setSkills] = useState<LocalSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<LocalSkill | null>(null)
  const [query, setQuery] = useState('')
  const filtered = skills.filter(skill => `${skill.name} ${skill.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const load = async (): Promise<void> => {
    setLoading(true); setError('')
    try {
      setSkills(unwrapModelResult(await window.piRunner.getSkills()))
    }
    catch (e) { setError(e instanceof Error ? e.message : '技能读取失败，请重试') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  const change = async (action: () => Promise<LocalSkill[] | null>): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); onBusyChange(true); setError('')
    try {
      const result = await action()
      if (result) { setSkills(result); window.dispatchEvent(new Event('skills-changed')) }
    } catch (e) { setError(e instanceof Error ? e.message : '技能操作失败，请重试') }
    finally { busyRef.current = false; setBusy(false); onBusyChange(false) }
  }
  return <Tooltip.Provider delayDuration={300}>
    <div className="skills-heading"><h2>技能</h2>
      <div className="skills-actions">
        <Tooltip.Root>
          <Tooltip.Trigger asChild><Button variant="outline" size="icon" disabled={busy} aria-label="查看技能目录" onClick={() => void change(async () => { unwrapModelResult(await window.piRunner.openSkillsDirectory()); return null })}><FolderOpen size={16} /></Button></Tooltip.Trigger>
          <Tooltip.Portal><Tooltip.Content className="skills-action-tooltip" side="top" sideOffset={6}>查看目录</Tooltip.Content></Tooltip.Portal>
        </Tooltip.Root>
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" className="h-9 py-0" disabled={busy || loading}><FolderPlus size={16} />安装<ChevronDown size={14} /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" sideOffset={6}>
          <DropdownMenuItem onSelect={() => void change(async () => unwrapModelResult(await window.piRunner.installSkill('zip')))}><FileArchive size={16} />从 ZIP 压缩包安装</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void change(async () => unwrapModelResult(await window.piRunner.installSkill('directory')))}><FolderOpen size={16} />从文件夹安装</DropdownMenuItem>
        </DropdownMenuContent></DropdownMenu>
      </div>
    </div>
    <p className="section-description">支持 ZIP 或技能文件夹安装；安装同名技能会替换旧版本。启用后，模型会根据消息内容自动调用适用技能，也可在输入框中手动选择。</p>
    {error && !deleting && <p className="error" role="alert">{error}<Button variant="ghost" disabled={busy || loading} onClick={() => void load()}><RotateCcw size={14} />重新读取</Button></p>}
    {skills.length > 40 && <Input aria-label="搜索技能" placeholder="搜索技能名称或描述" value={query} onChange={event => setQuery(event.target.value)} />}
    {loading ? <p className="hint" role="status">正在读取本地技能…</p> : skills.length ? <PagedList items={filtered} label="技能" resetKey={query}>{page => <section className="settings-card skills-list" aria-label="已安装的本地技能">{page.map(skill => <div className="setting-row skill-setting-row" key={skill.id}>
      <div className="skill-row-info"><h3><Puzzle size={15} aria-hidden="true" />{skill.name}</h3><SkillDescription text={skill.description || '本地技能'} /></div>
      <div className="skill-row-actions"><Switch checked={skill.enabled} disabled={busy} aria-label={`启用技能 ${skill.name}`} onCheckedChange={enabled => void change(async () => unwrapModelResult(await window.piRunner.setSkillEnabled(skill.id, enabled)))} />
        <ShadcnTooltip><TooltipTrigger asChild><span className="inline-flex" tabIndex={busy ? 0 : undefined}><Button variant="ghost" size="icon" disabled={busy} aria-label={`导出技能 ${skill.name}`} onClick={() => void change(async () => { unwrapModelResult(await window.piRunner.exportSkill(skill.id)); return null })}><Download size={16} /></Button></span></TooltipTrigger><TooltipContent>导出技能</TooltipContent></ShadcnTooltip>
        <ShadcnTooltip><TooltipTrigger asChild><span className="inline-flex" tabIndex={busy ? 0 : undefined}><Button variant="ghost" size="icon" className="skill-delete-button" disabled={busy} aria-label={`删除技能 ${skill.name}`} onClick={() => setDeleting(skill)}><Trash2 size={16} /></Button></span></TooltipTrigger><TooltipContent>删除技能</TooltipContent></ShadcnTooltip>
      </div>
    </div>)}{!filtered.length && <p className="hint">没有匹配的技能。</p>}</section>}</PagedList> : !error && <div className="skills-empty"><Puzzle size={24} aria-hidden="true" /><h3>还没有安装技能</h3><p>安装本地技能后，可从消息输入框左下角的加号选择。</p></div>}
    {busy && <p className="hint" role="status">正在处理技能操作…</p>}
    <Modal open={Boolean(deleting)} onOpenChange={open => { if (!open && !busy) setDeleting(null) }} title={`删除技能「${deleting?.name ?? ''}」？`} description="将从技能根目录中永久删除该技能及其文件。" closeDisabled={busy}>
      <div className="modal-actions"><Button variant="outline" autoFocus disabled={busy} onClick={() => setDeleting(null)}>取消</Button><Button variant="destructive" disabled={busy} onClick={() => {
        if (deleting) void change(async () => { const result = unwrapModelResult(await window.piRunner.deleteSkill(deleting.id)); setDeleting(null); return result })
      }}>确认删除</Button></div>
      {error && <p className="error" role="alert">{error}</p>}
    </Modal>
  </Tooltip.Provider>
}
