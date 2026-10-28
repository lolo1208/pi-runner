/** 查询分类供快照与权限路由复用；未识别的修改选项继续保留执行前审核。 */
import { queryOptions } from './command-query-options'
import { developerToolPolicy } from './developer-tool-policy'

const versionPrograms = new Set([
  'node', 'nodejs', 'npm', 'pnpm', 'yarn', 'corepack', 'bun', 'deno', 'electron', 'electron-vite', 'electron-builder',
  'python', 'python3', 'pip', 'pip3', 'uv', 'poetry', 'ruby', 'gem', 'perl', 'php', 'composer',
  'cargo', 'rustc', 'rustup', 'dotnet', 'swift', 'gcc', 'g++', 'clang', 'clang++',
  'cmake', 'ninja', 'make', 'meson', 'git', 'docker', 'kubectl', 'terraform',
  'curl', 'wget', 'wget2', 'aria2c', 'jq', 'yq', 'rg', 'fd', 'fdfind', 'bat', 'batcat', 'eza',
  'ruff', 'black', 'mypy', 'isort', 'uvx', 'bunx', 'hatch', 'pdm', 'tox', 'nox',
  'tsc', 'vue-tsc', 'vite', 'vitest', 'eslint', 'prettier', 'biome', 'swc', 'next', 'nuxt', 'astro',
  'swiftc', 'cc', 'c++', 'clang-cl', 'csc', 'fsc', 'julia', 'r', 'rscript', 'lua', 'luajit',
  'mvn', 'mvnw', 'gradle', 'gradlew', 'sbt', 'ant', 'bazel', 'bazelisk', 'just', 'task',
  'dart', 'flutter', 'composer', 'bundle', 'bundler', 'jupyter',
])
type QuerySpec = { flags: string[]; values: string[]; operands: boolean }
const querySpecs: Record<string, QuerySpec> = Object.create(null) as Record<string, QuerySpec>
function queries(programs: string, flags = '', values = '', operands = true): void {
  const spec = { flags: flags.split(' ').filter(Boolean), values: values.split(' ').filter(Boolean), operands }
  for (const program of programs.split(' ')) querySpecs[program] = spec
}

