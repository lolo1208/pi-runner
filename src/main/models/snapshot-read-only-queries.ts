/** 仅影响快照准备，不授予命令执行权限；未识别的选项继续保留执行前基线。 */
function queryOptions(args: string[], flags: string[], values: string[] = [], operands = true): boolean {
  let literal = false
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (literal) { if (!operands) return false; continue }
    if (argument === '--') { literal = true; continue }
    if (!argument.startsWith('-')) { if (!operands) return false; continue }
    if (flags.includes(argument)) continue
    const equal = argument.indexOf('=')
    if (equal > 0 && values.includes(argument.slice(0, equal)) && argument.slice(equal + 1)) continue
    if (values.includes(argument) && args[index + 1] && !args[index + 1].startsWith('-')) { index++; continue }
    return false
  }
  return true
}

const versionPrograms = new Set([
  'node', 'nodejs', 'npm', 'pnpm', 'yarn', 'corepack', 'bun', 'deno',
  'python', 'python3', 'pip', 'pip3', 'uv', 'poetry', 'ruby', 'gem', 'perl', 'php', 'composer',
  'cargo', 'rustc', 'rustup', 'dotnet', 'swift', 'gcc', 'g++', 'clang', 'clang++',
  'cmake', 'ninja', 'make', 'meson', 'git', 'docker', 'kubectl', 'terraform',
])
const systemQueries = new Set([
  'get-filehash', 'get-acl', 'get-date', 'get-host', 'get-culture', 'get-uiculture',
  'get-process', 'gps', 'get-service', 'gsv', 'get-computerinfo', 'get-ciminstance',
  'get-psdrive', 'get-psprovider', 'get-variable', 'get-alias', 'gal', 'get-module',
  'get-executionpolicy', 'get-netipaddress', 'get-nettcpconnection', 'get-dnsclientserveraddress',
  'get-volume', 'get-disk', 'get-partition', 'get-itempropertyvalue', 'get-childitem',
  'findstr', 'sha256sum', 'sha512sum', 'sha1sum', 'md5sum', 'shasum', 'cksum',
  'du', 'df', 'uname', 'whoami', 'id', 'which', 'whereis', 'printenv', 'basename', 'dirname',
  'realpath', 'readlink', 'cmp', 'diff',
])

export function knownReadOnlyQuery(program: string, args: string[]): boolean {
  if (systemQueries.has(program)) return true
  if (versionPrograms.has(program) && args.length === 1 && args[0] === '--version') return true
  if (['node', 'nodejs', 'npm', 'pnpm', 'yarn', 'bun', 'php'].includes(program) && args.length === 1 && args[0] === '-v') return true
  if (['rustc', 'cargo', 'rustup'].includes(program) && args.length === 1 && ['-V', '-Vv'].includes(args[0])) return true
  if (['java', 'javac'].includes(program) && args.length === 1 && ['-version', '--version'].includes(args[0])) return true
  if (program === 'zig' && args.length === 1 && args[0] === 'version') return true
  if (program === 'dotnet' && args.length === 1 && ['--info', '--list-sdks', '--list-runtimes'].includes(args[0])) return true
  if (program === 'hostname') return args.length === 0 || args.length === 1 && ['-f', '--fqdn', '-s', '-i', '-I', '-d'].includes(args[0])
  if (program === 'certutil') return args[0]?.toLowerCase() === '-hashfile' && args.length >= 2 && args.length <= 3 && !args[1].startsWith('-')
  if (program === 'file') return queryOptions(args, ['-b', '--brief', '-i', '--mime', '--mime-type', '--mime-encoding', '-L', '--dereference', '-h', '--no-dereference'])
  if (program === 'tree') return queryOptions(args, ['-a', '-d', '-f', '-i', '-p', '-s', '-h', '-D', '-F', '-n', '-C', '-r', '-t', '/F', '/A', '--dirsfirst', '--noreport'], ['-L', '-I', '-P', '--filelimit'])
  // find 在 -- 后仍解释表达式，不能把后面的 -delete/-exec 当作普通路径。
  if (program === 'find') return !args.includes('--') && queryOptions(args,
    ['-H', '-L', '-P', '-print', '-print0', '-ls', '-empty', '-readable', '-writable', '-executable', '-not', '!', '-a', '-and', '-o', '-or'],
    ['-name', '-iname', '-path', '-ipath', '-type', '-maxdepth', '-mindepth', '-size', '-mtime', '-mmin', '-user', '-group', '-perm'])
  if (program === 'go') {
    if (args[0] === 'version') return queryOptions(args.slice(1), ['-m', '-v', '-json'])
    if (args[0] === 'env') return !args.includes('--') && queryOptions(args.slice(1), ['-json', '-changed']) && args.slice(1).every(value => value.startsWith('-') || /^[A-Z][A-Z0-9_]*$/.test(value))
    return false
  }
  // pnpm 的未知子命令可能回退到项目脚本，不能沿用 npm 独有的 explain。
  if ((program === 'npm' && ['ls', 'list', 'why', 'explain'].includes(args[0]) || program === 'pnpm' && ['ls', 'list', 'why'].includes(args[0]))) return queryOptions(args.slice(1),
    ['--json', '--long', '--all', '--global', '-g', '--parseable', '--prod', '--dev', '--production', '--only-projects', '--recursive', '-r'], ['--depth', '--filter', '--workspace', '-w'])
  if (program === 'npm' && args[0] === 'pkg' && args[1] === 'get') return queryOptions(args.slice(2), ['--json'], ['--workspace'])
  if (['pip', 'pip3'].includes(program)) {
    if (args[0] === 'show') return queryOptions(args.slice(1), ['-f', '--files'])
    if (args[0] === 'list') return queryOptions(args.slice(1), ['--local', '--user', '--outdated', '--uptodate', '--not-required', '--exclude-editable'], ['--format'], false)
    return args.length === 1 && args[0] === 'check'
  }
  if (program === 'docker') {
    if (['version', 'info', 'ps', 'images', 'inspect'].includes(args[0])) return queryOptions(args.slice(1), ['--all', '-a', '--quiet', '-q', '--no-trunc', '--size', '-s', '--digests'], ['--format', '-f', '--filter', '--type'])
    return args[0] === 'system' && args[1] === 'df' && queryOptions(args.slice(2), ['-v', '--verbose'], ['--format'], false)
  }
  return false
}

