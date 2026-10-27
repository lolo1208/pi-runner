import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { memoWithStableCallbacks } from './lib/memo-with-callbacks'
import { useDraftSync } from './hooks/useDraftSync'
import { StreamTextBuffer } from './lib/stream-text-buffer'
import type { QueueEditState } from '../../shared/conversations'
import type { ChatgptUsage, OpenrouterUsage, ChatImage, ChatMessage, ModelProfile, ModelProfileView, ModelProviderConnection, ModelReply, ModelSettings, OutputSpeed, ProviderId } from '../../shared/models'
import { unwrapModelResult } from './model-result'
import { ChatComposer } from './components/chat/ChatComposer'
import type { QueuedMessage } from './components/chat/MessageQueue'
import { ChatTranscript } from './components/chat/ChatTranscript'
import { ComposerStatus } from './components/chat/ComposerStatus'
import { DEFAULT_COMPRESSION_THRESHOLD, contextMessages, type ContextCompaction } from '../../shared/context'
import type { PermissionMode, ToolApproval } from '../../shared/models'
import { ToolApprovalCard } from './components/chat/ToolApprovalCard'
import { ToolApprovalDiffDialog } from './components/chat/ToolApprovalDiffDialog'
import { CommandApprovalDialog } from './components/chat/CommandApprovalDialog'
import { isCommandApproval } from './lib/tool-approval'
import { FullAccessDialog } from './components/chat/FullAccessDialog'
import { PlanDialog } from './components/chat/PlanDialog'
import { Button } from './components/ui/button'
import type { IntentMode, PlanInteraction } from '../../shared/models'
import { LoaderCircle } from 'lucide-react'
import { PagedList } from './components/PagedList'