// 只认可明确的查询选项；分页器、日志文件、插件/预处理器及未知参数不按程序名兜底。
queries('ls', '-a -A -l -h -R -d -F -i -s -t -r -S -1 -n -p --all --almost-all --long --human-readable --recursive --directory --classify --inode --size --reverse --numeric-uid-gid --color --group-directories-first', '--color --sort --time --time-style --quoting-style --block-size')
queries('cat', '-n -b -s -v -E -T -A --number --number-nonblank --squeeze-blank --show-all --show-ends --show-tabs --show-nonprinting')
queries('head tail', '-q -v --quiet --verbose', '-n -c --lines --bytes')
queries('wc', '-c -m -l -w -L --bytes --chars --lines --words --max-line-length', '--files0-from')
queries('pwd', '-L -P --logical --physical', '', false)
queries('stat', '-L -f -t --dereference --file-system --terse', '-c --format --printf')
queries('grep', '-n -H -h -i -v -r -R -l -L -c -w -x -F -E -P -q -s -o -a -I --line-number --ignore-case --invert-match --recursive --files-with-matches --count --word-regexp --fixed-strings --extended-regexp --quiet --only-matching', '-e -f -m -A -B -C --regexp --file --max-count --after-context --before-context --context --include --exclude --exclude-dir')
queries('rg', '-n -N -H -i -s -S -v -l -L -c -w -x -F -q -a -U -uu -uuu -u --hidden --no-ignore --no-ignore-vcs --files --files-with-matches --files-without-match --count --count-matches --word-regexp --fixed-strings --ignore-case --case-sensitive --smart-case --quiet --only-matching -o --line-number --no-heading --heading --json --multiline --pcre2 -P --stats --text --null -0', '-e -f -g -t -T -m -A -B -C --regexp --file --glob --iglob --type --type-not --max-count --after-context --before-context --context --max-depth --max-columns --color --encoding --sort --sortr --replace')
queries('cut', '-s --only-delimited --complement', '-b -c -f -d --bytes --characters --fields --delimiter --output-delimiter')
queries('tr', '-c -C -d -s --complement --delete --squeeze-repeats')
queries('sort', '-b -d -f -g -h -i -M -n -r -s -u -V -z --check --unique --reverse --numeric-sort --version-sort --stable --debug', '-k -t --key --field-separator --buffer-size')
queries('od', '-a -b -c -d -f -i -l -o -s -x -v', '-A -j -N -t -w --address-radix --skip-bytes --read-bytes --format --width')
queries('hexdump', '-b -c -C -d -o -x -v', '-n -s -e -f')
queries('sha256sum sha512sum sha1sum md5sum', '-b -t -c -w -z --binary --text --check --warn --status --quiet --strict --tag --zero')
queries('shasum', '-b -t -c -w --binary --text --check --warn --status --quiet --strict --tag', '-a --algorithm')
queries('cksum', '-b -t --base64 --raw --tag --untagged', '-a --algorithm')
queries('du', '-a -s -h -c -b -k -m -L -P -x --all --summarize --human-readable --total --bytes --one-file-system', '-d --max-depth --exclude --block-size --threshold')
queries('df', '-a -h -H -i -k -l -P -T --all --human-readable --inodes --local --print-type --output', '-t -x --type --exclude-type --block-size --output')
queries('uname', '-a -s -n -r -v -m -p -i -o --all --kernel-name --nodename --kernel-release --kernel-version --machine --processor --hardware-platform --operating-system', '', false)
queries('id', '-a -u -g -G -n -r -z --user --group --groups --name --real --zero')
queries('whoami logname arch', '', '', false)
queries('nproc', '--all', '--ignore', false)
queries('groups printenv basename dirname', '-a -z --zero --multiple', '-s --suffix')
queries('which', '-a --all')
queries('whereis', '-b -m -s -u')
queries('realpath readlink', '-e -m -f -q -s -z -n --canonicalize --canonicalize-existing --canonicalize-missing --quiet --no-symlinks --zero --no-newline', '--relative-to --relative-base')
queries('cmp', '-b -l -s --print-bytes --verbose --silent --quiet', '-i -n --ignore-initial --bytes')
queries('diff', '-u -U -c -C -r -q -s -a -b -w -B -i -N --unified --context --recursive --brief --report-identical-files --text --ignore-space-change --ignore-all-space --ignore-blank-lines --ignore-case --new-file --color', '-U -C --unified --context --exclude -x --exclude-from -X --color --label')
queries('uptime', '-p -s --pretty --since', '', false)
queries('who', '-a -b -H -q -r -s -u --all --boot --heading --count --runlevel --short --users')
queries('users', '')
queries('lscpu', '-a -b -c -J -e -p --all --online --offline --json --extended --parse', '--extended --parse --sysroot', false)
queries('lsblk', '-a -b -d -f -i -J -l -n -p -r -s -t --all --bytes --nodeps --fs --ascii --json --list --noheadings --paths --raw --inverse --topology', '-o -O --output --sort --sysroot')
queries('lspci', '-v -vv -vvv -n -nn -k -m -mm -t -D', '-s -d')
queries('lsusb', '-v -t', '-s -d -D')
queries('free', '-b -k -m -g -h -w -t --bytes --kibi --mebi --gibi --human --wide --total', '-s -c --seconds --count', false)
queries('sw_vers', '-productName -productVersion -buildVersion', '', false)
queries('mdfind', '-live -count -name -literal -interpret', '-onlyin')
queries('strings', '-a -d -f -o -t --all --data --print-file-name', '-n -t -e --bytes --radix --encoding')
queries('ping', '-4 -6 -a -n -q -v -D -O --numeric --quiet', '-c -i -w -W -s -t -n -l')
queries('ping6', '-n -q -v', '-c -i -w -W -s')
queries('traceroute tracepath tracert', '-4 -6 -n -d -I -T -U', '-m -w -q -h -p')
queries('nslookup', '', '-type -query -q -timeout -retry')
queries('host', '-4 -6 -a -v -w -r -T', '-t -W -R')
queries('netstat', '-a -n -o -b -r -s -e -t -u -l -p -c -an -ano -ant -antp -tulpn --all --numeric --listening --route --statistics', '-p --protocol')

