import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { DEFAULT_COMMAND_APPROVAL_REASON, type AgentEvent, type PermissionMode, type ToolApproval } from '../../shared/models'
import { ModelError } from './model-validation'
import { toolApprovalPreview } from './tool-approval-preview'
import { literalCommand } from './windows-command-parser'
import { knownReadOnlyQuery, readOnlyGitQuery } from './snapshot-read-only-queries'

/** 审批只授予当前工具调用；停止任务后所有待审批立即失效。 */
export class ToolApprovalManager {
  private pending = new Map<string, { requestId: string; conversationId: string; details: ToolApproval; finish(allow: boolean): void }>()
  constructor(private readonly emit: (event: AgentEvent) => void) {}
  async ask(requestId: string, conversationId: string, details: Omit<ToolApproval, 'id'>, signal: AbortSignal, onWaiting: (waiting: boolean) => void, rejectOnDeny = true): Promise<boolean> {
    signal.throwIfAborted()
    const id = randomUUID()
    const allowed = await new Promise<boolean>((resolve, reject) => {
      const cleanup = (): void => {
        this.pending.delete(id)
        signal.removeEventListener('abort', abort)
        onWaiting(false)
        this.emit({ type: 'approval-end', requestId, conversationId, approvalId: id })
      }
      const abort = (): void => { cleanup(); reject(new ModelError('工具审批已取消')) }
      this.pending.set(id, { requestId, conversationId, details: structuredClone({ ...details, id }), finish: allow => { cleanup(); resolve(allow) } })
      signal.addEventListener('abort', abort, { once: true })
      onWaiting(true)
      this.emit({ type: 'approval', requestId, conversationId, approval: { ...details, id } })
    })
    signal.throwIfAborted()
    if (!allowed && rejectOnDeny) throw new ModelError('用户拒绝了本次工具操作；请调整方案，不要重复尝试相同操作')
    return allowed
  }
  respond(requestId: string, conversationId: string, id: string, allow: boolean): void {
    const pending = this.pending.get(id)
    if (!pending || pending.requestId !== requestId || pending.conversationId !== conversationId) throw new ModelError('审批请求已失效或不属于当前任务')
    pending.finish(allow)
  }
  async preview(requestId: string, conversationId: string, id: string) {
    const pending = this.pending.get(id)
    if (!pending || pending.requestId !== requestId || pending.conversationId !== conversationId) throw new ModelError('审批请求已失效或不属于当前任务')
    const preview = await toolApprovalPreview(pending.details)
    if (this.pending.get(id) !== pending) throw new ModelError('审批请求已失效')
    return preview
  }
}

/** 只接受完整匹配的单条命令；项目自审模式由文件工具实现，不启动 Shell。 */
export function safeLocationCommand(command: string): boolean {
  return /^(?:pwd|Get-Location)\s*$/i.test(command.trim())
}

