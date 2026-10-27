import { inspectedShellCommands } from './shell-command-words'
import { developerToolPolicy } from './developer-tool-policy'

export interface CommandReview { reason: string; mustConfirm?: boolean }

const privilegedPrograms = new Set(['sudo', 'su', 'doas', 'pkexec', 'runuser', 'runas'])
const permissionPrograms = new Set(['chmod', 'chown', 'chgrp', 'setfacl', 'setcap', 'chattr', 'icacls', 'takeown', 'set-acl'])
const systemPrograms = new Set([
  'reboot', 'shutdown', 'poweroff', 'halt', 'init', 'telinit',
  'mount', 'umount', 'swapon', 'swapoff', 'losetup', 'modprobe', 'insmod', 'rmmod',
  'iptables', 'ip6tables', 'nft', 'ufw', 'firewall-cmd',
  'useradd', 'usermod', 'userdel', 'groupadd', 'groupmod', 'groupdel', 'passwd', 'chpasswd', 'visudo',
  'kill', 'pkill', 'killall', 'stop-process', 'taskkill',
  'start-service', 'stop-service', 'restart-service', 'set-service', 'new-service', 'remove-service',
  'set-executionpolicy', 'reg', 'bcdedit', 'diskpart', 'restart-computer', 'stop-computer'
])
const packageManagers = new Set(['apt', 'apt-get', 'dnf', 'yum', 'zypper', 'apk', 'pacman', 'snap', 'flatpak', 'brew', 'winget', 'choco', 'scoop'])
const filePrograms = new Set(['rm', 'rmdir', 'unlink', 'truncate', 'shred', 'dd', 'cp', 'mv', 'ln', 'install', 'rsync', 'tee', 'fallocate', 'mknod', 'mktemp'])

/** 常见执行器内显式执行另一个程序时，继续检查被包装的命令。 */
function nestedCommand(program: string, args: string[]): string[] | undefined {
  if (program === 'corepack' && ['npm', 'pnpm', 'yarn'].includes(args[0])) return args
  if (['npx', 'bunx'].includes(program)) {
    let index = 0
    while (['-y', '--yes', '--no-install'].includes(args[index])) index++
    return args.slice(index)
  }
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(program) && ['exec', 'x', 'dlx'].includes(args[0])) return args.slice(1)
  if (['uv', 'poetry', 'pdm', 'bundle', 'bundler'].includes(program) && ['run', 'exec'].includes(args[0])) return args.slice(1)
  return undefined
}

