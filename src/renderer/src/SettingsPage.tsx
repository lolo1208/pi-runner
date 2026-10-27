import { useState } from 'react'
import { ArrowLeft, Settings, Palette, Boxes, Info, Search, Puzzle } from 'lucide-react'
import type { ModelSettings } from '../../shared/models'
import type { Preferences } from './preferences'
import ModelSettingsPanel from './ModelSettingsPanel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AboutSettingsSection, AppearanceSettingsSection, GeneralSettingsSection } from './components/settings/SettingsSections'
import { SkillsSettingsSection } from './components/settings/SkillsSettingsSection'

interface Props {
  settings: ModelSettings | null; error: string; reload(): void
  onChange(settings: ModelSettings): void; onClose(): void
  preferences: Preferences; onPreferences(value: Preferences): void
  initialSection: string
}
const sections = [
  { id: 'general', label: '通用', icon: Settings, keywords: '默认 模型 审核 自审 全局 提示词 指令 压缩 阈值 差异 对比 内联 分栏 快照 快捷键 Ctrl Enter 换行 发送' },
  { id: 'appearance', label: '外观', icon: Palette, keywords: '主题 浅色 深色 跟随系统 字体' },
  { id: 'models', label: '模型供应商', icon: Boxes, keywords: 'API Key 模型 参数 服务商 配置 超时 Temperature Token Base URL 协议' },
  { id: 'skills', label: '技能', icon: Puzzle, keywords: 'Skill 本地 安装 启用 禁用' },
  { id: 'about', label: '关于', icon: Info, keywords: '版本 存储 工具 安全 自审 差异 快照' }
]
export default function SettingsPage(props: Props): React.JSX.Element {
  const [section, setSection] = useState(props.initialSection)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform) || navigator.userAgent.includes('Macintosh')
  return <div className="settings-layout">
    <aside className="settings-nav">
      <Button variant="ghost" className="settings-back" disabled={busy} onClick={props.onClose}><ArrowLeft size={19} /><span>设置</span></Button>
      <div className="search-field"><Search size={15} /><Input aria-label="搜索设置" placeholder="搜索设置" value={query} onChange={e => setQuery(e.target.value)} /></div>
      <nav aria-label="设置分类">{sections.filter(item => `${item.label} ${item.keywords}`.toLowerCase().includes(query.trim().toLowerCase())).map(item => <Button key={item.id} disabled={busy} className={section === item.id ? 'selected' : ''} aria-current={section === item.id ? 'page' : undefined} onClick={() => setSection(item.id)}><item.icon size={16} />{item.label}</Button>)}</nav>
      {query && !sections.some(item => `${item.label} ${item.keywords}`.toLowerCase().includes(query.trim().toLowerCase())) && <p className="hint">没有匹配的设置</p>}
    </aside>
    <main className="settings-content">
      <div className="settings-inner">
        {section === 'models' ? props.settings ? <ModelSettingsPanel settings={props.settings} onChange={props.onChange} onClose={props.onClose} onBusyChange={setBusy} /> : <><h2>模型供应商</h2><p className={props.error ? 'error' : 'hint'} role="status">{props.error || '正在读取模型配置…'}</p>{props.error && <Button onClick={props.reload}>重新读取设置</Button>}</> : null}
        {section === 'general' && <><GeneralSettingsSection preferences={props.preferences} onPreferences={props.onPreferences} isMac={isMac} settings={props.settings} onModelSettingsChange={props.onChange} onBusyChange={setBusy} />{props.error && <p className="error" role="alert">{props.error}<Button onClick={props.reload}>重新读取设置</Button></p>}</>}
        {section === 'appearance' && <AppearanceSettingsSection preferences={props.preferences} onPreferences={props.onPreferences} />}
        {section === 'skills' && <SkillsSettingsSection onBusyChange={setBusy} />}
        {section === 'about' && <AboutSettingsSection />}
      </div>
    </main>
  </div>
}