// PowerShell 参数名称不区分大小写；仅支持完整参数名，缩写及未知参数进入审核。
queries('get-location gl get-host get-culture get-uiculture get-tpm', '', '', false)
queries('get-childitem gci', '-force -recurse -file -directory -hidden -name', '-path -literalpath -filter -include -exclude -depth -erroraction -ea')
queries('get-content gc', '-raw -wait', '-path -literalpath -encoding -totalcount -tail -delimiter -stream -readcount')
queries('get-item gi get-itemproperty get-itempropertyvalue', '-force', '-path -literalpath -name -filter -include -exclude')
queries('test-path', '-isvalid', '-path -literalpath -pathtype -filter -include -exclude')
queries('resolve-path', '-relative -force', '-path -literalpath')
queries('get-filehash', '', '-path -literalpath -algorithm')
queries('get-acl', '-audit -allcentralaccesspolicies', '-path -literalpath -filter -include -exclude')
queries('get-date', '-asutc -asunixTimeSeconds', '-date -format -uformat -year -month -day -hour -minute -second -millisecond')
queries('get-process gps', '-includeusername -fileversioninfo -module', '-name -id')
queries('get-service gsv', '-dependentservices -requiredservices', '-name -displayname -include -exclude')
queries('get-computerinfo', '', '-property')
queries('get-ciminstance', '-keyonly -shallow', '-classname -namespace -query -filter -property -computername -operationtimeoutsec')
queries('get-psdrive get-psprovider', '', '-name -psprovider -scope')
queries('get-variable', '-valueonly', '-name -scope -include -exclude')
queries('get-alias gal', '', '-name -definition -scope -include -exclude')
queries('get-module', '-listavailable -all', '-name -fullyqualifiedname')
queries('get-executionpolicy', '-list', '-scope')
queries('get-netipaddress get-nettcpconnection get-netadapter get-netroute get-netipconfiguration get-dnsclientserveraddress', '-all -detailed -includehidden', '-name -interfacealias -interfaceindex -addressfamily -ipaddress -localaddress -localport -remoteaddress -remoteport -state -addressstate -policyStore')
queries('get-volume get-disk get-partition', '', '-number -disknumber -partitionnumber -driveletter -friendlyname -uniqueid -path')
queries('get-hotfix', '', '-id -description -computername')
queries('resolve-dnsname', '-dnsonly -nohostsfile -tcpOnly -quicktimeout', '-name -type -server')
queries('test-connection', '-quiet -ipv4 -ipv6 -repeat', '-targetname -computername -count -delay -timeoutseconds -buffersize')
queries('test-netconnection', '-traceroute', '-computername -port -commonTCPport -informationlevel -hops')
queries('get-command gcm', '-all -listimported -syntax', '-name -module -commandtype -verb -noun -totalcount')
queries('get-help', '-detailed -examples -full', '-name -parameter -category')
queries('select-string sls', '-simplematch -allmatches -casesensitive -list -notmatch -quiet -raw', '-pattern -path -literalpath -encoding -context -include -exclude')
queries('write-output', '-noenumerate', '-inputobject')
queries('write-host', '-nonewline', '-object -separator -foregroundcolor -backgroundcolor')
queries('format-list fl format-table ft format-wide fw', '-autosize -wrap -force -hidetableheaders -showerror -displayerror', '-property -view -groupby -column')
queries('out-string', '-stream', '-width -inputobject')
queries('convertfrom-json', '-ashashtable -noenumerate', '-depth -inputobject')
queries('convertto-json', '-compress -enumsasstrings -asarray', '-depth -inputobject')
queries('select-object select', '-unique -last -wait', '-property -excludeproperty -expandproperty -first -last -skip -skiplast -index')
queries('measure-object measure', '-allstats -average -sum -maximum -minimum -standarddeviation -line -word -character -ignorewhitespace', '-property')
queries('compare-object compare', '-includeequal -excludeDifferent -passthru -casesensitive', '-referenceobject -differenceobject -property -syncwindow -culture')

