import { inspectedShellCommands, shellProgram, shellWriteRedirection } from './shell-command-words'
import { developerToolPolicy } from './developer-tool-policy'

const fileCommands = new Set([
  'out-file', 'set-content', 'add-content', 'clear-content', 'tee-object',
  'remove-item', 'move-item', 'copy-item', 'rename-item', 'new-item', 'set-item', 'clear-item',
  'export-csv', 'export-clixml', 'export-pssession',
  'ac', 'clc', 'ri', 'rd', 'md', 'ni', 'mi', 'mvi', 'cpi', 'rni', 'si', 'cli',
  'rm', 'rmdir', 'mv', 'move', 'cp', 'copy', 'mkdir', 'touch', 'del', 'erase', 'ren', 'rename', 'mklink',
  'unlink', 'truncate', 'tee', 'ln', 'install', 'mktemp', 'fallocate', 'mknod',
  'split', 'csplit', 'sponge', 'shred', 'rimraf'
])

function helpOnly(args: string[]): boolean {
  return args.length === 1 && ['--help', '--version', '/?', '-?', '-h'].includes(args[0].toLowerCase())
}

/** 只为明确无歧义的参数组合豁免；未知带值选项可能把预演开关当作普通数据。 */
function simpleOptions(args: string[], allowed: RegExp): boolean {
  return args.every(value => !value.startsWith('-') || allowed.test(value))
}

/** 不按整段文本匹配：echo/Write-Host 中引用危险命令不会被当成执行。 */
export function destructiveCommandReason(command: string): string | undefined {
  let forkBomb = false
  const commands = inspectedShellCommands(command, source => {
    if (/^\s*:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:\s*$/.test(source)) forkBomb = true
  })
  if (forkBomb) return '禁止执行会持续派生进程的 fork bomb'
  for (const tokens of commands) {
    const program = shellProgram(tokens[0]), args = tokens.slice(1)
    if (helpOnly(args)) continue
    const lower = args.map(value => value.toLowerCase())
    if (['format-volume', 'clear-disk', 'initialize-disk', 'remove-partition'].includes(program) && lower.some(value => /^-whatif(?::\$?true)?$/.test(value))) continue
    if (/^(?:mkfs(?:\.[\w-]+)?|mkntfs|mke2fs|mkswap|newfs(?:_[\w-]+)?)$/.test(program) || ['format', 'format-volume', 'clear-disk', 'initialize-disk', 'remove-partition', 'diskpart'].includes(program)) return '禁止通过终端格式化、清空或重建磁盘、分区及文件系统'
    if (program === 'diskutil' && lower.some(value => ['erasedisk', 'erasevolume', 'partitiondisk', 'zerodisk', 'secureerase'].includes(value))) return '禁止通过终端抹除磁盘或分区'
    if (program === 'vssadmin' && lower[0] === 'delete' && lower[1] === 'shadows' || program === 'wbadmin' && lower[0] === 'delete' || program === 'sdelete' || program === 'cipher' && lower.some(value => /^\/w(?::|$)/.test(value))) return '禁止销毁卷影副本、备份或执行不可恢复的安全擦除'
    if (program === 'wevtutil' && ['cl', 'clear-log'].includes(lower[0]) || program === 'clear-eventlog' || program === 'journalctl' && args.some(value => /^--vacuum-(?:size|time|files)(?:=|$)/.test(value))) return '禁止通过终端清空系统事件日志或批量销毁历史日志'
    if (program === 'bcdedit' && lower.includes('/delete') || ['bootrec', 'bootsect'].includes(program) && lower.some(value => /^\/(?:fixmbr|fixboot|rebuildbcd|nt52|nt60)(?::|$)/.test(value))) return '禁止通过终端删除启动项或覆写系统启动记录'
    if (program === 'wipefs' && !args.includes('--no-act') && !args.includes('-n') && args.some(value => /^--(?:all|offset)(?:=|$)|^-[^-]*[ao]/.test(value))) return '禁止擦除文件系统或分区签名'
    if (program === 'blkdiscard' && !args.includes('--dry-run') || program === 'sg_format' && args.some(value => /^--(?:format|resize)(?:=|$)/.test(value))) return '禁止直接丢弃或格式化存储设备数据'
    if (program === 'sgdisk' && args.some(value => /^--(?:zap|zap-all|clear)(?:=|$)|^-[^-]*[zoZ]/.test(value))) return '禁止清空磁盘分区表'
    if (program === 'parted' && lower.some(value => ['mklabel', 'mktable', 'mkpart', 'rm', 'resizepart'].includes(value))) return '禁止通过终端重建、删除或调整磁盘分区'
    if (program === 'cryptsetup' && lower.some(value => ['luksformat', 'lukserase', 'erase'].includes(value))) return '禁止清空加密卷数据或密钥'
    if (program === 'nvme' && ['format', 'sanitize'].includes(lower[0]) || program === 'hdparm' && args.some(value => /^--(?:security-erase|security-erase-enhanced|sanitize-)/.test(value)) || program === 'badblocks' && args.some(value => /^-[^-]*w/.test(value))) return '禁止破坏性设备擦除或写入检测'
    const destinations = program === 'dd' ? args.filter(value => value.startsWith('of=')).map(value => value.slice(3))
      : program === 'cp' ? args.slice(-1) : ['shred', 'tee'].includes(program) ? args : []
    if (destinations.some(value => /^(?:\/dev\/(?:sd[a-z]|hd[a-z]|vd[a-z]|xvd[a-z]|nvme\d|mmcblk\d|mapper\/|disk\d)|\\\\[.?]\\(?:physicaldrive|[a-z]:))/i.test(value))) return '禁止通过终端覆写原始磁盘或块设备'
  }
  return undefined
}

