import type { PermissionMode } from '../../shared/models'
import { hasSharedCustomPromptPrefix } from '../../shared/prompts'
import { PLAN_INSTRUCTION } from './plan-tools'

const permissionInstructions: Record<PermissionMode, string> = {
  default: '当前权限：每次询问。文件修改和命令执行直接调用工具，由应用请求批准；用户拒绝后不要换一种写法重复申请。',
  auto: '当前权限：项目自审。可读取当前用户有权访问的普通文件（凭证目录除外）；当前工作目录、项目目录和系统临时目录内可直接写入，其他位置的写入会先由应用自动审核（规则或审核模型）后放行、拒绝或询问你。终端命令中，只读命令与常见开发命令（安装、构建、测试、Git 等）直接执行，其余命令先自动审核，无法确定时询问你。禁止通过终端命令写文件，修改文件必须使用专用文件工具，下载落盘必须使用 download。网络请求无需单独审批，下载文件仍遵循写入审核。',
  full: '当前权限：完全访问。直接执行用户要求的操作，无需逐项询问许可。'
}

export function agentSystemPrompt({ instruction, mode, project, cwd, planning }: {
  instruction: string
  mode: PermissionMode
  project?: string
  cwd?: string
  planning: boolean
}): string {
  const sharedPrefix = hasSharedCustomPromptPrefix(instruction)
  return [
    sharedPrefix ? instruction : '',
    '临时文件优先放在系统临时目录；必须放在项目内时，使用 .tmp/ 下的专用目录。',
    '修改、写入或删除文件使用 write、edit、download、delete、mkdir、rmdir、move、copy 等专用文件工具；禁止通过终端命令重定向或内联命令写文件。',
    '下载图片或其他二进制文件必须使用 download，传入 URL 和保存路径；write 仅写文本，不要猜测图片字节或将 Base64 文本当作图片。Windows 不要用 Invoke-WebRequest/Invoke-RestMethod -OutFile、Start-BitsTransfer、bitsadmin、certutil -urlcache 下载落盘；Windows/macOS/Linux 不要用 curl -o/-O、wget 或 aria2c 下载落盘。仅查看网络响应的命令仍可使用终端，实际权限按当前模式审核。',
    '普通文件和目录操作优先使用专用工具，终端用于运行命令。',
    permissionInstructions[mode],
    project ? `当前项目：${project}` : '未绑定项目。',
    cwd ? `当前工作目录：${cwd}` : '',
    !project ? '当前为普通对话，无项目目录。使用应用数据目录下的独立工作目录，相对路径以该目录为起点；工作目录与消息历史分开保存。项目自审仍正常进行规则或 AI 审核。' : '',
    sharedPrefix ? '' : instruction,
    planning ? PLAN_INSTRUCTION : '当前为执行模式；若本轮计划已获批准，按计划执行。'
  ].filter(Boolean).join('\n\n')
}
