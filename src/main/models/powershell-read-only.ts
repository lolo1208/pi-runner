import { queryOptions } from './command-query-options'

type Token = { text: string; kind: 'word' | 'string' | 'variable' | 'symbol'; quoted?: string }
type Value = { literal?: string; literals?: string[]; urls?: string[]; image?: boolean; regexMatches?: boolean }

/** 有限的 PowerShell 只读语法，不执行、展开或加载源代码。
 * 未知语法默认送审；仅显式支持对象投影及限定的文件读取类型调用。
 */
export function powerShellReadOnly(source: string, query: (command: string) => boolean): boolean {
  if (!source.trim() || source.length > 16000) return false
  try { return new QueryParser(source, query).parse() } catch { return false }
}

function tokens(source: string): Token[] {
  const result: Token[] = []
  for (let i = 0; i < source.length;) {
    const c = source[i]
    if (/[ \t]/.test(c)) { i++; continue }
    if (/[\r\n]/.test(c)) { result.push({ text: ';', kind: 'symbol' }); i++; continue }
    if (c === "'" || c === '"') {
      let text = ''; const quote = c; i++
      let closed = false
      while (i < source.length) {
        if (source[i] === quote) {
          if (quote === "'" && source[i + 1] === "'") { text += "'"; i += 2; continue }
          i++; closed = true; break
        }
        if (source[i] === '`') {
          if (quote !== '"' || !/[nrt]/i.test(source[i + 1] ?? '')) throw Error('escape')
          text += ' '; i += 2; continue
        }
        text += source[i++]
      }
      if (!closed) throw Error('quote')
      result.push({ text, kind: 'string', quoted: quote }); continue
    }
    const profile = source.slice(i).match(/^\$env:USERPROFILE(?![\w:])/i)
    if (profile) { result.push({ text: '$env:userprofile', kind: 'variable' }); i += profile[0].length; continue }
    const variable = source.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*|\?)/)
    if (variable) { result.push({ text: variable[0].toLowerCase(), kind: 'variable' }); i += variable[0].length; continue }
    // 流合并只把 stderr 或全部流并入 stdout，不创建也不截断文件。
    const merge = source.slice(i).match(/^(?:[12*]>&1)(?![^\s;|)])/)
    if (merge) { i += merge[0].length; continue }
    // 纯连字符参数（如 echo ---）是字面量，不是选项名。
    const dashRun = source.slice(i).match(/^-{2,}(?![A-Za-z0-9_])/)
    if (dashRun) { result.push({ text: dashRun[0], kind: 'word' }); i += dashRun[0].length; continue }
    const pair = source.slice(i, i + 2)
    if (['..', '++', '--', '::'].includes(pair) && !(pair === '--' && /[A-Za-z]/.test(source[i + 2] ?? ''))) {
      result.push({ text: pair, kind: 'symbol' }); i += 2; continue
    }
    const number = source.slice(i).match(/^\d+/)
    if (number) { result.push({ text: number[0], kind: 'word' }); i += number[0].length; continue }
    // 依赖路径中的 @scope、pnpm 的 + 是字面量；不要吞掉 Length+1 等表达式的加号。
    const word = source.slice(i).match(/^[A-Za-z_][\w.-]*[\\/][\w./\\*?:@+-]*/)
      ?? source.slice(i).match(/^(?:--?[A-Za-z][\w-]*|[A-Za-z_][\w./\\*?:-]*)/)
    if (word) {
      // 成员名之后的减号是算术运算符，而不是名称的一部分。
      const text = word[0].endsWith('-') && /[\d[$(]/.test(source[i + word[0].length] ?? '') ? word[0].slice(0, -1) : word[0]
      result.push({ text, kind: 'word' }); i += text.length; continue
    }
    // 参数位置的相对路径（如 .tmp、./src、../x）是普通字面量，不是成员访问。
    const relative = c === '.' && i > 0 && /[ \t]/.test(source[i - 1]) ? source.slice(i).match(/^(?:\.{1,2}[\\/][\w./\\*?:-]*|\.[A-Za-z_][\w./\\-]*)/) : null
    if (relative) { result.push({ text: relative[0], kind: 'word' }); i += relative[0].length; continue }
    if (';|(){}[]@=,.+-'.includes(c)) { result.push({ text: c, kind: 'symbol' }); i++; continue }
    throw Error('unsupported token')
  }
  return result
}