export function safeFileCommand(command: string): { tool: 'read' | 'ls'; path: string } | undefined {
  // 不接受通配符、变量展开、重定向或 Shell 组合语法。
  if (/[\r\n;&|<>`$*?]/.test(command)) return undefined
  const match = /^(cat|ls|Get-Content|Get-ChildItem)(?:\s+-LiteralPath)?(?:\s+(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s"']+)))?\s*$/i.exec(command.trim())
  if (!match) return undefined
  const target = match[2] ?? match[3] ?? match[4]
  const tool = /^(cat|Get-Content)$/i.test(match[1]) ? 'read' : 'ls'
  if ((tool === 'read' && !target) || target?.startsWith('-')) return undefined
  return { tool, path: target ?? '.' }
}

// 可直接查询的程序放在这里；同时具有写入能力的工具按子命令、选项分别判断。
const readOnlyPrograms = new Set([
  'ls', 'dir', 'pwd', 'get-location', 'gl', 'get-childitem', 'gci',
  'cat', 'type', 'get-content', 'gc', 'more', 'head', 'tail', 'wc',
  'stat', 'get-item', 'gi', 'test-path', 'resolve-path', 'get-itemproperty',
  'grep', 'rg', 'select-string', 'sls', 'where', 'get-command', 'gcm',
  'echo', 'write-output', 'write-host', 'get-help'
])
// 这些 Git 子命令只读取仓库状态；reflog 改写、外部 diff 与 --output 等写文件参数另行排除。
const readOnlyGitSubcommands = new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'rev-list', 'blame', 'describe', 'cat-file', 'ls-files', 'ls-tree', 'grep', 'shortlog', 'whatchanged', 'reflog', 'count-objects', 'for-each-ref', 'show-ref', 'name-rev', 'merge-base', 'version', 'help'])

/** 只拆分引号外的顺序/条件连接；拒绝重定向、管道、展开和后台运行。 */
function readOnlyStatements(command: string): string[] | undefined {
  if (!command.trim() || command.length > 16000 || /[`$\0]/.test(command)) return undefined
  const statements: string[] = []
  let start = 0, quote = ''
  for (let index = 0; index < command.length; index++) {
    const character = command[index]
    if (quote) {
      if (character === quote) {
        if (quote === "'" && command[index + 1] === "'") index++
        else quote = ''
      }
      continue
    }
    if (character === '"' || character === "'") { quote = character; continue }
    if (/[<>(){}#]/.test(character)) return undefined
    if (character === '&' && !command.slice(start, index).trim() && /\s/.test(command[index + 1] ?? '')) continue
    if (character === ';' || character === '\n' || character === '\r' || (character === '&' || character === '|') && command[index + 1] === character) {
      const statement = command.slice(start, index).trim()
      if (!statement && character !== '\n' && character !== '\r') return undefined
      if (statement) statements.push(statement)
      if (character === '&' || character === '|') index++
      start = index + 1
      if ((character === '&' || character === '|') && !command.slice(start).trim()) return undefined
    } else if (character === '&' || character === '|') return undefined
  }
  if (quote) return undefined
  const last = command.slice(start).trim()
  if (last) statements.push(last)
  return statements.length ? statements : undefined
}

function readOnlyStatement(command: string): boolean {
  const tokens = literalCommand(command)
  if (!tokens) return false
  const executable = tokens[0].split(/[\\/]/).at(-1)!
  if (/\.(?:cmd|bat|ps1|sh)$/i.test(executable)) return false
  const program = executable.replace(/\.exe$/i, '').toLowerCase()
  const args = tokens.slice(1)
  if (['cd', 'chdir', 'set-location', 'sl'].includes(program)) {
    const paths = ['-path', '-literalpath', '/d'].includes(args[0]?.toLowerCase()) ? args.slice(1) : args
    return paths.length === 1 && !paths[0].startsWith('-')
  }
  // rg 可通过预处理器和主机名命令执行任意脚本，不能仅按程序名免除保护。
  if (program === 'rg' && args.some(value => /^--(?:pre|hostname-bin)(?:=|$)/i.test(value))) return false
  if (program !== 'git') return readOnlyPrograms.has(program) || knownReadOnlyQuery(program, args)
  if (args.length === 1 && args[0] === '--version') return true
  let index = 0
  // 跳过不改变只读语义的 Git 全局选项，例如 git --no-pager status。
  while (index < args.length) {
    const value = args[index]
    if (value === '-c' || value.startsWith('-c')) {
      const setting = value === '-c' ? args[++index] : value.slice(2)
      // 仅识别显示参数及关闭文件系统监视器，其他配置仍按可能执行脚本处理。
      if (!/^(?:core\.quotepath=(?:true|false)|color\.ui=(?:false|never|auto|always)|core\.fsmonitor=false)$/i.test(setting ?? '')) return false
      index++; continue
    }
    if (['--no-pager', '--paginate', '--no-optional-locks', '--literal-pathspecs', '--no-replace-objects'].includes(value)) { index++; continue }
    if (value === '-C') { if (!args[index + 1]) return false; index += 2; continue }
    if (value.startsWith('--git-dir=') || value.startsWith('--work-tree=') || value.startsWith('--namespace=') || value.startsWith('--exec-path=')) { index++; continue }
    break
  }
  const subcommand = args[index]?.toLowerCase()
  if (!subcommand) return false
  const queryArgs = args.slice(index + 1)
  if (queryArgs.some(value => /^--(?:out|ext-diff|textconv)/i.test(value))) return false
  if (readOnlyGitQuery(subcommand, queryArgs)) return true
  if (!readOnlyGitSubcommands.has(subcommand) && !['check-ignore', 'check-attr', 'diff-files', 'diff-index', 'diff-tree'].includes(subcommand)) return false
  const rest = args.slice(index + 1).map(value => value.toLowerCase())
  if (subcommand === 'reflog' && rest.some(value => ['expire', 'delete', 'drop', 'write'].includes(value))) return false
  if (subcommand === 'grep' && queryArgs.some(value => value.startsWith('-O') || value.startsWith('--open-files-in-pager'))) return false
  if (['diff', 'log', 'show', 'grep'].includes(subcommand) && rest.some(value => value === '--ext-diff' || value === '--textconv' || value === '--output' || value.startsWith('--output='))) return false
  return true
}

/** 所有语句都能确认为只读时才跳过基线；未知命令仍在执行前保护文件。 */
export function readOnlyCommand(command: string): boolean {
  return readOnlyStatements(command)?.every(readOnlyStatement) ?? false
}

/** 每次询问或项目自审模式中的敏感路径；完全访问模式不再逐项确认。 */
export function highRiskFileMutation(target: string): boolean {
  const normalized = target.replace(/\\/g, '/').toLowerCase()
  return /^(?:[a-z]:\/(?:windows|program files(?: \(x86\))?|programdata)(?:\/|$)|\/(?:etc|boot|system|library|bin|sbin)(?:\/|$)|\/usr\/(?:bin|sbin|lib)(?:\/|$))/.test(normalized)
    || /\/(?:\.(?:bashrc|bash_profile|zshrc|zshenv|profile|gitconfig)|\.ssh\/(?:config|authorized_keys|known_hosts))$/.test(normalized)
    || /\/(?:\.config\/autostart|start menu\/programs\/startup|library\/(?:launchagents|launchdaemons))(?:\/|$)/.test(normalized)
}

export function commandApprovalReason(mode: PermissionMode, command: string): string | undefined {
  if (mode === 'full') return undefined
  if (mode === 'default') return DEFAULT_COMMAND_APPROVAL_REASON
  if (safeLocationCommand(command) || safeFileCommand(command)) return undefined
  if (mode === 'auto') return '当前命令没有可用的项目系统沙箱。获准后将使用本机权限，可能访问项目外文件或网络'
  return undefined
}