function basicReadOnlyQuery(program: string, args: string[]): boolean {
  // 别名在不同 Shell 下含义不同，只接受这些命令共同的无副作用形式。
  if (program === 'echo') return args.every(value => !value.startsWith('-') || ['-n', '-e', '-E'].includes(value))
  if (program === 'printf') return args.length > 0 && !args[0].startsWith('-') && !/%(?:\d+\$)?[-+#0 ']*\d*(?:\.\d+)?n/.test(args[0])
  if (program === 'uniq') return queryOptions(args, ['-c', '-d', '-u', '-i', '-z', '--count', '--repeated', '--unique', '--ignore-case', '--zero-terminated'], ['-f', '-s', '-w', '--skip-fields', '--skip-chars', '--check-chars'], true, 1)
  if (program === 'type') return args.every(value => !value.startsWith('-') || ['-a', '-t', '-p', '-P', '-f'].includes(value))
  if (program === 'dir') return args.every(value => process.platform !== 'win32' || !value.startsWith('/') || /^\/(?:[abspwdnoqrtx4]|[aot]:[\w-]+)$/i.test(value)) && queryOptions(args, ['-a', '-l', '-h'])
  if (program === 'where') return args.every(value => !value.startsWith('/') || /^\/(?:q|f|t|\?)$/i.test(value))
  if (program === 'findstr') return args.every(value => !value.startsWith('/') || /^\/(?:[belrsixvnmop]+|[cgfd]:.+)$/i.test(value))
  if (program === 'dig') return args.length > 0 && args.every(value => !value.startsWith('+') || /^\+(?:short|tcp|trace|noall|answer|stats|nostats|norecurse|recurse|dnssec|multiline)$/.test(value)) && queryOptions(args, ['-4', '-6'], ['-t', '-c', '-p'])
  const spec = querySpecs[program]
  if (!spec) return false
  if (['compare', 'measure', 'select', 'fl', 'ft', 'fw'].includes(program) && process.platform !== 'win32') return false
  const powershell = /^(?:get-|test-|resolve-|select-|write-|format-|out-|measure-|compare-|convertfrom-|convertto-)/.test(program)
    || ['gl', 'gci', 'gc', 'gi', 'gps', 'gsv', 'gal', 'gcm', 'sls', 'fl', 'ft', 'fw', 'select', 'measure', 'compare'].includes(program)
  const parameters = powershell ? args.map(value => value.startsWith('-') ? value.toLowerCase() : value) : args
  if (powershell && args.includes('--')) return false
  return queryOptions(parameters, powershell ? spec.flags.map(value => value.toLowerCase()) : spec.flags, powershell ? spec.values.map(value => value.toLowerCase()) : spec.values, spec.operands)
}

/** 同时具有写入或执行能力的查看工具采用独立规则。 */
function additionalReadOnlyQuery(program: string, args: string[]): boolean {
  if (program === 'ps') return queryOptions(args, ['-e', '-A', '-a', '-x', '-f', '-l', '-u', '-ww', '--forest', '--no-headers'], ['-p', '--pid', '-o', '--format', '--sort', '-Name', '-Id'])
  if (program === 'pipx') return args.length === 1 && ['list', 'environment', '--version', '--help'].includes(args[0])
  if (program === 'mdls') return queryOptions(args, ['-raw'], ['-name', '-nullMarker'])
  if (program === 'eza') return queryOptions(args, ['--all', '-a', '--long', '-l', '--tree', '-T', '--directory', '-d', '--git', '--git-ignore', '--header', '--icons', '--group-directories-first', '--oneline', '-1', '--classify', '-F', '--bytes', '-b', '--reverse', '-r'], ['--level', '-L', '--sort', '-s', '--color', '--time-style', '--ignore-glob', '-I'])
  if (['bat', 'batcat'].includes(program)) {
    if (args.includes('--')) return false
    const paging = args.flatMap((value, index) => value === '--paging' ? [args[index + 1]] : value.startsWith('--paging=') ? [value.slice(9)] : [])
    return paging.length > 0 && paging.every(value => value === 'never') && queryOptions(args, ['--plain', '-p', '--number', '-n', '--show-all', '-A'], ['--paging', '--style', '--language', '-l', '--color', '--theme', '--line-range', '-r'])
  }
  if (['fd', 'fdfind'].includes(program)) return queryOptions(args, ['--hidden', '-H', '--no-ignore', '-I', '--absolute-path', '-a', '--full-path', '-p', '--glob', '-g', '--fixed-strings', '-F', '--ignore-case', '-i', '--case-sensitive', '-s', '--list-details', '-l', '--print0', '-0'], ['--type', '-t', '--extension', '-e', '--exclude', '-E', '--max-depth', '-d', '--base-directory'])
  if (program === 'jq') return queryOptions(args, ['--null-input', '-n', '--raw-input', '-R', '--slurp', '-s', '--compact-output', '-c', '--raw-output', '-r', '--join-output', '-j', '--sort-keys', '-S', '--exit-status', '-e', '--monochrome-output', '-M', '--color-output', '-C', '--ascii-output', '-a', '--tab'], ['--indent'])
  if (program === 'ipconfig') return args.length === 0 || args.every(value => ['/all', '/displaydns', '/showclassid', '/showclassid6', '/?'].includes(value.toLowerCase()))
  if (program === 'route') return args[0]?.toLowerCase() === 'print' && args.slice(1).every(value => !value.startsWith('/') && !value.startsWith('-'))
  if (program === 'ip') {
    let rest = args
    while (['-4', '-6', '-j', '-json', '-s', '-d', '-br', '-brief', '-c', '-color'].includes(rest[0])) rest = rest.slice(1)
    return ['address', 'addr', 'a', 'link', 'route', 'r', 'neighbour', 'neighbor', 'neigh'].includes(rest[0]) && (rest.length === 1 || ['show', 'list'].includes(rest[1]) && rest.slice(2).every(value => !value.startsWith('-')))
  }
  if (program === 'sysctl') return args.length === 1 && ['-a', '-n', '--all'].includes(args[0]) || args.length > 0 && !args.some(value => value.includes('=') || value.startsWith('-') && !['-n', '-e'].includes(value))
  if (program === 'system_profiler') return queryOptions(args, ['-xml', '-json', '-listDataTypes'], ['-detailLevel', '-timeout'])
  if (program === 'tar') return args.length === 2 && /^-?t[vzjJ]*f$/.test(args[0]) && !args[1].startsWith('-') || args.includes('--list') && queryOptions(args, ['--list', '--verbose', '--gzip', '--bzip2', '--xz'], ['--file'], false)
  if (['unzip', 'zipinfo'].includes(program)) return program === 'zipinfo' ? queryOptions(args, ['-1', '-2', '-s', '-m', '-l', '-v', '-h', '-t', '-z']) : ['-l', '-v', '-t', '-Z', '-p'].includes(args[0]) && args.length >= 2 && args.slice(1).every(value => !value.startsWith('-'))
  if (['7z', '7za', '7zz'].includes(program)) return ['l', 't'].includes(args[0]) && args.length >= 2 && args.slice(1).every(value => !value.startsWith('-'))
  if (/^python(?:\d+(?:\.\d+)?)?$/.test(program) || program === 'py') {
    if (args.length === 1 && ['--version', '-V', '--help', '-h'].includes(args[0])) return true
    return args[0] === '-m' && ['pip', 'pip3'].includes(args[1]) && knownReadOnlyQuery('pip', args.slice(2))
      || args.length === 2 && args[0] === '-m' && args[1] === 'site'
  }
  if (program === 'zig') return args.length === 1 && args[0] === 'env'
  if (program === 'corepack') return args.length === 1 && ['--version', '-v', '--help', '-h'].includes(args[0])
  if (program === 'gem') return ['list', 'environment', 'env', 'outdated'].includes(args[0]) && queryOptions(args.slice(1), ['--local', '-l', '--remote', '-r', '--all', '-a', '--no-versions', '--versions', '--quiet', '-q'])
  if (['npm', 'pnpm'].includes(program)) {
    if (['view', 'info', 'show', 'v', 'search', 'outdated'].includes(args[0])) return queryOptions(args.slice(1), ['--json', '--parseable', '--long', '--all'])
    if (args[0] === 'audit') return queryOptions(args.slice(1), ['--json', '--production', '--prod', '--dev', '--offline'], ['--audit-level', '--omit', '--include'], false)
    if (program === 'pnpm' && args[0] === 'help') return args.length <= 2 && args.slice(1).every(value => /^[a-z][\w-]*$/i.test(value))
    if (args[0] === 'config' && ['get', 'list', 'ls'].includes(args[1])) return queryOptions(args.slice(2), ['--json', '--long', '-l', '--global', '-g'])
  }
  if (program === 'pnpm') return args.length === 2 && args[0] === 'store' && args[1] === 'path'
  if (program === 'docker') {
    if (args[0] === 'logs') return queryOptions(args.slice(1), ['--timestamps', '-t', '--details', '--follow', '-f'], ['--tail', '--since', '--until'])
    if (['container', 'image', 'volume', 'network'].includes(args[0]) && ['ls', 'list', 'inspect'].includes(args[1])) return queryOptions(args.slice(2), ['--all', '-a', '--quiet', '-q', '--no-trunc', '--digests'], ['--format', '--filter', '-f'])
    if (args[0] === 'compose' && ['ps', 'images', 'ls', 'version', 'config', 'logs'].includes(args[1])) return queryOptions(args.slice(2), ['--all', '-a', '--quiet', '-q', '--services', '--volumes', '--images', '--no-interpolate', '--timestamps', '-t', '--follow', '-f', '--json'], ['--format', '--tail', '--since', '--until'])
  }
  return false
}

export function knownReadOnlyQuery(program: string, args: string[]): boolean {
  const toolPolicy = developerToolPolicy(program, args)
  if (toolPolicy) return toolPolicy.kind === 'read'
  if (program === 'diff' && args.some(value => /^--output(?:=|$)/.test(value))) return false
  if (program === 'plutil') return args.length > 0 && ['-lint', '-p'].includes(args[0]) && args.slice(1).every(value => !value.startsWith('-'))
  if (additionalReadOnlyQuery(program, args)) return true
  if (basicReadOnlyQuery(program, args)) return true
  if (versionPrograms.has(program) && args.length === 1 && args[0] === '--version') return true
  if (versionPrograms.has(program) && args.length === 1 && ['--help', '-h'].includes(args[0])) return true
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

const gitLogFlags = ['--oneline', '--all', '--branches', '--tags', '--remotes', '--graph', '--decorate', '--no-decorate', '--stat', '--shortstat', '--numstat', '--name-only', '--name-status', '--patch', '-p', '--no-patch', '-s', '--raw', '--reverse', '--first-parent', '--no-merges', '--merges', '--date-order', '--topo-order', '--abbrev-commit', '--no-abbrev', '--no-color', '--no-ext-diff', '--no-textconv', '--relative', '--follow', '--no-notes', '-1', '-2', '-3', '-4', '-5', '-6', '-7', '-8', '-9', '-10', '-20', '-50', '-100']
const gitLogValues = ['-n', '--max-count', '--skip', '--since', '--until', '--after', '--before', '--author', '--committer', '--grep', '--format', '--pretty', '--date', '--decorate', '--abbrev', '--encoding', '--diff-filter', '--relative', '-L']
const gitDiffFlags = ['--stat', '--shortstat', '--numstat', '--name-only', '--name-status', '--patch', '-p', '--no-patch', '-s', '--raw', '--cached', '--staged', '--check', '--quiet', '--exit-code', '--no-index', '--no-color', '--no-ext-diff', '--no-textconv', '--relative', '--binary', '--full-index', '--compact-summary', '--summary', '--word-diff', '--ignore-all-space', '-w', '--ignore-space-change', '-b', '--ignore-blank-lines', '--minimal', '--patience', '--histogram', '--no-renames', '-z', '-M', '-C', '--no-commit-id', '--root', '-r']
const gitDiffValues = ['--diff-filter', '--relative', '--src-prefix', '--dst-prefix', '--line-prefix', '--unified', '-U', '--word-diff', '--word-diff-regex', '--inter-hunk-context']

/** 查询不满足只读规则时，不能回退到“开发工具”程序名放行。 */
export function readOnlyQueryInvocation(program: string, args: string[]): boolean {
  // 执行器即使转发查询也可能安装包，按开发操作处理，而非只读；子命令仍先接受风险检查。
  if (['npm', 'pnpm', 'yarn'].includes(program) && args[0] === 'exec' && args[1]
    && knownReadOnlyQuery(args[1], args.slice(2))) return false
  if (args.some(value => ['--version', '--help', '-h'].includes(value))) return true
  if (program === 'corepack' && ['npm', 'pnpm', 'yarn'].includes(args[0])) return readOnlyQueryInvocation(args[0], args.slice(1))
  if ((/^python(?:\d+(?:\.\d+)?)?$/.test(program) || program === 'py') && args[0] === '-m' && ['pip', 'pip3'].includes(args[1])) return readOnlyQueryInvocation('pip', args.slice(2))
  if (program === 'uv' && args[0] === 'pip') return readOnlyQueryInvocation('pip', args.slice(1))
  const families: Record<string, string[]> = {
    npm: ['ls', 'list', 'why', 'explain', 'view', 'info', 'show', 'v', 'search', 'outdated', 'audit', 'config', 'pkg', 'query', 'help'],
    pnpm: ['ls', 'list', 'why', 'view', 'info', 'show', 'v', 'search', 'outdated', 'audit', 'store', 'config', 'help'],
    yarn: ['info', 'list', 'why', 'config', 'help'],
    pip: ['show', 'list', 'check', 'inspect', 'config', 'cache', 'help'],
    pip3: ['show', 'list', 'check', 'inspect', 'config', 'cache', 'help'],
    go: ['env', 'version', 'help'],
    rustc: ['--print']
  }
  return Object.prototype.hasOwnProperty.call(families, program) && args.some(value => families[program].includes(value))
}

export function readOnlyGitQuery(subcommand: string, args: string[]): boolean {
  if (args.some(value => /%G|%\((?:signature|contents:signature)/.test(value))) return false
  if (subcommand === 'status') return queryOptions(args, ['--short', '-s', '--branch', '-b', '--porcelain', '--long', '--show-stash', '--ignored', '--untracked-files', '--no-renames', '--no-ahead-behind', '-z'], ['--porcelain', '--ignored', '--untracked-files', '--ignore-submodules'])
  if (['diff', 'diff-files', 'diff-index', 'diff-tree'].includes(subcommand)) return queryOptions(args, gitDiffFlags, gitDiffValues)
  if (['log', 'show', 'whatchanged', 'reflog'].includes(subcommand)) {
    if (subcommand === 'reflog' && args.some(value => ['expire', 'delete', 'drop', 'write', 'exists'].includes(value))) return false
    return queryOptions(args, [...gitLogFlags, ...gitDiffFlags], [...gitLogValues, ...gitDiffValues])
  }
  if (subcommand === 'blame') return queryOptions(args, ['-w', '-b', '-c', '-e', '-l', '-n', '-s', '-t', '-f', '-p', '--porcelain', '--line-porcelain', '--incremental', '--show-email', '--show-name', '--show-number', '--long', '--root', '--reverse', '--no-textconv'], ['-L', '--contents', '--ignore-rev', '--ignore-revs-file', '--date'])
  if (subcommand === 'rev-parse') return queryOptions(args, ['--verify', '--quiet', '-q', '--short', '--abbrev-ref', '--symbolic', '--symbolic-full-name', '--show-toplevel', '--show-prefix', '--show-cdup', '--git-dir', '--absolute-git-dir', '--git-common-dir', '--is-inside-work-tree', '--is-inside-git-dir', '--is-bare-repository', '--show-object-format', '--local-env-vars', '--all', '--branches', '--tags', '--remotes', '--not', '--revs-only', '--no-revs', '--flags', '--no-flags'], ['--short', '--abbrev-ref', '--git-path', '--resolve-git-dir', '--path-format'])
  if (subcommand === 'rev-list') return queryOptions(args, ['--all', '--objects', '--objects-edge', '--count', '--left-right', '--cherry-pick', '--cherry-mark', '--boundary', '--parents', '--children', '--reverse', '--first-parent', '--no-merges', '--merges', '--disk-usage', '--timestamp', '--topo-order', '--date-order'], ['--max-count', '-n', '--since', '--until', '--format', '--filter'])
  if (subcommand === 'cat-file') return queryOptions(args, ['-p', '-t', '-s', '-e', '--batch', '--batch-check', '--unordered'], ['--batch', '--batch-check'])
  if (subcommand === 'ls-files') return queryOptions(args, ['-z', '-t', '-v', '-f', '-c', '--cached', '-d', '--deleted', '-m', '--modified', '-o', '--others', '-i', '--ignored', '-s', '--stage', '-u', '--unmerged', '-k', '--killed', '--directory', '--no-empty-directory', '--exclude-standard', '--error-unmatch', '--debug', '--eol', '--deduplicate', '--full-name'], ['-x', '--exclude', '-X', '--exclude-from', '--exclude-per-directory', '--with-tree', '--format'])
  if (subcommand === 'ls-tree') return queryOptions(args, ['-d', '-r', '-t', '-l', '-z', '--name-only', '--name-status', '--object-only', '--full-name', '--full-tree'], ['--format', '--abbrev'])
  if (subcommand === 'grep') return queryOptions(args, ['-n', '-i', '-v', '-w', '-F', '-E', '-P', '-q', '-l', '-L', '-c', '-h', '-H', '-z', '-a', '-I', '--cached', '--no-index', '--untracked', '--no-exclude-standard', '--recurse-submodules', '--no-textconv', '--no-color', '--all-match', '--and', '--or', '--not', '--break', '--heading'], ['-e', '-f', '-A', '-B', '-C', '--max-depth', '--threads'])
  if (subcommand === 'shortlog') return queryOptions(args, ['-n', '-s', '-e', '--numbered', '--summary', '--email', '--all', '--no-merges'], ['--group', '--format', '--since', '--until'])
  if (subcommand === 'count-objects') return queryOptions(args, ['-v', '-H', '--verbose', '--human-readable'], [], false)
  if (subcommand === 'for-each-ref') return queryOptions(args, ['--shell', '--perl', '--python', '--tcl', '--ignore-case'], ['--format', '--sort', '--count', '--points-at', '--merged', '--no-merged', '--contains', '--no-contains'])
  if (subcommand === 'show-ref') return queryOptions(args, ['--head', '--heads', '--tags', '--verify', '--quiet', '-q', '--dereference', '-d', '--hash', '-s', '--exists', '--exclude-existing'], ['--hash', '--abbrev', '--exclude-existing'])
  if (subcommand === 'name-rev') return queryOptions(args, ['--name-only', '--tags', '--all', '--stdin', '--no-undefined', '--always'], ['--refs', '--exclude'])
  if (subcommand === 'merge-base') return queryOptions(args, ['-a', '--all', '--octopus', '--independent', '--is-ancestor', '--fork-point'])
  if (subcommand === 'version') return args.length === 0 || args.length === 1 && args[0] === '--build-options'
  if (subcommand === 'help') return args.length === 0 || args.length === 1 && ['--all', '-a', '--guides', '-g', '-h'].includes(args[0])
  if (subcommand === 'check-ignore') return queryOptions(args, ['-q', '--quiet', '-v', '--verbose', '-n', '--non-matching', '-z', '--stdin', '--no-index'])
  if (subcommand === 'check-attr') return queryOptions(args, ['-a', '--all', '--cached', '-z', '--stdin'], ['--source'])
  if (subcommand === 'branch') return queryOptions(args,
    ['--list', '-a', '--all', '-r', '--remotes', '-v', '-vv', '--verbose', '--show-current', '--no-color', '--no-abbrev'],
    ['--contains', '--no-contains', '--merged', '--no-merged', '--points-at', '--format', '--sort', '--abbrev'], args.includes('--list'))
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