/** 比第一层优先：高影响系统操作需人工确认，其他风险交给第二层规则/模型审核。 */
export function statementReview(program: string, args: string[]): CommandReview | undefined {
  const toolPolicy = developerToolPolicy(program, args)
  if (toolPolicy?.kind === 'review' || toolPolicy?.kind === 'block') return { reason: toolPolicy.reason, mustConfirm: toolPolicy.mustConfirm }
  if (args.length === 1 && ['--help', '--version'].includes(args[0])) return undefined
  const lower = args.map(value => value.toLowerCase())
  const nested = nestedCommand(program, args)
  if (nested) {
    const rest = nested[0] === '--' ? nested.slice(1) : nested
    const child = rest[0]?.split(/[\\/]/).at(-1)?.replace(/\.(?:exe|cmd|bat)$/i, '').toLowerCase()
    // 不递归调用，避免深度不受限的包装链；已知开发程序由原有规则处理。
    if (!child || child.startsWith('-') || nestedCommand(child, rest.slice(1))) return { reason: '执行器嵌套调用或参数不明确，需要审核实际执行的命令。' }
    if (privilegedPrograms.has(child) || permissionPrograms.has(child) || systemPrograms.has(child)) return { reason: '开发执行器内调用了提权、权限或系统管理命令，必须人工确认。', mustConfirm: true }
    const shellOrSystem = ['bash', 'sh', 'dash', 'zsh', 'fish', 'pwsh', 'powershell', 'cmd', 'systemctl', 'service', 'crontab', 'sysctl', 'git'].includes(child)
    const inlineCode = /^(?:python[\d.]*|py|node|nodejs|ruby|perl|php)$/.test(child)
      && rest.slice(1).some(value => /^-(?:c|e|r|p)|^--(?:eval|print|require|import)/.test(value))
    if (filePrograms.has(child) || shellOrSystem || inlineCode) return { reason: '开发执行器内调用了文件、系统、Shell 或内联代码操作，需要审核。' }
  }
  if (privilegedPrograms.has(program)) return { reason: '命令涉及提权或切换用户，必须人工确认。', mustConfirm: true }
  if (permissionPrograms.has(program)) return { reason: '命令会修改所有权、访问权限或文件安全属性，必须人工确认。', mustConfirm: true }
  if (systemPrograms.has(program)) return { reason: '命令涉及系统、账户、防火墙、进程或服务管理，必须人工确认。', mustConfirm: true }
  if (['systemctl', 'service', 'rc-service', 'launchctl', 'sc'].includes(program)) {
    if (!['status', 'show', 'is-active', 'is-enabled', 'is-failed', 'list-units', 'list-unit-files', 'list-timers', 'cat', 'query', 'qc', 'print', 'list'].includes(lower[0])) return { reason: '命令可能改变服务状态或启动配置，必须人工确认。', mustConfirm: true }
  }
  if (program === 'crontab' && !(args.length === 1 && args[0] === '-l')) return { reason: '命令可能修改定时任务，必须人工确认。', mustConfirm: true }
  if (program === 'sysctl' && args.some(value => value.includes('=') || /^-(?:w|p|f)|^--(?:write|load|system)/.test(value))) return { reason: '命令可能修改内核参数，必须人工确认。', mustConfirm: true }
  if (['fdisk', 'sfdisk', 'parted', 'wipefs', 'blkdiscard', 'cryptsetup', 'mdadm', 'pvcreate', 'pvremove', 'vgremove', 'lvremove', 'lvreduce', 'resize2fs', 'xfs_growfs'].includes(program)) return { reason: '命令涉及磁盘、分区或存储结构，必须人工确认。', mustConfirm: true }
  if (['dd', 'shred'].includes(program)) return { reason: '命令可能覆写数据或设备，必须人工确认。', mustConfirm: true }
  if (packageManagers.has(program) && lower.some(value => /^(?:install|remove|uninstall|purge|autoremove|update|upgrade|full-upgrade|dist-upgrade|add|del|erase|refresh|rollback)$/.test(value) || /^-[sru]/i.test(value))) return { reason: '命令可能安装、删除或更新系统级软件，必须人工确认。', mustConfirm: true }
  if (['rpm', 'dpkg'].includes(program) && !args.some(value => /^(?:--query|--queryformat|--list|--status|-q.*|-l|-s)$/.test(value))) return { reason: '命令可能修改系统软件包，必须人工确认。', mustConfirm: true }
  if (['ip', 'ifconfig', 'route', 'nmcli', 'networksetup'].includes(program) && lower.some(value => ['add', 'del', 'delete', 'replace', 'flush', 'set', 'up', 'down', 'modify', 'connect', 'disconnect'].includes(value))) return { reason: '命令可能修改网络配置或中断连接，必须人工确认。', mustConfirm: true }
  if (['curl', 'wget', 'wget2'].includes(program) && args.some(value => /^--(?:request|method|data(?:-[\w-]+)?|post-data|post-file|upload-file|insecure|no-check-certificate)(?:=|$)/.test(value) || /^-[^-]*[XdTkF]/.test(value))) return { reason: '网络命令可能提交或删除远程数据、上传文件或跳过证书验证，需要审核。' }
  return undefined
}

/** 扫描复合命令只用于提升风险，不用它授予执行权限。 */
export function commandReview(command: string): CommandReview | undefined {
  let result: CommandReview | undefined
  for (const words of inspectedShellCommands(command)) {
    let args = words
    while (['command', 'exec', 'env', 'busybox'].includes(args[0]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(args[0] ?? '')) args = args.slice(1)
    const program = args[0]?.split(/[\\/]/).at(-1)?.replace(/\.(?:exe|cmd|bat)$/i, '').toLowerCase()
    if (!program) continue
    const review = statementReview(program, args.slice(1))
    if (review?.mustConfirm) return review
    result ??= review
  }
  return result
}
