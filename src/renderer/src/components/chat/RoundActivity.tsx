import { useEffect, useRef, useState } from 'react'
import { Check, ChevronRight, CirclePause, Clock, Layers, LoaderCircle, Sparkles, X } from 'lucide-react'
import type { ChatExecution, ChatMessage, ChatWorkItem } from '../../../../shared/models'
import { Button } from '../ui/button'
import { ExecutionLabel, formatExecutionDuration } from './ExecutionLabel'
import { ChatMarkdown } from './ChatMarkdown'
import { TranscriptScope, useTranscriptState } from './TranscriptState'
import { TranscriptPagedList } from './TranscriptPagedList'
import { hasPlanResult, PlanResultCard } from './PlanResultCard'

const toolLabels: Record<string, string> = { bash: '运行命令', powershell: '运行命令', read: '读取文件', write: '写入文件', download: '下载文件', edit: '编辑文件', delete: '删除文件', mkdir: '创建目录', rmdir: '删除目录', move: '移动或重命名', copy: '复制文件或目录', stat: '查看文件或目录信息', ls: '查看目录', find: '查找文件或目录', grep: '搜索内容', read_skill_file: '读取技能文件', report_skill_usage: '说明技能用途', ask_user_question: '确认需求', submit_plan: '提交计划' }

function WorkItem({ item, busy = false }: { item: ChatWorkItem; busy?: boolean }): React.JSX.Element {
  const [open, setOpen] = useTranscriptState('work-open', false)
  const label = item.kind === 'thinking' ? '思考' : toolLabels[item.name ?? ''] ?? item.name ?? '工具调用'
  const preview = item.kind === 'thinking' ? item.content : String(item.args?.command ?? item.args?.path ?? item.args?.file ?? JSON.stringify(item.args ?? {}))
  const interrupted = item.state === 'interrupted' || (!busy && !item.completed && item.kind === 'tool')
  const waiting = busy && !item.completed && (item.state === 'queued' || item.state === 'waiting')
  const stateText = item.isError ? '执行失败' : interrupted ? '未完成' : waiting ? item.stateText ?? (item.state === 'queued' ? '等待执行' : '等待确认') : ''
  const command = item.name === 'bash' || item.name === 'powershell'
  return <div className="chat-work-item">
    <Button variant="ghost" className="chat-work-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
      {item.kind === 'thinking' ? <Sparkles size={14} /> : item.isError ? <X size={14} /> : item.completed ? <Check size={14} /> : interrupted ? <CirclePause size={14} aria-label="未完成" /> : waiting ? <Clock size={14} aria-label={stateText} /> : <LoaderCircle size={14} className="chat-execution-spinner" aria-label="正在执行" />}
      <span className="chat-work-summary"><span>{label}{stateText ? ` · ${stateText}` : ''}</span>{item.skillName && <span className="chat-work-skill-name" title={item.skillName}>· {item.skillName}</span>}<small title={preview}>{preview}</small></span>
      <ChevronRight size={14} className={open ? 'chat-disclosure-chevron open' : 'chat-disclosure-chevron'} />
    </Button>
    {open && <div className="chat-work-detail">
      {item.kind === 'tool' && <><div className="chat-work-detail-label">{command ? '命令' : '输入参数'}</div><pre>{command ? String(item.args?.command ?? '') : JSON.stringify(item.args, null, 2)}</pre><div className="chat-work-detail-label">执行结果</div></>}
      <pre>{item.content || (item.completed ? '无文本输出' : stateText || '正在执行，等待结果…')}</pre>
    </div>}
  </div>
}

interface CallGroup { start: number; messages: ChatMessage[] }

/** 正文输出结束当前组；跨分页先分组，避免连续调用被页边界拆开。 */
function groupCalls(messages: ChatMessage[]): CallGroup[] {
  const groups: CallGroup[] = []
  messages.forEach((message, index) => {
    const previous = groups.at(-1)
    if (previous && !previous.messages.at(-1)?.content.trim()) previous.messages.push(message)
    else groups.push({ start: index, messages: [message] })
  })
  return groups
}