/** 直接文件修改使用专用工具；明确只输出到终端或预演的形式仍走普通审核。 */
export function shellFileMutationReason(command: string): string | undefined {
  let redirected = false
  const commands = inspectedShellCommands(command, source => { if (shellWriteRedirection(source)) redirected = true })
  if (redirected) return '检测到终端重定向写文件。修改文件请改用 write、edit 等专用文件工具。'
  for (const tokens of commands) {
    const program = shellProgram(tokens[0]), args = tokens.slice(1)
    if (helpOnly(args)) continue
    const toolPolicy = developerToolPolicy(program, args)
    if (toolPolicy?.kind === 'block') return toolPolicy.reason
    const lower = args.map(value => value.toLowerCase())
    const optionEnd = args.indexOf('--')
    const options = optionEnd < 0 ? args : args.slice(0, optionEnd)
    const lowerOptions = options.map(value => value.toLowerCase())
    let writes = fileCommands.has(program)
    if (program === 'link' && process.platform !== 'win32') writes = true
    if (/^\[(?:system\.)?io\.(?:file|directory)\]::(?:writeall(?:text|bytes|lines)|appendall(?:text|lines)|create(?:text|directory|symboliclink)?|openwrite|delete|move|copy|replace)$/.test(program)) writes = true
    // sc.exe 是服务控制器；裸 sc 在 Windows PowerShell 中可能是 Set-Content。
    if (program === 'sc' && !/\.exe$/i.test(tokens[0])) writes = true
    if (['xcopy', 'robocopy'].includes(program)) writes = !lower.includes('/l') || lower.some(value => /^\/(?:unilog|log)(?:\+|:|$)/.test(value))
    if (program === 'rsync') {
      const preview = options.includes('--list-only') || options.includes('--dry-run') || options.some(value => /^-[avzhnrltpogD]*n[avzhnrltpogD]*$/.test(value))
      writes = !(preview && simpleOptions(options, /^(?:-[avzhnrltpogD]+|--(?:list-only|dry-run|archive|verbose|recursive|itemize-changes|stats|delete))$/))
    }
    if (program === 'dd') writes = args.some(value => /^of=/.test(value))
    if (program === 'find') {
      for (let index = 0; index < args.length; index++) {
        if (['-name', '-iname', '-path', '-ipath', '-regex', '-iregex', '-type', '-size', '-mtime', '-mmin', '-maxdepth', '-mindepth', '-user', '-group', '-perm', '-printf'].includes(args[index])) { index++; continue }
        if (['-delete', '-fprint', '-fprint0', '-fprintf', '-fls'].includes(args[index])) { writes = true; break }
      }
    }
    if (program === 'fsutil' && lower[0] === 'file' && ['createnew', 'seteof', 'setvaliddata', 'setzerodata'].includes(lower[1])) writes = true
    if (['sed', 'perl', 'ruby'].includes(program)) writes = options.some(value => /^--in-place(?:=|$)|^-[^-]*i/.test(value))
    if (program === 'sort') writes = options.some(value => /^--output(?:=|$)|^-[^-]*o/.test(value))
    if (program === 'patch') writes = !(options.includes('--dry-run') && simpleOptions(options, /^(?:--(?:dry-run|batch|silent)|-[RNsftu]|-p\d+)$/))
    if (program === 'tar') {
      const flags = [...options.filter(value => /^-[^-]/.test(value)), ...(/^[ctxruAvzjJfO]+$/.test(options[0] ?? '') ? [options[0]] : [])].join('')
      writes = options.some(value => /^--(?:create|extract|get|append|update|concatenate|catenate|delete)(?:=|$)/.test(value)) || /[cxruA]/.test(flags)
      // 仅识别短选项的明确 stdout 形式，不能把 -f 的文件名 -O 误当作输出开关。
      if (/^-?x[vzjJ]*Of$/.test(args[0] ?? '') && args.length >= 2 && args.slice(1).every(value => !value.startsWith('-'))) writes = false
      if (options.some(value => /^--index-file(?:=|$)/.test(value))) writes = true
    }
    if (['unzip', '7z', '7za', '7zz'].includes(program)) writes = program === 'unzip'
      ? !(options.some(value => /^-[lvtZpq]*[lvtZp][lvtZpq]*$/.test(value)) && simpleOptions(options, /^-[lvtZpq]+$/))
      : ['a', 'u', 'd', 'e', 'x', 'rn'].includes(lower.find(value => !value.startsWith('-')) ?? '')
    if (['gzip', 'gunzip', 'bzip2', 'bunzip2', 'xz', 'unxz', 'zstd', 'unzstd'].includes(program)) {
      const query = options.some(value => /^--(?:stdout|test|list)$|^-[cdfktlvqz1-9]*[ctl][cdfktlvqz1-9]*$/.test(value))
      writes = args.length > 0 && !(query && simpleOptions(options, /^(?:--(?:stdout|test|list|decompress|keep|force|quiet|verbose)|-[cdfktlvqz1-9]+)$/))
    }
    if (['compress-archive', 'expand-archive'].includes(program)) writes = !lowerOptions.some(value => /^-whatif(?::\$?true)?$/.test(value))
    if (fileCommands.has(program) && lowerOptions.some(value => /^-whatif(?::\$?true)?$/.test(value))) writes = false
    if (writes) return '检测到通过终端创建、修改、删除或解包文件。请改用 write、edit、delete、mkdir、move、copy 等专用文件工具。'
  }
  return undefined
}