// 无参字符串方法不读写文件；其他实例方法仍只接受显式支持的写法。
const noArgMethods = new Set(['trim', 'trimstart', 'trimend', 'tostring', 'tolower', 'toupper', 'tolowerinvariant', 'toupperinvariant'])

class QueryParser {
  private readonly input: Token[]
  private position = 0
  private depth = 0
  private interpolation = false
  private readonly variables = new Map<string, Value>()
  constructor(source: string, private readonly query: (command: string) => boolean) { this.input = tokens(source) }
  parse(): boolean { this.statements(); return this.position === this.input.length }
  private peek(text?: string): boolean { return text === undefined ? this.position < this.input.length : this.input[this.position]?.text.toLowerCase() === text }
  private take(): Token { const token = this.input[this.position++]; if (!token) throw Error('end'); return token }
  private eat(text: string): boolean { if (!this.peek(text)) return false; this.position++; return true }
  private need(text: string): void { if (!this.eat(text)) throw Error(`expected ${text}`) }
  private bounded<T>(fn: () => T): T {
    if (++this.depth > 32) throw Error('depth')
    try { return fn() } finally { this.depth-- }
  }
  private statements(): void {
    this.bounded(() => {
      while (this.peek() && !this.peek('}')) {
        if (this.eat(';')) continue
        // 循环与分支的流程控制关键字本身不执行命令。
        if (this.eat('continue') || this.eat('break')) continue
        if (this.eat('foreach')) {
          const before = new Map(this.variables)
          this.need('('); const name = this.local(); this.need('in'); const collection = this.pipeline(); this.need(')')
          this.variables.set(name, { ...(collection.urls?.length ? { urls: collection.urls } : {}), ...(collection.literals?.length ? { literals: collection.literals } : {}) })
          this.invalidateBlockInputs()
          this.block()
          this.invalidateChanged(before)
        } else if (this.eat('for')) {
          this.counterLoop()
        } else if (this.eat('if')) {
          this.conditional()
        } else if (this.eat('exit')) {
          // 仅允许传播原生命令的退出码，不接受表达式或其他命令。
          this.need('$lastexitcode')
          if (this.peek() && !this.peek('}') && !this.peek(';')) throw Error('exit boundary')
        } else if (this.eat('try')) {
          const before = new Map(this.variables)
          this.block(); while (this.eat(';')) { /* newlines before catch */ }
          // Catch may run before any of the try assignments complete.
          this.invalidateChanged(before)
          this.need('catch'); this.block()
          this.invalidateChanged(before)
        } else {
          if (this.input[this.position]?.kind === 'variable' && this.input[this.position + 1]?.text === '=') {
            const name = this.local(); this.need('='); this.variables.set(name, this.pipeline())
          } else this.pipeline()
          if (this.peek() && !this.peek('}') && !this.peek(';')) throw Error('statement boundary')
        }
      }
    })
  }
  /** 仅支持局部整数计数器，不支持属性写入、任意更新语句或执行型循环头。 */
  private counterLoop(): void {
    const before = new Map(this.variables)
    this.need('(')
    const counter = this.local(); this.need('=')
    const initial = this.take()
    if (initial.kind !== 'word' || !/^\d+$/.test(initial.text)) throw Error('counter initializer')
    this.variables.set(counter, {})
    this.need(';')
    if (this.local() !== counter) throw Error('counter condition')
    const comparison = this.take().text.toLowerCase()
    if (!['-lt', '-le', '-gt', '-ge'].includes(comparison)) throw Error('counter comparison')
    this.expression(); this.need(';')
    if (this.local() !== counter) throw Error('counter update')
    this.need(['-lt', '-le'].includes(comparison) ? '++' : '--')
    this.need(')')
    this.invalidateBlockInputs()
    this.block()
    this.invalidateChanged(before)
    // 计数器的终值未知，不保留循环前可能存在的 URL 等来源信息。
    this.variables.delete(counter)
  }
  /** 所有分支均检查；条件不作求值，分支赋值不能成为块外的可信来源。 */
  private conditional(): void {
    const before = new Map(this.variables)
    this.need('('); this.pipeline(); this.need(')')
    this.block(); this.invalidateChanged(before)
    while (this.eat(';')) { /* 允许 elseif/else 前换行 */ }
    while (this.eat('elseif')) {
      this.need('('); this.pipeline(); this.need(')')
      this.block(); this.invalidateChanged(before)
      while (this.eat(';')) { /* 允许下一个分支前换行 */ }
    }
    if (this.eat('else')) { this.block(); this.invalidateChanged(before) }
  }
  private invalidateChanged(before: Map<string, Value>): void {
    for (const [name, value] of this.variables) if (before.get(name) !== value) this.variables.delete(name)
  }
  private local(): string {
    if (this.interpolation) throw Error('assignment in interpolation')
    const token = this.take()
    if (token.kind !== 'variable' || !/^\$[a-z][a-z0-9_]*$/.test(token.text)
      || /^\$(?:env|global|script|local|private|using|ps.*|host|executioncontext|error|input|args|matches|ofs|home|pwd|lastexitcode|true|false|null)$/.test(token.text)) throw Error('nonlocal variable')
    return token.text
  }
  private block(): void { this.need('{'); this.statements(); this.need('}') }
  private invalidateBlockInputs(): void {
    // A loop or pipeline block may run zero or many times. An assignment later in
    // the block must not make a value from a previous iteration appear trustworthy.
    if (!this.peek('{')) throw Error('block')
    let level = 0
    for (let index = this.position; index < this.input.length; index++) {
      const token = this.input[index]
      if (token.kind === 'symbol' && token.text === '{') level++
      if (token.kind === 'symbol' && token.text === '}' && --level === 0) break
      if (token.kind === 'variable' && ['=', 'in'].includes(this.input[index + 1]?.text.toLowerCase())) this.variables.delete(token.text)
    }
  }
  private queryBlock(): void {
    const before = new Map(this.variables)
    this.invalidateBlockInputs(); this.block(); this.invalidateChanged(before)
  }
  /** allowArray 关闭时保留逗号给 @(...) 逐项处理，避免重复消费分隔符。 */
  private pipeline(allowArray = true): Value {
    return this.bounded(() => {
      let value = this.input[this.position]?.kind === 'word' && !/^\d+$/.test(this.input[this.position].text)
        ? this.command() : this.expression()
      // PowerShell 的逗号数组：'a','b' 等价于 @('a','b')；逐项检查且仅字面量项可作为可信来源。
      const items: Value[] = [value]
      while (allowArray && this.eat(',')) items.push(this.expression())
      if (items.length > 1) {
        value = items.every(item => item.literal !== undefined)
          ? { literals: items.map(item => item.literal!), ...(items.every(item => item.urls?.length) ? { urls: items.flatMap(item => item.urls!) } : {}) }
          : {}
      }
      while (this.eat('|')) {
        const start = this.position
        this.command(value)
        const stage = this.input.slice(start, this.position)
        // 仅 -First/-Last 数量筛选保留 Match 对象来源；其他投影不可信。
        if (!(value.regexMatches && stage.length === 3 && stage[0].text.toLowerCase() === 'select-object'
          && ['-first', '-last'].includes(stage[1].text.toLowerCase()) && /^\d+$/.test(stage[2].text))) value = {}
      }
      return value
    })
  }
  private expression(): Value {
    return this.bounded(() => {
      let value = this.atom()
      while (this.peek('.') || this.peek('[')) {
        if (this.eat('.')) {
          const member = this.take()
          if (member.kind !== 'word' || !/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(member.text)) throw Error('member')
          if (this.eat('(')) {
            const method = member.text.toLowerCase().split('.').at(-1) ?? ''
            if (method === 'dispose' && value.image) this.need(')')
            else if (noArgMethods.has(method) && this.peek(')')) this.need(')')
            else if (['substring', 'indexof'].includes(method)) { this.expression(); if (this.eat(',')) this.expression(); this.need(')') }
            // 其他方法可能读写文件或进程，不开放。
            else throw Error('method')
          }
          value = {}
        } else {
          this.need('['); this.expression(); this.need(']')
          // Keep literal URL provenance for a slice, never for a property access.
        }
      }
      while (['+', '-', '..', '-join', '-replace', '-eq', '-ne', '-in', '-like', '-notlike', '-match', '-notmatch', '-gt', '-lt', '-ge', '-le', '-and', '-or'].some(op => this.peek(op))) {
        const op = this.take().text.toLowerCase(); this.expression()
        if (op === '-replace' && this.eat(',')) this.expression()
        if (op !== '..') value = {}
      }
      return value
    })
  }
  private atom(): Value {
    if (this.eat('[')) return this.typedReadValue()
    if (this.eat('(')) { const value = this.pipeline(); this.need(')'); return value }
    if (this.eat('@')) {
      this.need('('); const values: Value[] = []
      if (!this.peek(')')) {
        values.push(this.pipeline(false))
        while (this.eat(',')) values.push(this.pipeline(false))
      }
      this.need(')')
      return {
        ...(values.length && values.every(value => value.urls?.length) ? { urls: values.flatMap(value => value.urls!) } : {}),
        ...(values.length && values.every(value => value.literal !== undefined) ? { literals: values.map(value => value.literal!) } : {}),
      }
    }
    const token = this.take()
    if (token.kind === 'string') {
      if (token.quoted === '"' && token.text.includes('$')) {
        // 仅允许将有限字面量路径片段嵌入固定的 HTTP(S) 地址路径。
        // 不允许影响主机、查询串、认证信息或路径回退，也不信任循环内重新赋值。
        const urlTemplate = /^(https?:\/\/[^\s\/$?#]+\/[^$?#]*)\$([a-z][a-z0-9_]*)([./][^$?#]*)?$/i.exec(token.text)
        if (urlTemplate) {
          const parts = this.variables.get('$' + urlTemplate[2].toLowerCase())?.literals
          if (parts?.length && parts.length <= 100 && parts.every(part => /^[a-z0-9._\/-]+$/i.test(part) && part.split('/').every(segment => segment && segment !== '.' && segment !== '..'))) {
            const urls = parts.map(part => urlTemplate[1] + part + (urlTemplate[3] ?? ''))
            if (urls.every(value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password } catch { return false } })) return { urls }
          }
        }
        // Interpolations are parsed recursively with the same local variable scope.
        let rest = token.text
        while (rest.includes('$')) {
          const start = rest.indexOf('$'); rest = rest.slice(start)
          if (rest.startsWith('$(')) {
            let level = 1, end = 2
            for (; end < rest.length && level; end++) { if (rest[end] === '(') level++; if (rest[end] === ')') level-- }
            if (level) throw Error('interpolation')
            const nested = new QueryParser(rest.slice(2, end - 1), this.query)
            nested.interpolation = true
            for (const [name, value] of this.variables) nested.variables.set(name, value)
            nested.pipeline(); if (nested.position !== nested.input.length) throw Error('interpolation')
            rest = rest.slice(end)
          } else {
            const variable = rest.match(/^\$[A-Za-z_][A-Za-z0-9_]*/)?.[0].toLowerCase()
            if (!variable || variable !== '$_' && !this.variables.has(variable) || rest[variable.length] === ':') throw Error('interpolation variable')
            rest = rest.slice(variable.length)
          }
        }
        return {}
      }
      let url: URL | undefined
      try { url = new URL(token.text) } catch { /* ordinary literal */ }
      return { literal: token.text, ...(url && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? { urls: [token.text] } : {}) }
    }
    if (token.kind === 'variable') {
      if (token.text === '$_' || token.text === '$lastexitcode' || token.text === '$?') return {}
      // 只读自动变量可用于成功条件判断，不提供任何数据来源或写入能力。
      if (token.text === '$lastexitcode' || token.text === '$?') return {}
      const value = this.variables.get(token.text)
      if (!value) throw Error('unbound variable')
      return value
    }
    if (token.kind === 'word' && /^\d+$/.test(token.text)) return { literal: token.text }
    throw Error('expression')
  }
  /** 不允许任意类型转换、构造器或静态方法；对象值同样逐项解析。 */
  private typedReadValue(): Value {
    const type = this.take()
    if (type.kind !== 'word') throw Error('type')
    this.need(']')
    const typeName = type.text.toLowerCase()
    if (typeName === 'stringcomparison') {
      this.need('::')
      if (!['ordinal', 'ordinalignorecase'].includes(this.take().text.toLowerCase())) throw Error('comparison')
      return {}
    }
    if (typeName === 'system.net.webutility') {
      this.need('::')
      if (this.take().text.toLowerCase() !== 'htmldecode') throw Error('static method')
      this.need('('); this.expression(); this.need(')')
      return {}
    }
    if (typeName === 'math' || typeName === 'regex') {
      this.need('::')
      const method = this.take().text.toLowerCase()
      if (!(typeName === 'math' ? ['min', 'max'] : ['match', 'matches', 'replace']).includes(method)) throw Error('static method')
      this.need('('); this.expression(); this.need(','); this.expression()
      if (typeName === 'regex' && method === 'replace') {
        // 替换值限于字面量字符串，不能绑定 MatchEvaluator 等可执行重载。
        this.need(',')
        const replacement = this.take()
        if (replacement.kind !== 'string' || replacement.quoted !== "'") throw Error('replacement')
      }
      if (typeName === 'regex' && method === 'matches' && this.eat(',')) {
        // 仅允许无副作用的字面量匹配选项，不接受动态表达式或超时重载。
        const option = this.take()
        if (option.kind !== 'string' || option.quoted !== "'" || !/^(?:none|ignorecase|multiline|singleline|cultureinvariant|ignorepatternwhitespace|explicitcapture)(?:\s*,\s*(?:none|ignorecase|multiline|singleline|cultureinvariant|ignorepatternwhitespace|explicitcapture))*$/i.test(option.text)) throw Error('regex options')
      }
      this.need(')')
      return typeName === 'regex' && method === 'matches' ? { regexMatches: true } : {}
    }
    if (typeName === 'pscustomobject') {
      this.need('@'); this.need('{')
      while (this.eat(';')) { /* 对象内换行 */ }
      while (!this.peek('}')) {
        const key = this.take()
        if (!['word', 'string'].includes(key.kind) || !/^[A-Za-z_]\w*$/.test(key.text)) throw Error('object key')
        this.need('='); this.pipeline()
        if (!this.peek('}')) this.need(';')
        while (this.eat(';')) { /* 对象属性分隔及换行 */ }
      }
      this.need('}')
      return {}
    }
    const image = type.text.toLowerCase() === 'system.drawing.image'
    if (!image && !['system.io.file', 'io.file'].includes(type.text.toLowerCase())) throw Error('type')
    this.need('::')
    const method = this.take()
    if (method.kind !== 'word' || !(image ? ['fromfile'] : ['readlines', 'readalllines', 'readalltext']).includes(method.text.toLowerCase())) throw Error('static method')
    this.need('(')
    const resolved = this.eat('(')
    if (resolved) {
      this.need('resolve-path')
      if (this.peek('-path') || this.peek('-literalpath')) this.take()
    }
    // 仅支持字面量文件路径，不允许任意表达式、插值或参数重载。
    if (this.input[this.position]?.kind !== 'string') throw Error('file path')
    const value = this.atom()
    if (value.literal === undefined) throw Error('dynamic file path')
    if (resolved) {
      if (!this.query(`Resolve-Path '${value.literal.replace(/'/g, "''")}'`)) throw Error('resolve path')
      this.need(')')
    }
    this.need(')')
    return image ? { image: true } : {}
  }
  private command(input: Value = {}): Value {
    const program = this.take().text.toLowerCase()
    if (!/^[a-z][\w-]*(?:\.exe)?$/.test(program)) throw Error('command')
    if (program === 'foreach-object') {
      if (this.peek('value')) {
        // 仅对已知 Regex Match 对象投影 Value，避免调用其他对象同名方法。
        if (!input.regexMatches) throw Error('unknown member target')
        this.take()
      } else {
        this.eat('-process')
        this.queryBlock()
      }
      return {}
    }
    const args: string[] = []; const values: Value[] = []; let dynamic = false
    while (this.peek() && ![';', '|', ')', '}'].some(end => this.peek(end))) {
      if (this.peek('{')) {
        if (!['where-object', 'select-object', 'sort-object', 'group-object'].includes(program)) throw Error('script block')
        this.queryBlock(); args.push('value'); continue
      }
      if (this.peek('@') && this.input[this.position + 1]?.text === '{') {
        if (program !== 'select-object') throw Error('calculated property')
        this.need('@'); this.need('{')
        while (!this.peek('}')) {
          const key = this.take().text.toLowerCase(); this.need('=')
          if (['name', 'label'].includes(key)) { if (this.input[this.position]?.kind !== 'string') throw Error('label'); this.atom() }
          else if (['expression', 'e'].includes(key)) this.queryBlock()
          else throw Error('calculated key')
          if (!this.peek('}')) this.need(';')
        }
        this.need('}'); args.push('value'); continue
      }
      const token = this.input[this.position]
      // 仅作为目录枚举的路径参数使用用户主目录，不允许其他环境变量或动态路径拼接。
      if (token.text === '$env:userprofile' && program === 'get-childitem'
        && args.at(-1)?.toLowerCase() === '-path' && [';', '|', ')', '}', undefined].includes(this.input[this.position + 1]?.text)
      ) { this.take(); args.push('userprofile'); values.push({}); continue }
      if (token.text === '$env:userprofile' && program === 'get-childitem'
        && args.at(-1)?.toLowerCase() === '-path' && this.input[this.position + 1]?.kind === 'word'
        && this.input[this.position + 1].text.startsWith('-')
      ) { this.take(); args.push('userprofile'); values.push({}); continue }
      if (token.kind === 'word') { args.push(this.take().text); values.push({ literal: token.text }); continue }
      // 参数位置的 . 与 .. 是当前/上级目录字面量，不是成员访问。
      if (token.kind === 'symbol' && (token.text === '.' || token.text === '..')) {
        this.take(); args.push(token.text); values.push({ literal: token.text }); continue
      }
      if (this.eat(',')) continue
      const value = this.expression(); dynamic ||= value.literal === undefined
      args.push(value.literal ?? 'value'); values.push(value)
    }
    if (program === 'echo') {
      // PowerShell 的 echo 是 Write-Output 别名，只有输出而无副作用。
      if (dynamic) throw Error('echo variable')
      return {}
    }
    if (program === 'add-type') {
      // 只允许加载系统绘图库，不允许编译源码或加载任意程序集。
      if (dynamic || args.length !== 2 || args[0].toLowerCase() !== '-assemblyname' || args[1].toLowerCase() !== 'system.drawing') throw Error('assembly')
    } else if (['curl', 'curl.exe'].includes(program)) {
      // 每个展开后的 URL 都交给原有网络查询规则验证，不放行未知原生参数。
      const expanded: string[][] = [[]]
      for (let index = 0; index < args.length; index++) {
        const choices = values[index]?.urls ?? (values[index]?.literal !== undefined || !dynamic ? [args[index]] : undefined)
        if (!choices?.length || expanded.length * choices.length > 100) throw Error('curl argument')
        const previous = expanded.splice(0)
        for (const prefix of previous) for (const choice of choices) expanded.push([...prefix, choice])
      }
      if (!expanded.every(arguments_ => this.query([program, ...arguments_.map(arg => "'" + arg.replace(/'/g, "''") + "'")].join(' ')))) throw Error('curl query')
    } else if (['invoke-webrequest', 'invoke-restmethod'].includes(program)) {
      // Anonymous GET only. URI variables must originate entirely from literal URLs.
      let uri = false
      for (let index = 0; index < args.length; index++) {
        if (args[index].toLowerCase() === '-usebasicparsing') continue
        if (args[index].toLowerCase() === '-timeoutsec') {
          const timeout = args[++index]
          if (!timeout || !/^\d+$/.test(timeout) || Number(timeout) > 300) throw Error('timeout')
          continue
        }
        if (args[index].toLowerCase() === '-uri') { index++; if (!values[index]?.urls?.length || uri) throw Error('uri'); uri = true; continue }
        if (args[index].startsWith('-') || !values[index]?.urls?.length || uri) throw Error('network options')
        uri = true
      }
      if (!uri) throw Error('missing uri')
    } else if (program === 'where-object') {
      if (!queryOptions(args, [], ['-eq', '-ne', '-in', '-like', '-notlike', '-match', '-notmatch', '-gt', '-lt', '-ge', '-le'])) throw Error('predicate')
    } else if (['sort-object', 'group-object', 'convertto-json', 'convertfrom-json'].includes(program)) {
      const specs: Record<string, [string[], string[]]> = {
        'sort-object': [['-descending', '-unique', '-stable'], ['-property']],
        'group-object': [['-noelement', '-casesensitive'], ['-property']],
        'convertto-json': [['-compress', '-enumsasstrings', '-asarray'], ['-depth']],
        'convertfrom-json': [['-ashashtable', '-noenumerate'], ['-depth']],
      }
      const [flags, options] = specs[program]
      if (!queryOptions(args.map(arg => arg.startsWith('-') ? arg.toLowerCase() : arg), flags, options)) throw Error('transform options')
    } else {
      // Native tools parse expanded strings as options; an unknown value could hide --pre,
      // --output or Git configuration. PowerShell cmdlets bind variable values as data.
      if (dynamic && !/^(?:get-|test-|resolve-|select-|write-|format-|out-|measure-|compare-)/.test(program)) throw Error('dynamic native argument')
      const invocation = [program, ...args.map(arg => "'" + arg.replace(/'/g, "''") + "'")].join(' ')
      if (!this.query(invocation)) throw Error('query')
    }
    return {}
  }
}
