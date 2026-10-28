/** 固定 JSON 数据查询模板，不执行代码，也不按 node -e 程序名放行任意脚本。 */
const identifier = '[A-Za-z_$][\\w$]*'

/** 模板中的绑定名允许变化，但每次引用必须对应同一绑定。 */
function queryTemplate(template: string): RegExp {
  const bindings = new Set<string>()
  const parts = template.split(/(\$[a-z]+)/g)
  return new RegExp('^' + parts.map(part => {
    if (!/^\$[a-z]+$/.test(part)) return part.replace(/\s+/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const name = part.slice(1)
    if (bindings.has(name)) return `\\k<${name}>`
    bindings.add(name)
    return `(?<${name}>${identifier})`
  }).join('') + ';?$')
}

const nodeQuery = queryTemplate("for(let$i=0;$i<$data.length;$i++){let$n=$data[$i];if($n.__type__!=='cc.Node')continue;let$cs=($n._components||[]).map($c=>$data[$c.__id__]);let$ui=$cs.find($c=>$c.__type__==='cc.UITransform');let$sp=$cs.find($c=>$c.__type__==='cc.Sprite');console.log(JSON.stringify({$i,name:$n._name,parent:$n._parent?.__id__,pos:$n._lpos,scale:$n._lscale,rot:$n._euler?.z,active:$n._active,size:$ui?._contentSize,sprite:$sp?._spriteFrame?.__uuid__}));}")
// 索引列表单独校验后替换为固定标记，避免允许任意数组表达式。
const componentQuery = queryTemplate("for(const$i of[0]){const$n=$data[$i];console.log($n._name,JSON.stringify($n._components.map($c=>$data[$c.__id__]).filter($c=>['cc.Sprite','cc.UIOpacity','cc.Button','cc.Widget'].includes($c.__type__))));}")

const namedPositionQuery = queryTemplate("const$ids=['QUERY_NAME'];for(const$n of$data)if($n.__type__==='cc.Node'&&$ids.includes($n._name))console.log($n._name,JSON.stringify($n._lpos),'parent',$data[$n._parent?.__id__]?._name);")
const namedPositionOnlyQuery = queryTemplate("const$ids=['QUERY_NAME'];for(const$n of$data)if($n.__type__==='cc.Node'&&$ids.includes($n._name))console.log($n._name,JSON.stringify($n._lpos));")
const namedComponentsQuery = queryTemplate("for(const$n of$data)if($n.__type__==='cc.Node'&&$n._name==='QUERY_NAME'){console.log($n._lpos);for(const$c of$n._components||[])console.log($data[$c.__id__]);}")

const filteredRowsQuery = queryTemplate("const$ids=['QUERY_NAME'];console.log(JSON.stringify($data.filter($r=>$ids.includes($r.id)),null,2));")
const selectedLayoutQuery = queryTemplate("for(let$i=0;$i<$data.length;$i++){const$n=$data[$i];if(['QUERY_NAME'].includes($n._name)){const$c=($n._components||[]).map($r=>$data[$r.__id__]);console.log(JSON.stringify({name:$n._name,pos:$n._lpos,scale:$n._lscale,size:$c.find($c=>$c.__type__==='cc.UITransform')?._contentSize}));}}")

// 目录扫描仅接受固定资源关联算法；路径另行验证，不能插入任意表达式。
const animationQuery = queryTemplate("const$fs=require('fs'),$p=require('path');const$root='QUERY_ROOT';const$map=new Map();for(const$dir of$fs.readdirSync($root,{withFileTypes:true}).filter($d=>$d.isDirectory()))for(const$f of$fs.readdirSync($p.join($root,$dir.name)).filter($g=>$g.endsWith('.png.meta'))){const$m=JSON.parse($fs.readFileSync($p.join($root,$dir.name,$f),'utf8'));$map.set($m.uuid,$dir.name+'/'+$f.replace('.meta',''));}for(const$f of$fs.readdirSync($root).filter($g=>$g.endsWith('.anim'))){const$a=JSON.parse($fs.readFileSync($p.join($root,$f),'utf8'));const$curve=$a.find($x=>$x.__type__==='cc.ObjectCurve');console.log(JSON.stringify({name:$a[0]._name,duration:$a[0]._duration,speed:$a[0].speed,times:$curve._times,frames:$curve._values.map($v=>$map.get($v.__uuid__.split('@')[0]))}));}")

export function nodeJsonQuery(args: string[]): boolean {
  if (args.length !== 2 || !['-e', '--eval'].includes(args[0])) return false
  const code = args[1]
  if (code.length > 16000) return false
  // 仅接受无转义的普通字符串；不处理注释、模板字符串或任何动态路径。
  const tokens = code.match(/'[^'\\\r\n]*'|"[^"\\\r\n]*"|\s+|[^\s'"`\\]+/g)
  if (!tokens || tokens.join('') !== code) return false
  const normalized = tokens.map(token => /^\s+$/.test(token) ? '' : /^["']/.test(token) ? `'${token.slice(1, -1)}'` : token).join('')
  const root = normalized.match(/const[A-Za-z_$][\w$]*='([^']+)';const[A-Za-z_$][\w$]*=newMap\(\);/)?.[1]
  if (root && /^[\w-]+(?:\/[\w-]+)*$/.test(root)) {
    const groups = animationQuery.exec(normalized.replace(`'${root}'`, "'QUERY_ROOT'"))?.groups
    if (groups) {
      // f、g 在两个独立循环作用域复用；其他绑定必须互异且不遮蔽内建对象。
      const names = Object.values(groups)
      if (new Set(names).size === names.length && names.every(name => !['console', 'JSON', 'require', 'Map'].includes(name))) return true
    }
  }
  const prefix = normalized.match(new RegExp(`^const(?<fs>${identifier})=require\\('(?:node:)?fs'\\);const(?<data>${identifier})=JSON\\.parse\\(\\k<fs>\\.readFileSync\\('(?<path>[^']+)','utf8'\\)\\);`))
    ?? normalized.match(new RegExp(`^const(?<data>${identifier})=JSON\\.parse\\(require\\('(?:node:)?fs'\\)\\.readFileSync\\('(?<path>[^']+)','utf8'\\)\\);`))
  if (!prefix?.groups) return false
  const { fs, data } = prefix.groups
  const path = prefix.groups.path.replace(/^\.\//, '')
  // 仅接受普通相对资源路径，凭证、父目录、设备及绝对路径不在模板范围内。
  if (!/^[\w-]+(?:\/[\w.-]+)*\.(?:json|prefab|fire|scene)$/.test(path)
    || path.split('/').some(part => part.startsWith('.')) || fs === data) return false
  const tail = normalized.slice(prefix[0].length)
  const indexed = tail.replace(/^(for\(const[A-Za-z_$][\w$]*of)\[(?:\d+,)*\d+\]/, '$1[0]')
  const named = tail
    .replace(/^(const[A-Za-z_$][\w$]*=)\['[\w-]+'(?:,'[\w-]+')*\]/, "$1['QUERY_NAME']")
    .replace(/(\._name===)'[\w-]+'/g, "$1'QUERY_NAME'")
  const selected = named.replace(/\['[\w-]+'(?:,'[\w-]+')*\]/g, "['QUERY_NAME']")
  for (const [pattern, body] of [[filteredRowsQuery, named], [selectedLayoutQuery, selected], [nodeQuery, tail], [componentQuery, indexed], [namedPositionQuery, named], [namedPositionOnlyQuery, named], [namedComponentsQuery, named]] as const) {
    const groups = pattern.exec(body)?.groups
    if (!groups || groups.data !== data) continue
    // 不允许局部变量遮蔽 console/JSON 或互相遮蔽；回调参数可在独立作用域复用。
    const names = [...(fs ? [fs] : []), data, ...Object.entries(groups).filter(([key]) => key !== 'data').map(([, value]) => value)]
    if (new Set(names).size === names.length && names.every(name => !['console', 'JSON', 'require'].includes(name))) return true
  }
  return false
}