function CallActivity({ group, executing = false, status }: { group: CallGroup; executing?: boolean; status?: string }): React.JSX.Element {
  const [open, setOpen] = useTranscriptState('call-open', false)
  const activeIndex = executing ? group.start + group.messages.length - 1 : undefined
  // 执行中的调用尚无耗时记录，从成为当前调用起本地计时，避免显示上一次调用的耗时。
  const startedRef = useRef<number | undefined>(undefined)
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    if (!executing) { startedRef.current = undefined; return }
    startedRef.current = performance.now()
    setNow(performance.now())
    const timer = setInterval(() => setNow(performance.now()), 1000)
    return () => clearInterval(timer)
  }, [activeIndex])
  const completed = executing ? group.messages.slice(0, -1) : group.messages
  const recordedMs = completed.reduce((sum, message) => sum + (message.call?.elapsedMs ?? 0), 0)
  const missingDuration = completed.some(message => message.call?.elapsedMs === undefined)
  const runningMs = executing && startedRef.current !== undefined ? now - startedRef.current : undefined
  const duration = `${executing ? '已耗时' : '耗时'} ${missingDuration ? '未记录' : formatExecutionDuration(recordedMs + (runningMs ?? 0))}`
  const currentStatus = status || '正在等待模型回复…'
  return <div className="chat-call">
    <Button variant="ghost" className="chat-call-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
      {executing ? <LoaderCircle size={14} className="chat-execution-spinner" aria-label="正在执行" /> : <Layers size={14} />}<span>{duration}</span>{group.messages.length > 1 && <span className="chat-call-count" aria-label={`${group.messages.length} 次调用`}>{group.messages.length}</span>}<ChevronRight size={14} className={open ? 'chat-disclosure-chevron open' : 'chat-disclosure-chevron'} />
    </Button>
    {open && <div className="chat-work-list"><TranscriptPagedList preferLatest={executing} items={group.messages} label="组内调用记录">{(page, start) => page.map((message, offset) => <TranscriptScope key={start + offset} id={`call:${group.start + start + offset}`}>
      {message.call?.work.length ? <TranscriptPagedList preferLatest={executing && start + offset === group.messages.length - 1} items={message.call.work} label="工具记录">{work => work.map(item => <TranscriptScope key={item.id} id={`work:${item.id}`}><WorkItem item={item} busy={executing && start + offset === group.messages.length - 1} /></TranscriptScope>)}</TranscriptPagedList> : !(executing && start + offset === group.messages.length - 1) && <p className="chat-call-empty">{message.call ? '本次调用仅生成回复，没有工具执行或可展示的思考记录。' : '此历史调用未保存工作详情。'}</p>}
    </TranscriptScope>)}</TranscriptPagedList>
      {executing && <div className="chat-work-item" role="status" aria-live="polite">
        <div className="chat-work-progress"><LoaderCircle size={14} className="chat-execution-spinner" aria-hidden="true" /><span>{currentStatus}</span></div>
      </div>}
    </div>}
  </div>
}

export function RoundActivity({ project, messages, execution, startedAt, status, busy = false, initiallyOpen = true }: { project?: string | null; messages: ChatMessage[]; execution?: ChatExecution; startedAt?: number; status?: string; busy?: boolean; initiallyOpen?: boolean }): React.JSX.Element {
  const [disclosure, setDisclosure] = useTranscriptState('round-open', { busy, open: busy && initiallyOpen })
  const open = disclosure.busy === busy ? disclosure.open : busy && initiallyOpen
  useEffect(() => {
    if (disclosure.busy !== busy) setDisclosure({ busy, open: busy && initiallyOpen })
  }, [busy, disclosure.busy, initiallyOpen, setDisclosure])
  const final = messages.at(-1)
  const groups = groupCalls(messages)
  const hasPlanCards = messages.some(message => message.call?.work.some(hasPlanResult))
  return <>
    <Button variant="ghost" className="chat-round-toggle" aria-expanded={open} onClick={() => setDisclosure({ busy, open: !open })}>
      <ExecutionLabel execution={execution ?? final?.execution} startedAt={startedAt} status={status} busy={busy} /><ChevronRight size={14} className={open ? 'chat-disclosure-chevron open' : 'chat-disclosure-chevron'} />
    </Button>
    {open && busy && !groups.length && <div className="chat-round-calls">
      <div className="chat-work-item" role="status" aria-live="polite"><div className="chat-work-progress"><LoaderCircle size={14} className="chat-execution-spinner" aria-hidden="true" /><span>{status || '正在等待模型回复…'}</span></div></div>
    </div>}
    {open && groups.length > 0 && <div className="chat-round-calls"><TranscriptPagedList preferLatest={busy} items={groups} label="调用记录">{page => page.map(group => { const message = group.messages.at(-1)!; const index = group.start + group.messages.length - 1; return <TranscriptScope id={`call:${group.start}`} key={group.start}><div className="chat-call-section">
      <CallActivity group={group} executing={busy && index === messages.length - 1} status={status} />
      {!hasPlanCards && message.content && (busy || index < messages.length - 1) && <ChatMarkdown project={project} content={message.content} snapshotId={message.codeSnapshotId} />}
    </div></TranscriptScope> })}</TranscriptPagedList></div>}
    {hasPlanCards ? <div className="chat-round-result plan-round-results">{messages.map((message, index) => <TranscriptScope key={index} id={`plan-call:${index}`}>
      {message.content && <ChatMarkdown project={project} content={message.content} snapshotId={message.codeSnapshotId} />}
      {message.call?.work.filter(hasPlanResult).map(item => <TranscriptScope key={item.id} id={`plan-result:${item.id}`}><PlanResultCard item={item} project={project} /></TranscriptScope>)}
    </TranscriptScope>)}</div> : !busy && final?.content && <div className="chat-round-result"><ChatMarkdown project={project} content={final.content} snapshotId={final.codeSnapshotId} /></div>}
  </>
}