export function readOnlyGitQuery(subcommand: string, args: string[]): boolean {
  if (subcommand === 'branch') return queryOptions(args,
    ['--list', '-l', '-a', '--all', '-r', '--remotes', '-v', '-vv', '--verbose', '--show-current', '--no-color', '--no-abbrev'],
    ['--contains', '--no-contains', '--merged', '--no-merged', '--points-at', '--format', '--sort', '--abbrev'], args.includes('--list') || args.includes('-l'))
  if (subcommand === 'tag') return args.length === 0 || (args.includes('--list') || args.includes('-l')) && queryOptions(args,
    ['--list', '-l', '-n', '--ignore-case', '--no-column'], ['--contains', '--merged', '--points-at', '--format', '--sort'])
  if (subcommand === 'remote') {
    if (args.length === 0 || args.length === 1 && ['-v', '--verbose'].includes(args[0])) return true
    return args[0] === 'get-url' && args.filter(value => !['--all', '--push'].includes(value)).length === 2 && queryOptions(args.slice(1), ['--all', '--push'])
  }
  if (subcommand === 'worktree') return args[0] === 'list' && queryOptions(args.slice(1), ['--porcelain', '-z', '-v', '--verbose'], [], false)
  if (subcommand === 'config') {
    const query = args[0]
    if (['--get', '--get-all', '--get-regexp', '--get-urlmatch'].includes(query)) return args.length >= 2 && args.length <= 3 && args.slice(1).every(value => !value.startsWith('-'))
    if (['get', 'list'].includes(query)) return queryOptions(args.slice(1), ['--all', '--global', '--local', '--system', '--show-origin', '--show-scope', '--name-only', '--null'], ['--file', '-f', '--type'], query === 'get')
    return args.some(value => value === '--list' || value === '-l') && queryOptions(args, ['--list', '-l', '--global', '--local', '--system', '--show-origin', '--show-scope', '--name-only', '--null', '-z'], ['--file', '-f'], false)
  }
  // stash 的其他子命令会修改工作区，只有明确的列表与差异查询可跳过。
  if (subcommand === 'stash') return ['list', 'show'].includes(args[0]) && queryOptions(args.slice(1), ['--stat', '--patch', '-p', '--name-only', '--name-status', '--numstat', '--include-untracked', '-u'], ['--format', '--max-count'])
  return false
}
