import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type PiRunnerApi } from '../shared/api'

const api: PiRunnerApi = {
  onFlushConversations: callback => {
    const listener = (_event: Electron.IpcRendererEvent, token: string): void => {
      void Promise.resolve().then(callback).then(
        () => ipcRenderer.send(IPC_CHANNELS.conversationsFlushed, token, true),
        () => ipcRenderer.send(IPC_CHANNELS.conversationsFlushed, token, false)
      )
    }
    ipcRenderer.on(IPC_CHANNELS.conversationsFlush, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.conversationsFlush, listener)
  },
  readCodePreview: (project, path, ranges, snapshotId) => ipcRenderer.invoke(IPC_CHANNELS.codePreview, project, path, ranges, snapshotId),
  getSkills: () => ipcRenderer.invoke(IPC_CHANNELS.skillsList),
  installSkill: source => ipcRenderer.invoke(IPC_CHANNELS.skillsInstall, source),
  getSkillsDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.skillsDirectory),
  openSkillsDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.skillsOpenDirectory),
  setSkillEnabled: (id, enabled) => ipcRenderer.invoke(IPC_CHANNELS.skillsEnable, id, enabled),
  deleteSkill: id => ipcRenderer.invoke(IPC_CHANNELS.skillsDelete, id),
  exportSkill: id => ipcRenderer.invoke(IPC_CHANNELS.skillsExport, id),
  refreshSkills: () => ipcRenderer.invoke(IPC_CHANNELS.skillsRefresh),
  performFileAction: (project, path, action) => ipcRenderer.invoke(IPC_CHANNELS.fileAction, project, path, action),
  copyText: text => ipcRenderer.invoke(IPC_CHANNELS.copyText, text),
  showNotification: notification => ipcRenderer.invoke(IPC_CHANNELS.notification, notification),
  closeNotifications: () => ipcRenderer.invoke(IPC_CHANNELS.closeNotifications),
  onNotificationActivate: callback => {
    const listener = (_event: Electron.IpcRendererEvent, conversationId: string): void => callback(conversationId)
    ipcRenderer.on(IPC_CHANNELS.notificationActivate, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.notificationActivate, listener)
  },
  saveAttachment: (name, dataUrl) => ipcRenderer.invoke(IPC_CHANNELS.saveAttachment, name, dataUrl),
  getSandboxStatus: () => ipcRenderer.invoke(IPC_CHANNELS.sandboxStatus),
  ensureSandbox: () => ipcRenderer.invoke(IPC_CHANNELS.sandboxEnsure),
  startSandbox: action => ipcRenderer.invoke(IPC_CHANNELS.sandboxStart, action),
  stopSandbox: () => ipcRenderer.invoke(IPC_CHANNELS.sandboxStop),
  onSandboxState: callback => {
    const listener = (_event: Electron.IpcRendererEvent, state: import('../shared/sandbox').SandboxState): void => callback(state)
    ipcRenderer.on(IPC_CHANNELS.sandboxState, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.sandboxState, listener)
  },
  respondPlanInteraction: (requestId, conversationId, interactionId, response) => ipcRenderer.invoke(IPC_CHANNELS.planInteraction, requestId, conversationId, interactionId, response),
  getToolApprovalPreview: (requestId, conversationId, approvalId) => ipcRenderer.invoke(IPC_CHANNELS.toolApprovalPreview, requestId, conversationId, approvalId),
  setPermissionMode: (id, mode) => ipcRenderer.invoke(IPC_CHANNELS.permissionMode, id, mode),
  respondToolApproval: (requestId, conversationId, approvalId, allow) => ipcRenderer.invoke(IPC_CHANNELS.toolApproval, requestId, conversationId, approvalId, allow),
  getChatgptAuth: () => ipcRenderer.invoke(IPC_CHANNELS.chatgptStatus),
  startChatgptAuth: () => ipcRenderer.invoke(IPC_CHANNELS.chatgptStart),
  openChatgptAuth: () => ipcRenderer.invoke(IPC_CHANNELS.chatgptOpen),
  copyChatgptAuthLink: () => ipcRenderer.invoke(IPC_CHANNELS.chatgptCopy),
  submitChatgptCallback: url => ipcRenderer.invoke(IPC_CHANNELS.chatgptSubmit, url),
  cancelChatgptAuth: () => ipcRenderer.invoke(IPC_CHANNELS.chatgptCancel),
  logoutChatgpt: () => ipcRenderer.invoke(IPC_CHANNELS.chatgptLogout),
  refreshChatgptModels: () => ipcRenderer.invoke(IPC_CHANNELS.chatgptModels),
  getChatgptModelInfo: model => ipcRenderer.invoke(IPC_CHANNELS.chatgptInfo, model),
  getChatgptUsage: () => ipcRenderer.invoke(IPC_CHANNELS.chatgptUsage),
  loadConversations: () => ipcRenderer.invoke(IPC_CHANNELS.conversationsLoad),
  saveConversations: state => ipcRenderer.invoke(IPC_CHANNELS.conversationsSave, state),
  selectProject: () => ipcRenderer.invoke(IPC_CHANNELS.selectProject),
  pickProjectDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.projectPick),
  openProject: path => ipcRenderer.invoke(IPC_CHANNELS.projectOpen, path),
  rebindProject: (previous, next) => ipcRenderer.invoke(IPC_CHANNELS.projectRebind, previous, next),
  openProjectDirectory: path => ipcRenderer.invoke(IPC_CHANNELS.projectDirectory, path),
  removeProject: path => ipcRenderer.invoke(IPC_CHANNELS.projectRemove, path),
  createCheckpoint: label => ipcRenderer.invoke(IPC_CHANNELS.checkpoint, label),
  listCheckpoints: project => ipcRenderer.invoke(IPC_CHANNELS.checkpoints, project),
  getChanges: (base, current, project) => ipcRenderer.invoke(IPC_CHANNELS.changes, base, current, project),
  getDiff: (base, current, path, project) => ipcRenderer.invoke(IPC_CHANNELS.diff, base, current, path, project),
  rollbackCheckpoint: (base, current, project) => ipcRenderer.invoke(IPC_CHANNELS.rollback, base, current, project),
  restoreCheckpoint: (target, project) => ipcRenderer.invoke(IPC_CHANNELS.restore, target, project),
  getMatchingCheckpoints: (hashes, project) => ipcRenderer.invoke(IPC_CHANNELS.matches, hashes, project),
  getModelSettings: () => ipcRenderer.invoke(IPC_CHANNELS.modelSettings),
  saveModelProfile: input => ipcRenderer.invoke(IPC_CHANNELS.modelSave, input),
  setActiveModel: id => ipcRenderer.invoke(IPC_CHANNELS.modelActivate, id),
  testModel: (id, requestId) => ipcRenderer.invoke(IPC_CHANNELS.modelTest, id, requestId),
  chatWithModel: (id, requestId, messages, customPrompt, context, agent) => ipcRenderer.invoke(IPC_CHANNELS.modelChat, id, requestId, messages, customPrompt, context, agent),
  getAgentHistory: id => ipcRenderer.invoke(IPC_CHANNELS.agentHistory, id),
  onAgentEvent: callback => {
    const listener = (_event: Electron.IpcRendererEvent, event: import('../shared/models').AgentEvent): void => callback(event)
    ipcRenderer.on(IPC_CHANNELS.agentEvent, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.agentEvent, listener)
  },
  cancelModelRequest: requestId => ipcRenderer.invoke(IPC_CHANNELS.modelCancel, requestId),
  connectOllama: baseUrl => ipcRenderer.invoke(IPC_CHANNELS.ollamaConnect, baseUrl),
  connectOpenrouter: apiKey => ipcRenderer.invoke(IPC_CHANNELS.openrouterConnect, apiKey),
  getOpenrouterUsage: () => ipcRenderer.invoke(IPC_CHANNELS.openrouterUsage),
  getOllamaModelInfo: (baseUrl, model) => ipcRenderer.invoke(IPC_CHANNELS.ollamaInfo, baseUrl, model),
  minimizeWindow: () => ipcRenderer.invoke(IPC_CHANNELS.windowMinimize),
  toggleMaximizeWindow: () => ipcRenderer.invoke(IPC_CHANNELS.windowToggleMaximize),
  closeWindow: () => ipcRenderer.invoke(IPC_CHANNELS.windowClose),
  setSleepBlocker: active => ipcRenderer.invoke(IPC_CHANNELS.sleepBlocker, active),
  onWindowMaximizedChange: callback => {
    const listener = (_event: Electron.IpcRendererEvent, maximized: boolean): void => callback(maximized)
    ipcRenderer.on(IPC_CHANNELS.windowMaximized, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.windowMaximized, listener)
  }
}
contextBridge.exposeInMainWorld('piRunner', Object.freeze(api))