interface Props {
  snapshots?: import('../../shared/models').AgentSnapshot[]
  onSnapshotsChange?(snapshots: import('../../shared/models').AgentSnapshot[]): void
  initialIntentMode?: IntentMode
  onIntentChange?(mode: IntentMode): void
  initialPermissionMode?: PermissionMode
  onPermissionChange?(mode: PermissionMode): void
  active?: boolean
  notificationNavigationRequest?: number
  projectReady?: boolean
  projectCurrent?: boolean
  conversationId?: string
  initialMessages?: ChatMessage[]; initialDraft?: string; initialDraftImages?: ChatImage[]
  initialDraftSkillIds?: string[]
  onDraftChange?(draft: string, images: ChatImage[], skillIds: string[]): void
  initialQueue?: QueuedMessage[]
  initialQueuePaused?: boolean
  initialQueueEdit?: QueueEditState
  onQueueChange?(queue: QueuedMessage[], paused: boolean, edit?: QueueEditState): void
  profiles?: ModelProfileView[]
  customPrompt?: string
  compressionThreshold?: number; initialCompaction?: ContextCompaction
  onCompactionChange?(compaction: ContextCompaction | undefined): void
  /** 会话内已保存的模型；为空时回退到默认模型 */
  initialModelId?: string | null
  onModelChange?(modelId: string): void
  onReplyComplete?(): void
  onTaskEnd?(ok: boolean, userInput: string): void
  onWaitingForInputChange?(waiting: boolean, reason?: 'plan-question' | 'plan-review' | 'approval'): void
  project?: string | null; providers?: ModelProviderConnection[]
  /** 快捷面板改完推理档位后回传新的模型设置，由顶层刷新。 */
  onModelSettingsChange?(settings: ModelSettings): void
  profile: ModelProfileView | undefined; onBusyChange(busy: boolean, historyOnly?: boolean): void; onOpenSettings(section?: 'models' | 'skills'): void
  onMessagesChange?(messages: ChatMessage[], restored?: boolean): void; settingsDisabled?: boolean; sendWithCtrlEnter?: boolean
}
function ModelChat({ notificationNavigationRequest = 0, snapshots, onSnapshotsChange, initialIntentMode = 'execute', onIntentChange, initialPermissionMode = 'default', onPermissionChange, active = true, projectReady = true, projectCurrent = true, conversationId, initialMessages = [], initialDraft = '', initialDraftImages = [], initialDraftSkillIds = [], initialQueue = [], initialQueuePaused = false, initialQueueEdit, onQueueChange, initialCompaction, onCompactionChange, compressionThreshold = DEFAULT_COMPRESSION_THRESHOLD, onDraftChange, profile: defaultProfile, profiles, project, providers, onModelSettingsChange, onBusyChange, onReplyComplete, onTaskEnd, onWaitingForInputChange, onOpenSettings, onMessagesChange, initialModelId, onModelChange, settingsDisabled, sendWithCtrlEnter = true, customPrompt = '' }: Props): React.JSX.Element {
  const [permissionMode, setPermissionMode] = useState(initialPermissionMode)
  const [intentMode, setIntentMode] = useState<IntentMode>(initialIntentMode)
  const intentCallback = useRef(onIntentChange)
  intentCallback.current = onIntentChange
  const changeIntent = (mode: IntentMode): void => { setIntentMode(mode); intentCallback.current?.(mode) }
  const [interaction, setInteraction] = useState<PlanInteraction | null>(null)
  const [interactionOpen, setInteractionOpen] = useState(true)
  const [planProgress, setPlanProgress] = useState('')
  const [approvals, setApprovals] = useState<ToolApproval[]>([])
  const [approvalDetailsOpen, setApprovalDetailsOpen] = useState(false)
  const [commandApproval, setCommandApproval] = useState<ToolApproval | null>(null)
  /** 勾选“重复不再提醒”后，本次对话按同一决定自动回应后续命令审批。 */
  const [approvalRepeat, setApprovalRepeat] = useState(false)
  const [autoApproval, setAutoApproval] = useState<boolean | null>(null)
  const autoDecision = useRef<boolean | null>(null)
  const [permissionChanging, setPermissionChanging] = useState(false)
  const [fullConfirmation, setFullConfirmation] = useState<{ requestId: string; approval: ToolApproval } | null>(null)
  const waitingForInput = Boolean(interaction || approvals.length || fullConfirmation)
  const waitingReason: 'plan-question' | 'plan-review' | 'approval' | undefined = interaction
    ? interaction.kind === 'questions' ? 'plan-question' : 'plan-review'
    : fullConfirmation || approvals.length ? 'approval' : undefined
  const waitingCallback = useRef(onWaitingForInputChange)
  waitingCallback.current = onWaitingForInputChange
  useEffect(() => { waitingCallback.current?.(waitingForInput, waitingReason) }, [waitingForInput])
  useEffect(() => () => { waitingCallback.current?.(false) }, [])
  const [selectedModelId, setSelectedModelId] = useState<string | null>(initialModelId ?? defaultProfile?.id ?? null)
  /**
   * 默认模型仅作为初始值：后续默认设置变化不影响已打开的会话。
   * 用户在会话内选择的模型通过 onModelChange 持久化到会话数据。
   */
  const defaultModelId = useRef(defaultProfile?.id ?? null)
  const availableProfiles = useMemo(() => profiles ?? (defaultProfile ? [defaultProfile] : []), [profiles, defaultProfile])
  const usableProfiles = availableProfiles.filter(item => item.enabled !== false && item.available !== false)
  const profile = usableProfiles.find(item => item.id === selectedModelId)
    ?? usableProfiles.find(item => item.id === (selectedModelId ? defaultModelId.current : selectedModelId)) ?? usableProfiles[0]
  useEffect(() => {
    if (profile && profile.id !== selectedModelId) setSelectedModelId(profile.id)
  }, [profile?.id, selectedModelId])
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [deletingRound, setDeletingRound] = useState(false)
  const deletionRunning = useRef(false)
  const [scrollToLatestRequest, setScrollToLatestRequest] = useState(0)
  const [compaction, setCompaction] = useState(initialCompaction)
  const [prompt, setPrompt] = useState(initialDraft)
  const [images, setImages] = useState<ChatImage[]>(initialDraftImages)
  const [skillIds, setSkillIds] = useState<string[]>(initialDraftSkillIds)
  const draftSync = useDraftSync(prompt, images, skillIds, active, onDraftChange)
  const [queue, setQueue] = useState<QueuedMessage[]>(initialQueue)
  const [editingId, setEditingId] = useState<string | null>(() => initialQueue.find(item => item.id === initialQueueEdit?.id)?.id ?? null)
  const [queuePaused, setQueuePaused] = useState(initialQueueEdit?.paused ?? initialQueuePaused)
  const savedDraft = useRef<QueueEditState['draft'] | null>(initialQueueEdit?.draft ?? null)
  const queueEdit = useMemo<QueueEditState | undefined>(() => editingId && savedDraft.current
    ? { id: editingId, draft: savedDraft.current, paused: queuePaused } : undefined, [editingId, queuePaused])
  const restoreDraft = (): void => {
    draftSync.immediate.current = true
    setPrompt(savedDraft.current?.prompt ?? ''); setImages(savedDraft.current?.images ?? [])
    setSkillIds(savedDraft.current?.skillIds ?? [])
    savedDraft.current = null; setEditingId(null)
  }
  const editQueued = (id: string): void => {
    const item = queue.find(item => item.id === id)
    if (!item) return
    if (editingId) return
    draftSync.immediate.current = true
    savedDraft.current = { prompt, images, skillIds }
    setEditingId(id); setPrompt(item.content); setImages(item.images ?? [])
    setSkillIds(item.skillIds ?? [])
  }
  const deleteQueued = (id: string): void => {
    setQueue(items => items.filter(item => item.id !== id))
    if (editingId === id) restoreDraft()
    if (queue.length === 1) setQueuePaused(false)
  }
  const reorderQueued = (id: string, targetId: string): void => {
    setQueue(items => {
      const from = items.findIndex(item => item.id === id), to = items.findIndex(item => item.id === targetId)
      if (from < 0 || to < 0 || from === to) return items
      const next = [...items]
      next.splice(to, 0, next.splice(from, 1)[0])
      return next
    })
  }
  const submit = (): void => {
    if (!prompt.trim() && !images.length) return
    if (editingId) {
      setQueue(items => items.map(item => item.id === editingId ? { ...item, content: prompt.trim(), images, skillIds } : item))
      restoreDraft()
    } else {
      if (!profile || permissionChanging || settingsDisabled || !projectReady) return
      draftSync.immediate.current = true
      setQueue(items => [...items, { id: crypto.randomUUID(), role: 'user', content: prompt.trim(), ...(images.length ? { images } : {}), ...(skillIds.length ? { skillIds } : {}) }])
      setPrompt(''); setImages([])
      setSkillIds([])
    }
  }
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [requestId, setRequestId] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)
  const stoppingRequest = useRef<string | null>(null)
  const changePermission = useCallback(async (mode: PermissionMode): Promise<void> => {
    if (!conversationId) return
    setPermissionChanging(true)
    try {
      const selected = unwrapModelResult(await window.piRunner.setPermissionMode(conversationId, mode))
      setPermissionMode(selected); onPermissionChange?.(selected)
    } catch (e) { setError(e instanceof Error ? e.message : '权限切换失败，请重试') }
    finally { setPermissionChanging(false) }
  }, [conversationId, onPermissionChange])
  /** 快捷面板内的推理修改：按设置页的字段归一规则只重写推理相关字段，其余参数原样保存。 */
  const changeThinking = useCallback(async (target: ModelProfileView, value: boolean | string | null): Promise<void> => {
    if (target.provider !== 'chatgpt' && target.provider !== 'ollama' && target.provider !== 'openrouter') return
    const { hasApiKey: _hasApiKey, available: _available, ...base } = target
    const next: ModelProfile = { ...base,
      thinkingLevel: (target.provider === 'chatgpt' || target.provider === 'openrouter') && typeof value === 'string' ? value as ModelProfile['thinkingLevel'] : null,
      ollamaThinkingLevel: target.provider === 'ollama' && typeof value === 'string' ? value : null,
      thinking: typeof value === 'boolean' ? value : null }
    try {
      const settings = unwrapModelResult(await window.piRunner.saveModelProfile({ profile: next, credential: { action: 'keep' } }))
      onModelSettingsChange?.(settings)
    } catch (e) { setError(e instanceof Error ? e.message : '推理强度保存失败，请重试') }
  }, [onModelSettingsChange])
  const getApprovalPreview = useCallback(async (approval: ToolApproval) => {
    if (!requestId || !conversationId) throw new Error('审批请求已失效')
    return unwrapModelResult(await window.piRunner.getToolApprovalPreview(requestId, conversationId, approval.id))
  }, [requestId, conversationId])
  /** 回应审批；勾选“重复不再提醒”时把本次决定延续到本对话后续审批。 */
  const respondApproval = async (requestId: string, approval: ToolApproval, allow: boolean): Promise<void> => {
    if (!conversationId) throw new Error('审批请求已失效')
    if (approvalRepeat && !approval.mustConfirm) { autoDecision.current = allow; setAutoApproval(allow) }
    unwrapModelResult(await window.piRunner.respondToolApproval(requestId, conversationId, approval.id, allow))
  }
  const [pending, setPending] = useState<{ message: ChatMessage; firstMessage: number } | null>(null)
  const [streamedText, setStreamedText] = useState('')
  const [streamBuffer] = useState(() => new StreamTextBuffer(setStreamedText, active))
  useLayoutEffect(() => { streamBuffer.setVisible(active) }, [active, streamBuffer])
  useEffect(() => () => streamBuffer.cancel(), [streamBuffer])
  const [outputSpeed, setOutputSpeed] = useState<OutputSpeed>()
  // 对话结束后不立即消失，保留最后统计停留一段时间，方便查看。
  useEffect(() => {
    if (requestId || !outputSpeed) return
    const timer = setTimeout(() => setOutputSpeed(undefined), 15000)
    return () => clearTimeout(timer)
  }, [requestId, outputSpeed])
  const [agentStatus, setAgentStatus] = useState('')
  const [execution, setExecution] = useState<{ model: string; provider: ProviderId; startedAt: number; firstMessage: number }>()
  const activeRequest = useRef<string | null>(null)
  const transcriptRef = useRef(messages)
  const nativeHistory = useRef(false)
  const [historyReady, setHistoryReady] = useState(!conversationId || !window.piRunner.getAgentHistory)
  const messagesCallback = useRef(onMessagesChange)
  messagesCallback.current = onMessagesChange
  // 请求期间可以切换会话，完成时必须使用当前的查看状态。
  const replyCompleteCallback = useRef(onReplyComplete)
  replyCompleteCallback.current = onReplyComplete
  const taskEndCallback = useRef(onTaskEnd)
  taskEndCallback.current = onTaskEnd
  useEffect(() => {
    if (!conversationId || !window.piRunner.getAgentHistory) return
    let active = true
    void window.piRunner.getAgentHistory(conversationId).then(unwrapModelResult).then(history => {
      if (!active) return
      if (history) { nativeHistory.current = true; transcriptRef.current = history; setMessages(history); messagesCallback.current?.(history, true) }
      setHistoryReady(true)
    }).catch(() => { if (active) setError('代理会话恢复失败，请检查本地会话文件后重试') })
    return () => { active = false }
  }, [conversationId])
  useEffect(() => window.piRunner.onAgentEvent?.(event => {
    if (event.conversationId !== conversationId) return
    if (event.type === 'approval' && event.approval?.tool === 'full-access') { setFullConfirmation({ requestId: event.requestId, approval: event.approval }); return }
    if (event.type === 'approval-end') setFullConfirmation(previous => previous?.approval.id === event.approvalId ? null : previous)
    if (event.requestId !== activeRequest.current) return
    if (event.type === 'plan-interaction' && event.interaction) { setPlanProgress(''); setInteraction(event.interaction); setInteractionOpen(true) }
    if (event.type === 'plan-interaction-end') setInteraction(previous => previous?.id === event.interactionId ? null : previous)
    if (event.type === 'intent-mode' && event.intentMode) { setPlanProgress(''); changeIntent(event.intentMode) }
    if (event.type === 'approval' && event.approval) {
      const approval = event.approval
      // 已勾选“重复不再提醒”时不再打扰，直接按同一决定回应。
      if (autoDecision.current !== null && conversationId && !approval.mustConfirm) {
        void window.piRunner.respondToolApproval(event.requestId, conversationId, approval.id, autoDecision.current).then(unwrapModelResult).catch(e => setError(e instanceof Error ? e.message : '审批回应失败，请重试'))
        return
      }
      setApprovals(items => [...items.filter(item => item.id !== approval.id), approval])
    }
    if (event.type === 'approval-end') {
      setApprovals(items => items.filter(item => item.id !== event.approvalId))
      setCommandApproval(previous => previous?.id === event.approvalId ? null : previous)
    }
    if (event.type === 'text') streamBuffer.append(event.text ?? '', event.resetText)
    if (event.type === 'speed' && event.speed) setOutputSpeed(event.speed)
    if (event.type === 'status') { setAgentStatus(event.text ?? ''); if (event.resetText) streamBuffer.clear() }
    if (event.type === 'transcript' && event.messages) {
      nativeHistory.current = true
      const previousAssistant = transcriptRef.current.filter(message => message.role === 'assistant')
      const nextAssistant = event.messages.filter(message => message.role === 'assistant')
      transcriptRef.current = event.messages
      setMessages(event.messages); messagesCallback.current?.(event.messages)
      // SDK 的同步事件可能早于用户消息写入；确认本轮消息已入历史后才移除临时气泡。
      const history = event.messages
      setPending(previous => previous && history.slice(previous.firstMessage).some(message =>
        message.role === 'user' && message.content === previous.message.content
        && (message.images?.length ?? 0) === (previous.message.images?.length ?? 0)
        && (message.images ?? []).every((image, index) => image.id === previous.message.images?.[index].id)
      ) ? null : previous)
      // 工具进度和预览保存也会刷新历史，不能清掉下一次模型调用正在生成的正文。
      if (nextAssistant.length !== previousAssistant.length || nextAssistant.at(-1)?.historyId !== previousAssistant.at(-1)?.historyId || nextAssistant.at(-1)?.content !== previousAssistant.at(-1)?.content) streamBuffer.clear()
    }
  }), [conversationId])
  const [statistics, setStatistics] = useState<{ profileId: string; reply: ModelReply } | null>(null)
  const matchingStatistics = statistics && statistics.profileId === profile?.id ? statistics : null
  const lastAssistant = useMemo(() => [...messages].reverse().find(message => message.role === 'assistant'), [messages])
  const statusMessages = useMemo(() => contextMessages(messages, compaction), [messages, compaction])
  const contextUsage = nativeHistory.current && lastAssistant?.execution?.model === profile?.model
    ? lastAssistant?.call?.usage : matchingStatistics?.reply.usage
  const [subscriptionUsage, setSubscriptionUsage] = useState<ChatgptUsage>()
  const [openrouterUsage, setOpenrouterUsage] = useState<OpenrouterUsage>()
  useEffect(() => {
    setOpenrouterUsage(undefined)
    if (!active || profile?.provider !== 'openrouter') return
    let disposed = false
    let loading = false
    const refresh = async (): Promise<void> => {
      if (loading) return
      loading = true
      try {
        const value = unwrapModelResult(await window.piRunner.getOpenrouterUsage())
        if (!disposed) setOpenrouterUsage(value)
      } catch (error) {
        if (!disposed) setOpenrouterUsage({ fetchedAt: 0, error: error instanceof Error ? error.message : 'OpenRouter 额度读取失败，将自动重试' })
      } finally { loading = false }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 60000)
    const onFocus = (): void => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => { disposed = true; clearInterval(timer); window.removeEventListener('focus', onFocus) }
  }, [active, profile?.provider, profile?.model, requestId])
  useEffect(() => {
    if (!active || profile?.provider !== 'chatgpt') return
    let disposed = false
    const refresh = (): void => {
      void window.piRunner.getChatgptUsage().then(unwrapModelResult).then(value => { if (!disposed) setSubscriptionUsage(value) }).catch(e => {
        if (!disposed) setSubscriptionUsage(previous => { const error = e instanceof Error ? e.message : '订阅额度读取失败，将自动重试'; return { windows: /授权|登录|切换/.test(error) ? [] : previous?.windows ?? [], fetchedAt: previous?.fetchedAt ?? 0, error } })
      })
    }
    refresh()
    const timer = setInterval(refresh, 60000)
    window.addEventListener('focus', refresh)
    return () => { disposed = true; clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [active, profile?.provider, requestId])
  const busyRef = useRef(false)
  /** 用户主动取消时不算失败，避免弹出误导性的失败通知。 */
  const cancelledRef = useRef(false)
  const queueCallback = useRef(onQueueChange)
  queueCallback.current = onQueueChange
  // 原队列、编辑内容和原草稿分别保存，刷新后继续编辑，避免直接发送旧内容。
  useEffect(() => { queueCallback.current?.(queue, queuePaused || Boolean(editingId), queueEdit) }, [queue, queuePaused, queueEdit])
  const stopRequest = async (): Promise<void> => {
    if (!requestId || stoppingRequest.current === requestId) return
    const id = requestId
    stoppingRequest.current = id
    setStopping(true)
    setError('')
    cancelledRef.current = true
    // 立即暂停，即使取消与正常完成同时发生，也不能启动下一条。
    setQueuePaused(true)
    try { unwrapModelResult(await window.piRunner.cancelModelRequest(id)) }
    catch (error) {
      if (activeRequest.current !== id) return
      stoppingRequest.current = null
      setStopping(false)
      cancelledRef.current = false
      throw error
    }
  }
  const send = async (item: QueuedMessage): Promise<void> => {
    if (!profile || busyRef.current) return
    const { id: _queueId, ...message } = item
    setQueue(items => items.filter(queued => queued.id !== item.id))
    setScrollToLatestRequest(value => value + 1)
    busyRef.current = true; setError(''); setNotice(''); setPending({ message, firstMessage: messages.length }); streamBuffer.clear(); setOutputSpeed(undefined); setAgentStatus('正在连接模型…')
    cancelledRef.current = false
    const id = crypto.randomUUID(); setRequestId(id); activeRequest.current = id
    transcriptRef.current = messages
    setExecution({ model: profile.model, provider: profile.provider, startedAt: performance.now(), firstMessage: messages.length })
    const next: ChatMessage[] = [...messages, message]
    let replyReceived = false
    try {
      onBusyChange(true)
      const instruction = customPrompt.trim()
      const requestContext = { threshold: compressionThreshold, usage: contextUsage }
      const requestMessages = (conversationId ? nativeHistory.current ? [message] : next : contextMessages(next, compaction))
        .map(({ execution: _execution, snapshotHash: _snapshotHash, ...message }) => message)
      const reply = unwrapModelResult(await (conversationId
        ? window.piRunner.chatWithModel(profile.id, id, requestMessages, instruction || undefined, requestContext, { conversationId, project, ...(intentMode !== 'execute' ? { intentMode } : {}) })
        : window.piRunner.chatWithModel(profile.id, id, requestMessages, instruction || undefined, requestContext)))
      replyReceived = true
      setStatistics({ profileId: profile.id, reply })
      if (reply.messages) nativeHistory.current = true
      const completed: ChatMessage[] = (reply.messages ?? [...next, { role: 'assistant' as const, content: reply.text }]).map((message, index) =>
        message.role === 'assistant' && index >= messages.length && message.execution?.elapsedMs === undefined ? { ...message, execution: { model: reply.model, provider: profile.provider, elapsedMs: reply.elapsedMs } } : message)
      setMessages(completed); onMessagesChange?.(completed)
      replyCompleteCallback.current?.()
      taskEndCallback.current?.(true, completed.filter(message => message.role === 'user').at(-1)?.content ?? message.content)
      if (reply.compaction) {
        const updated = { ...reply.compaction, coveredMessages: reply.compaction.coveredMessages + (compaction ? compaction.coveredMessages - 1 : 0) }
        setCompaction(updated); onCompactionChange?.(updated)
      } else if (conversationId) { setCompaction(undefined); onCompactionChange?.(undefined) }
      setNotice([reply.compaction ? '已自动压缩上下文，完整记录已保留' : '', reply.truncated ? '已达到输出上限，可在设置中调整' : '', ...(reply.warnings ?? [])].filter(Boolean).join(' · '))
    } catch (e) {
      if (replyReceived) { setNotice('回复已完成，但界面收尾失败，请重新打开会话查看结果'); taskEndCallback.current?.(true, message.content); return }
      setError(e instanceof Error ? e.message : '模型请求失败，请重试')
      // 用户主动取消不发送失败通知。
      if (!cancelledRef.current) taskEndCallback.current?.(false, message.content)
      setQueue(items => [item, ...items]); setQueuePaused(true)
    }
    finally {
      stoppingRequest.current = null; setStopping(false)
      busyRef.current = false; activeRequest.current = null; setRequestId(null); setPending(null); streamBuffer.clear(); setAgentStatus(''); setApprovals([]); setCommandApproval(null); setFullConfirmation(null); setInteraction(null); setPlanProgress('')
      try { onBusyChange(false) }
      catch { setNotice('界面运行状态更新失败，请重新打开会话') }
    }
  }
  // 等历史更新后再执行下一条，确保下一轮使用完整上下文。编辑时暂缓队列执行。
  useEffect(() => {
    if (deletionRunning.current || requestId || busyRef.current || editingId || queuePaused || permissionChanging || settingsDisabled || !projectReady || !historyReady || !profile || !queue.length) return
    void send(queue[0])
  })
  const deleteRound = useCallback(async (index: number): Promise<void> => {
    if (busyRef.current || deletionRunning.current || !historyReady) throw new Error('请等待当前任务结束后删除')
    if (messages[index]?.role !== 'user') throw new Error('这轮对话已变化，请重试')
    deletionRunning.current = true; setDeletingRound(true)
    try {
      onBusyChange(true, true)
      const nextIndex = messages.findIndex((message, position) => position > index && message.role === 'user')
      const end = nextIndex < 0 ? messages.length : nextIndex
      const removedHashes = new Set(messages.slice(index, end).flatMap(message => message.snapshotHash ? [message.snapshotHash] : []))
      const history = conversationId ? unwrapModelResult(await window.piRunner.deleteAgentRound(conversationId, index, messages[index].historyId)) : null
      const retained = history ?? [...messages.slice(0, index), ...messages.slice(end)]
      nativeHistory.current = history !== null
      setMessages(retained); onMessagesChange?.(retained)
      setCompaction(undefined); onCompactionChange?.(undefined)
      onSnapshotsChange?.((snapshots ?? []).flatMap(snapshot => {
        if (removedHashes.has(snapshot.after.hash) || snapshot.messageIndex !== undefined && snapshot.messageIndex >= index && snapshot.messageIndex < end) return []
        return [{ ...snapshot, ...(snapshot.messageIndex !== undefined && snapshot.messageIndex >= end ? { messageIndex: snapshot.messageIndex - (end - index) } : {}) }]
      }))
      setStatistics(null); setOutputSpeed(undefined); setExecution(undefined); setNotice(''); setError('')
    } finally { deletionRunning.current = false; setDeletingRound(false); onBusyChange(false, true) }
  }, [messages, conversationId, historyReady, snapshots, onMessagesChange, onCompactionChange, onSnapshotsChange, onBusyChange])
  return <section className="model-chat" aria-label="模型对话">
    {active && interaction && interactionOpen && <PlanDialog key={interaction.id} interaction={interaction} onDismiss={() => setInteractionOpen(false)} onCancel={() => {
      void stopRequest().catch(() => setError('取消计划失败，请重试'))
    }} onRespond={async response => {
      if (!requestId || !conversationId) throw new Error('计划交互已失效')
      const progress = response.answers ? '已提交回答，正在与模型沟通…' : response.decision === 'revise' ? '已提交修改意见，正在完善计划…' : ''
      setPlanProgress(progress)
      try {
        unwrapModelResult(await window.piRunner.respondPlanInteraction(requestId, conversationId, interaction.id, response))
      } catch (e) { setPlanProgress(''); throw e }
    }} />}
    {active && fullConfirmation && conversationId && <FullAccessDialog key={fullConfirmation.approval.id} onRespond={async allow => {
      try { unwrapModelResult(await window.piRunner.respondToolApproval(fullConfirmation.requestId, conversationId, fullConfirmation.approval.id, allow)) }
      catch (e) { setError(e instanceof Error ? e.message : '权限确认失败，请重试') }
    }} />}
    <ChatTranscript onDeleteRound={deleteRound} deletingRound={deletingRound || !historyReady} notificationNavigationRequest={historyReady ? notificationNavigationRequest : 0} project={project} active={active} scrollToLatestRequest={scrollToLatestRequest} snapshots={snapshots} messages={messages} pendingMessage={pending?.message ?? null} streamedText={streamedText} agentStatus={stopping ? '正在停止任务…' : agentStatus} isBusy={Boolean(requestId)} execution={execution} hasProfile={Boolean(profile)} settingsDisabled={settingsDisabled} onOpenSettings={onOpenSettings} />
    <div className="composer-wrap" hidden={!active}>
      {requestId && !interaction && planProgress && <div className="plan-waiting plan-progress" role="status"><LoaderCircle size={18} className="plan-progress-spinner" aria-hidden="true" /><span>{planProgress}</span></div>}
      {interaction && <div className="plan-waiting"><span>{interaction.kind === 'questions' ? '计划正在等待你的回答' : '计划已准备好，等待你的批准'}</span><Button variant="outline" onClick={() => setInteractionOpen(true)}>{interaction.kind === 'questions' ? '回答问题' : '审阅计划'}</Button></div>}
      {autoApproval !== null && <div className="plan-waiting"><span>本次对话后续审批将自动{autoApproval ? '批准' : '拒绝'}，不再提醒</span><Button variant="outline" onClick={() => { autoDecision.current = null; setAutoApproval(null); setApprovalRepeat(false) }}>恢复提醒</Button></div>}
      <PagedList items={approvals} pageSize={10} label="待审批请求">{page => page.map(approval => <ToolApprovalCard key={approval.id} approval={approval} repeat={approvalRepeat} onRepeatChange={setApprovalRepeat} onViewDetails={() => { if (isCommandApproval(approval)) setCommandApproval(approval); else setApprovalDetailsOpen(true) }} onRespond={async allow => {
        if (!requestId || !conversationId) return
        try { await respondApproval(requestId, approval, allow) }
        catch (e) { setError(e instanceof Error ? e.message : '审批回应失败，请重试') }
      }} />)}</PagedList>
      {active && commandApproval && <CommandApprovalDialog open onOpenChange={open => { if (!open) setCommandApproval(null) }} approval={commandApproval} repeat={approvalRepeat} onRepeatChange={setApprovalRepeat} onRespond={async allow => {
        if (!requestId || !conversationId) return
        try { await respondApproval(requestId, commandApproval, allow); setCommandApproval(null) }
        catch (e) { setError(e instanceof Error ? e.message : '审批回应失败，请重试') }
      }} />}
      <ToolApprovalDiffDialog open={active && approvalDetailsOpen} onOpenChange={setApprovalDetailsOpen} approvals={approvals} getPreview={getApprovalPreview} />
      {active && error && <p className="error" role="alert">{error}</p>}
      {active && notice && <p className="request-notice" role="status">{notice}</p>}
      <ChatComposer stopping={stopping} active={active} queue={queue} editingId={editingId} queuePaused={queuePaused} onResumeQueue={() => setQueuePaused(false)} onCancelEdit={restoreDraft} onEditQueued={editQueued} onDeleteQueued={deleteQueued} onReorderQueued={reorderQueued} intentMode={intentMode} onIntentChange={changeIntent} permissionMode={permissionMode} onPermissionChange={conversationId ? changePermission : undefined} profile={profile} profiles={availableProfiles} providers={providers} onSelectModel={id => { setSelectedModelId(id); onModelChange?.(id) }} onThinkingChange={changeThinking} prompt={prompt} images={images} skillIds={skillIds} onSkillsChange={setSkillIds} onImagesChange={setImages} isBusy={Boolean(requestId)} hasMessages={messages.length > 0} settingsDisabled={settingsDisabled || permissionChanging || deletingRound || !projectReady} sendWithCtrlEnter={sendWithCtrlEnter} onPromptChange={setPrompt} onOpenSettings={onOpenSettings} onSend={submit} onCancel={() => { void stopRequest().catch(() => setError('取消请求失败，请重试')) }} />
      {active && <ComposerStatus outputSpeed={outputSpeed} latestReply={matchingStatistics?.reply} subscriptionUsage={subscriptionUsage} openrouterUsage={openrouterUsage} compressionThreshold={compressionThreshold} project={project} profile={profile} contextLimit={providers?.find(item => item.provider === profile?.provider && item.baseUrl === profile?.baseUrl)?.models.find(item => item.id === profile?.model)?.maxContextTokens} messages={statusMessages} prompt={prompt} instruction={customPrompt} attachments={images} usage={contextUsage} rateLimits={matchingStatistics?.reply.rateLimits} onOpenProject={() => {
        if (project) void window.piRunner.openProjectDirectory(project).catch(() => setError('无法打开项目目录，请检查目录是否存在后重试'))
      }} />}
    </div>
  </section>
}

export default memoWithStableCallbacks(ModelChat)
