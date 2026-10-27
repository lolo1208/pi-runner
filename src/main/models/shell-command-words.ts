/** 仅扫描命令与实参，不执行或展开脚本；保留引号内的完整参数，避免误拦打印文本。 */
export function shellCommandWords(source: string): string[][] {
  const commands: string[][] = []
  let args: string[] = [], word = '', quote = '', started = false
  const flushWord = (): void => { if (started) args.push(word); word = ''; started = false }
  const flushCommand = (): void => { flushWord(); if (args.length) commands.push(args); args = [] }
  for (let index = 0; index < source.length; index++) {
    const character = source[index]
    if (quote) {
      if (character === quote) {
        if (quote === "'" && source[index + 1] === "'") { word += "'"; index++ }
        else quote = ''
      } else if (character === '`' && quote === '"' && index + 1 < source.length) word += source[++index]
      else word += character
    } else if (character === '"' || character === "'") { quote = character; started = true }
    else if (character === '`' && index + 1 < source.length) { word += source[++index]; started = true }
    else if (/[;\r\n|&(){}]/.test(character)) flushCommand()
    else if (/\s/.test(character)) flushWord()
    else { word += character; started = true }
  }
  flushCommand()
  return commands
}

/** 用于拒绝规则的有限展开：只读取字面量参数，不加载脚本、不执行或解码内容。 */
export function inspectedShellCommands(source: string, inspectSource?: (source: string) => void): string[][] {
  const commands: string[][] = []
  const inspect = (text: string, depth: number): void => {
    if (depth > 3 || text.length > 16000 || commands.length >= 256) return
    inspectSource?.(text)
    for (const words of shellCommandWords(text)) {
      if (commands.length >= 256) return
      let args = words
      for (let count = 0; count < 8 && args.length && commands.length < 256; count++) {
        commands.push(args)
        const executable = shellProgram(args[0])
        const program = /^(?:npm|pnpm|yarn|npx|bunx|corepack|tauri|tsx|ts-node|ts-node-esm)\.(?:cmd|bat)$/.test(executable) ? executable.replace(/\.(?:cmd|bat)$/, '') : executable
        let offset = 1
        if (['command', 'exec', 'sudo', 'doas', 'env', 'busybox', 'nohup', 'nice'].includes(program)) {
          while (offset < args.length) {
            const value = args[offset]
            if (value === '--') { offset++; break }
            if (program === 'env' && /^[A-Za-z_][A-Za-z0-9_]*=/.test(value)) { offset++; continue }
            if (program === 'sudo' && /^(?:--(?:user|group)=|-[ug].+)/.test(value) || program === 'env' && /^--(?:unset|chdir)=/.test(value)) { offset++; continue }
            if ((program === 'command' && value === '-p') || (program === 'exec' && ['-c', '-l'].includes(value)) || (program === 'env' && ['-i', '--ignore-environment'].includes(value)) || (program === 'sudo' && ['-n', '-E', '-H'].includes(value))) { offset++; continue }
            if ((program === 'sudo' && ['-u', '-g', '--user', '--group'].includes(value)) || (program === 'doas' && value === '-u') || (program === 'env' && ['-u', '--unset', '-C', '--chdir'].includes(value)) || (program === 'exec' && value === '-a') || (program === 'nice' && value === '-n')) { offset += 2; continue }
            break
          }
          if (!args[offset] || args[offset].startsWith('-')) break
          args = args.slice(offset); continue
        }
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(args[0])) { args = args.slice(1); continue }
        if (['npx', 'bunx'].includes(program)) {
          while (offset < args.length) {
            if (['-y', '--yes', '--no-install'].includes(args[offset]) || /^--package=/.test(args[offset])) { offset++; continue }
            if (['-p', '--package'].includes(args[offset])) { offset += 2; continue }
            if (args[offset] === '--') offset++
            break
          }
          if (['-c', '--call'].includes(args[offset])) { if (args[offset + 1]) inspect(args[offset + 1], depth + 1); break }
          if (args[offset]?.startsWith('--call=')) { inspect(args[offset].slice(7), depth + 1); break }
          if (!args[offset] || args[offset].startsWith('-')) break
          args = args.slice(offset); continue
        }
        if (program === 'xargs') {
          while (offset < args.length) {
            if (['-0', '--null', '-r', '--no-run-if-empty', '-t', '--verbose', '-p'].includes(args[offset]) || /^-(?:I|n|P|d).+|^--(?:max-args|max-procs|replace|delimiter)=/.test(args[offset])) { offset++; continue }
            if (['-n', '--max-args', '-P', '--max-procs', '-I', '--replace', '-d', '--delimiter', '-a', '--arg-file'].includes(args[offset])) { offset += 2; continue }
            if (args[offset] === '--') offset++
            break
          }
          if (!args[offset] || args[offset].startsWith('-')) break
          args = args.slice(offset); continue
        }
        if (program === 'timeout' && /^\d+(?:\.\d+)?[smhd]?$/.test(args[1] ?? '')) { args = args.slice(2); continue }
        if (program === 'find') {
          const index = args.findIndex(value => ['-exec', '-execdir', '-ok', '-okdir'].includes(value))
          if (index > 0) {
            const nested = args.slice(index + 1)
            const end = nested.findIndex(value => [';', '\\;', '+'].includes(value))
            const invocation = end < 0 ? nested : nested.slice(0, end)
            inspect(invocation.map(value => "'" + value.replace(/'/g, "''") + "'").join(' '), depth + 1)
          }
        }
        if (program === 'corepack' && ['npm', 'pnpm', 'yarn'].includes(args[1])) { args = args.slice(1); continue }
        if (program === 'cmake' && args[1] === '-E' && args[2] === 'env') { args = args.slice(2); continue }
        if (program === 'cmake' && args[1] === '-E' && args[2] === 'chdir') { args = args.slice(4); continue }
        if (['npm', 'pnpm', 'yarn', 'bun', 'uv', 'poetry', 'pdm', 'bundle', 'bundler'].includes(program)) {
          let operation = 1
          while (operation < args.length) {
            if (['--filter', '-F', '--dir', '-C', '--prefix', '--workspace', '-w'].includes(args[operation])) { operation += 2; continue }
            if (/^--(?:filter|dir|prefix|workspace|package)=/.test(args[operation])) { operation++; continue }
            break
          }
          if (['exec', 'dlx', 'x', ...(['uv', 'poetry', 'pdm'].includes(program) ? ['run'] : [])].includes(args[operation])) {
            let child = operation + 1
            while (child < args.length) {
              if (['-y', '--yes'].includes(args[child]) || /^--package=/.test(args[child])) { child++; continue }
              if (['-p', '--package'].includes(args[child])) { child += 2; continue }
              if (args[child] === '--') child++
              break
            }
            if (['-c', '--call'].includes(args[child])) { if (args[child + 1]) inspect(args[child + 1], depth + 1); break }
            if (args[child]?.startsWith('--call=')) { inspect(args[child].slice(7), depth + 1); break }
            if (!args[child] || args[child].startsWith('-')) break
            args = args.slice(child); continue
          }
        }
        if (['sh', 'bash', 'dash', 'zsh', 'ksh'].includes(program)) {
          const index = args.findIndex((value, position) => position > 0 && /^-[a-z]*c[a-z]*$/.test(value))
          if (index > 0 && args[index + 1]) inspect(args[index + 1], depth + 1)
        }
        if (['powershell', 'pwsh'].includes(program)) {
          const index = args.findIndex(value => /^-(?:command|c)$/i.test(value))
          if (index > 0) inspect(args.slice(index + 1).join(' '), depth + 1)
        }
        if (program === 'cmd') {
          const index = args.findIndex(value => /^\/[ck]$/i.test(value))
          if (index > 0) inspect(args.slice(index + 1).join(' '), depth + 1)
        }
        break
      }
    }
  }
  inspect(source, 0)
  return commands
}

export function shellProgram(executable: string): string {
  return executable.split(/[\\/]/).at(-1)!.replace(/\.exe$/i, '').toLowerCase()
}

/** 引号外的文件重定向；允许 2>&1 等文件描述符重定向。 */
export function shellWriteRedirection(command: string): boolean {
  let quote = ''
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
    if (character === '>') {
      if (command[index + 1] === '>') return true
      if (command[index + 1] === '&' && /\d/.test(command[index + 2] ?? '')) { index += 2; continue }
      return true
    }
  }
  return false
}
