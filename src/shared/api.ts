import type { AgentEvent, AgentRequestOptions, ChatMessage, ModelDescriptor, ModelReply, ModelResult, ModelSettings, SaveModelProfile } from './models'
export interface Checkpoint { hash: string; createdAt: string; label: string }
export interface ChangedFile { path: string; status: 'A' | 'M' | 'D'; additions: number; deletions: number; binary: boolean }
export interface FileDiff { path: string; before: string; after: string; binary: boolean; hunks?: string[] }
export type FileAction = 'copy-file' | 'copy-path' | 'open-directory' | 'open-file'
/** 通知类型：任务成功、任务失败、等待用户输入；界面按类型使用不同图标。 */
export type NotificationKind = 'success' | 'failure' | 'input'
export interface AppNotification { kind: NotificationKind; title: string; body: string; /** Windows 气泡中显示的最新一轮用户输入。 */ userInput?: string; /** 点击通知后需要选中的会话。 */ conversationId?: string }
import type { ConversationState } from './conversations'
export interface PiRunnerApi {
  showNotification(notification: AppNotification): Promise<void>
  /** 关闭当前显示的全部通知气泡（Windows 自定义气泡）。 */
  closeNotifications(): Promise<void>
  onNotificationActivate(callback: (conversationId: string) => void): () => void
  readCodePreview(project: string, path: string, ranges: import('./code-preview').CodeLineRange[], snapshotId?: string): Promise<import('./code-preview').CodePreview>
  getSkills(): Promise<ModelResult<import('./skills').LocalSkill[]>>
  installSkill(source?: 'zip' | 'directory'): Promise<ModelResult<import('./skills').LocalSkill[] | null>>
  getSkillsDirectory(): Promise<ModelResult<string>>
  openSkillsDirectory(): Promise<ModelResult<void>>
  setSkillEnabled(id: string, enabled: boolean): Promise<ModelResult<import('./skills').LocalSkill[]>>
  deleteSkill(id: string): Promise<ModelResult<import('./skills').LocalSkill[]>>
  exportSkill(id: string): Promise<ModelResult<string | null>>
  refreshSkills(): Promise<ModelResult<import('./skills').LocalSkill[]>>
  performFileAction(project: string, path: string, action: FileAction): Promise<void>
  copyText(text: string): Promise<void>
  saveAttachment(name: string, dataUrl: string): Promise<string | null>
  respondPlanInteraction(requestId: string, conversationId: string, interactionId: string, response: import('./models').PlanResponse): Promise<ModelResult<void>>
  getToolApprovalPreview(requestId: string, conversationId: string, approvalId: string): Promise<ModelResult<import('./models').ToolApprovalPreview>>
  setPermissionMode(conversationId: string, mode: import('./models').PermissionMode): Promise<ModelResult<import('./models').PermissionMode>>
  respondToolApproval(requestId: string, conversationId: string, approvalId: string, allow: boolean): Promise<ModelResult<void>>
  getChatgptAuth(): Promise<ModelResult<import('./models').ChatgptAuthStatus>>
  startChatgptAuth(): Promise<ModelResult<import('./models').ChatgptAuthStatus>>
  openChatgptAuth(): Promise<ModelResult<void>>
  copyChatgptAuthLink(): Promise<ModelResult<void>>
  submitChatgptCallback(url: string): Promise<ModelResult<void>>
  cancelChatgptAuth(): Promise<ModelResult<void>>
  logoutChatgpt(): Promise<ModelResult<void>>
  refreshChatgptModels(): Promise<ModelResult<ModelSettings>>
  getChatgptModelInfo(model: string): Promise<ModelResult<ModelDescriptor>>
  getChatgptUsage(): Promise<ModelResult<import('./models').ChatgptUsage>>
  loadConversations(): Promise<ConversationState>
  saveConversations(state: ConversationState): Promise<void>
  /** 退出前收集草稿并等待待保存的会话全部落盘；失败时阻止正常退出。 */
  onFlushConversations(callback: () => Promise<void>): () => void
  selectProject(): Promise<string | null>
  pickProjectDirectory(): Promise<string | null>
  openProject(path: string): Promise<string>
  rebindProject(previousPath: string, nextPath: string): Promise<string>
  openProjectDirectory(path: string): Promise<void>
  removeProject(path: string): Promise<void>
  createCheckpoint(label: string): Promise<Checkpoint>
  listCheckpoints(project?: string): Promise<Checkpoint[]>
  /** 界面展示用改动列表，已过滤项目 .gitignore 排除项；快照与回滚仍使用完整范围。 */
  getChanges(base: string, current: string, project?: string): Promise<ChangedFile[]>
  getDiff(base: string, current: string, path: string, project?: string): Promise<FileDiff>
  rollbackCheckpoint(base: string, current: string, project?: string): Promise<Checkpoint>
  restoreCheckpoint(target: string, project?: string): Promise<Checkpoint>
  getMatchingCheckpoints(hashes: string[], project?: string): Promise<string[]>
  getModelSettings(): Promise<ModelResult<ModelSettings>>
  saveModelProfile(input: SaveModelProfile): Promise<ModelResult<ModelSettings>>
  setActiveModel(id: string): Promise<ModelResult<ModelSettings>>
  setReviewModel(id: string | null): Promise<ModelResult<ModelSettings>>
  testModel(id: string, requestId: string): Promise<ModelResult<ModelReply>>
  chatWithModel(id: string, requestId: string, messages: ChatMessage[], customPrompt?: string, context?: import('./context').ContextOptions, agent?: AgentRequestOptions): Promise<ModelResult<ModelReply>>
  onAgentEvent(callback: (event: AgentEvent) => void): () => void
  getAgentHistory(conversationId: string): Promise<ModelResult<ChatMessage[] | null>>
  deleteAgentRound(conversationId: string, index: number, expectedHistoryId?: string): Promise<ModelResult<ChatMessage[] | null>>
  cancelModelRequest(requestId: string): Promise<ModelResult<void>>
  connectOllama(baseUrl: string): Promise<ModelResult<ModelSettings>>
  connectOpenrouter(apiKey?: string): Promise<ModelResult<ModelSettings>>
  getOpenrouterUsage(): Promise<ModelResult<import('./models').OpenrouterUsage>>
  getOllamaModelInfo(baseUrl: string, model: string): Promise<ModelResult<ModelDescriptor>>
  minimizeWindow(): Promise<void>
  toggleMaximizeWindow(): Promise<boolean>
  closeWindow(): Promise<void>
  onWindowMaximizedChange(callback: (maximized: boolean) => void): () => void
  /** 有会话执行时阻止系统休眠（不阻止自动锁屏）；active 为 false 时恢复默认电源行为。 */
  setSleepBlocker(active: boolean): Promise<void>
}
export const IPC_CHANNELS = {
  codePreview: 'files:code-preview',
  skillsExport: 'models:skills-export',
  skillsList: 'models:skills-list', skillsInstall: 'models:skills-install', skillsEnable: 'models:skills-enable', skillsDelete: 'models:skills-delete', skillsRefresh: 'models:skills-refresh', skillsDirectory: 'models:skills-directory', skillsOpenDirectory: 'models:skills-open-directory',
  fileAction: 'files:action',
  copyText: 'clipboard:copy-text',
  notification: 'app:notification', notificationActivate: 'app:notification-activate', closeNotifications: 'app:close-notifications',
  saveAttachment: 'files:save-attachment',
  planInteraction: 'models:plan-interaction',
  toolApprovalPreview: 'models:tool-approval-preview',
  permissionMode: 'models:permission-mode', toolApproval: 'models:tool-approval',
  chatgptStatus: 'models:chatgpt-status', chatgptStart: 'models:chatgpt-start', chatgptOpen: 'models:chatgpt-open', chatgptCopy: 'models:chatgpt-copy',
  chatgptSubmit: 'models:chatgpt-submit', chatgptCancel: 'models:chatgpt-cancel', chatgptLogout: 'models:chatgpt-logout', chatgptModels: 'models:chatgpt-models', chatgptInfo: 'models:chatgpt-info', chatgptUsage: 'models:chatgpt-usage',
  conversationsLoad: 'conversations:load', conversationsSave: 'conversations:save',
  conversationsFlush: 'conversations:flush', conversationsFlushed: 'conversations:flushed',
  selectProject: 'project:select', checkpoint: 'snapshot:create',
  checkpoints: 'snapshot:list',
  changes: 'snapshot:changes', diff: 'snapshot:diff', restore: 'snapshot:restore', matches: 'snapshot:matches',
  rollback: 'snapshot:rollback', agentEvent: 'models:agent-event', agentHistory: 'models:agent-history', agentDeleteRound: 'models:agent-delete-round',
  modelSettings: 'models:list', modelSave: 'models:save',
  modelActivate: 'models:activate', modelTest: 'models:test', modelChat: 'models:chat', modelCancel: 'models:cancel',
  modelReview: 'models:review-model',
  ollamaConnect: 'models:ollama-connect', ollamaInfo: 'models:ollama-info',
  openrouterConnect: 'models:openrouter-connect',
  openrouterUsage: 'models:openrouter-usage',
  sleepBlocker: 'app:sleep-blocker',
  windowMinimize: 'window:minimize', windowToggleMaximize: 'window:toggle-maximize', windowClose: 'window:close', windowMaximized: 'window:maximized',
  projectOpen: 'project:open', projectRebind: 'project:rebind', projectRemove: 'project:remove', projectDirectory: 'project:directory', projectPick: 'project:pick'
} as const
