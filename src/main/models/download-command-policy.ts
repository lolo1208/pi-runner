import { inspectedShellCommands } from './shell-command-words'

const curlValueOptions = new Set(['A', 'b', 'd', 'e', 'E', 'F', 'H', 'm', 'P', 'r', 't', 'T', 'u', 'U', 'w', 'x', 'X', 'Y', 'y', 'z'])
const curlLongValueOptions = new Set(['--url', '--user-agent', '--cookie', '--data', '--data-raw', '--data-binary', '--data-urlencode', '--referer', '--cert', '--form', '--header', '--max-time', '--range', '--upload-file', '--user', '--proxy-user', '--write-out', '--proxy', '--request', '--retry', '--connect-timeout', '--resolve', '--connect-to', '--interface', '--cacert', '--capath'])

function curlWrites(args: string[]): boolean {
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (argument === '--') break
    if (argument.startsWith('--')) {
      const equal = argument.indexOf('=')
      const option = equal < 0 ? argument : argument.slice(0, equal)
      const value = equal < 0 ? args[index + 1] : argument.slice(equal + 1)
      if (['--remote-name', '--remote-name-all', '--output-dir', '--create-dirs', '--create-file-mode'].includes(option)) return true
      if (['--output', '--dump-header', '--cookie-jar', '--trace', '--trace-ascii', '--libcurl'].includes(option)) {
        // curl 对 - 和 trace 的 % 使用标准输出；这些目标不创建文件。
        if (value !== '-' && !(option.startsWith('--trace') && value === '%')) return true
        if (equal < 0) index++
      } else if (curlLongValueOptions.has(option) && equal < 0) index++
      continue
    }
    if (!/^-[^-]/.test(argument)) continue
    // 短参数可以合写：-sSLo file、-oimage.jpg、-LO。
    for (let offset = 1; offset < argument.length; offset++) {
      const option = argument[offset]
      if (option === 'O') return true
      if (['o', 'D', 'c'].includes(option)) {
        const value = argument.slice(offset + 1) || args[++index]
        if (value !== '-') return true
        break
      }
      if (curlValueOptions.has(option) || option === 'K') {
        if (offset + 1 === argument.length) index++
        break
      }
    }
  }
  return false
}

/** 常见直接下载落盘命令；未知脚本仍由原有审核流程处理。 */
export function shellDownloadWrites(command: string): boolean {
  return inspectedShellCommands(command).some(words => {
    const args = [...words]
    while (['command', 'exec', 'sudo'].includes(args[0])) args.shift()
    const executable = args.shift()?.split(/[\\/]/).at(-1) ?? ''
    const program = executable.replace(/\.exe$/i, '').toLowerCase()
    const lower = args.map(value => value.toLowerCase())
    const outfile = lower.some(value => /^-(?:o|ou|out|outf|outfi|outfil|outfile)(?=[:=]|$)/.test(value))
    if (['invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm'].includes(program)) return outfile
    if (program === 'start-bitstransfer') return true
    if (program === 'bitsadmin') return lower.some(value => ['/transfer', '/addfile', '/addfileset', '/resume', '/complete'].includes(value))
    if (program === 'certutil') return lower.includes('-urlcache')
    if (program === 'curl') return curlWrites(args)
    if (program === 'aria2c') return !(args.length === 1 && ['--version', '-v', '--help', '-h'].includes(args[0]))
    if (['wget', 'wget2'].includes(program)) {
      // wget 默认保存到文件。仅帮助、版本及单纯 spider 探测不视为下载落盘。
      if (args.length === 1 && ['--version', '-V', '--help', '-h'].includes(args[0])) return false
      if (args.includes('--spider') && !args.some(value => /^--(?:output-file|append-output|output-document|save-cookies|hsts-file|warc-file)(?:=|$)/.test(value) || /^-[oaO]/.test(value))) return false
      return true
    }
    return false
  })
}

/** curl 配置文件可能隐藏输出选项，不能按常见开发命令自动放行。 */
export function downloadNeedsReview(program: string, args: string[]): boolean {
  return program === 'curl' && args.some(value => value === '--config' || value.startsWith('--config=') || /^-[^-]*K/.test(value))
}
