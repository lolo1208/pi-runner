import { describe, expect, it, vi, afterEach } from 'vitest'
import { nodeJsonQuery } from './node-json-query-policy'
import { commandRisk, readOnlyCommand } from './tool-permissions'

const queries = [
  "const fs=require('fs');const p=JSON.parse(fs.readFileSync('cocos-proj/assets/startmenu/prefabs/startMenu.prefab','utf8')); for(let i=0;i<p.length;i++){let n=p[i];if(n.__type__!=='cc.Node')continue;let cs=(n._components||[]).map(c=>p[c.__id__]);let ui=cs.find(c=>c.__type__==='cc.UITransform');let sp=cs.find(c=>c.__type__==='cc.Sprite');console.log(JSON.stringify({i,name:n._name,parent:n._parent?.__id__,pos:n._lpos,scale:n._lscale,rot:n._euler?.z,active:n._active,size:ui?._contentSize,sprite:sp?._spriteFrame?.__uuid__}));}",
  "const f=require('fs');const p=JSON.parse(f.readFileSync('cocos-proj/assets/startmenu/prefabs/startMenu.prefab','utf8'));for(const i of [2,8,14,20,26,33,34,139,145]){const n=p[i];console.log(n._name,JSON.stringify(n._components.map(c=>p[c.__id__]).filter(c=>['cc.Sprite','cc.UIOpacity','cc.Button','cc.Widget'].includes(c.__type__))));}",
]

const diaryRead = "const a=JSON.parse(require('fs').readFileSync('./cocos-proj/assets/common/prefabs/diary.prefab','utf8'));"
const diaryIds = "const ids=['buzhiming','xinghuan','yuanrun','keni','taguo','zhihui','heifan','qiyue','weimi','yulin','taoyuan','rongyao'];"
const diaryQueries = [
  "const fs=require('fs');const rows=JSON.parse(fs.readFileSync('src/content/dialogues/buzhiming-source.json','utf8'));const ids=['Open_Nongtian_Intro','Get_Map'];console.log(JSON.stringify(rows.filter(r=>ids.includes(r.id)),null,2));",
  "const fs=require('fs');const a=JSON.parse(fs.readFileSync('cocos-proj/assets/common/prefabs/diary.prefab','utf8'));for(let i=0;i<a.length;i++){const n=a[i];if(['richengExecutionView','bgMask','bg'].includes(n._name)){const c=(n._components||[]).map(r=>a[r.__id__]);console.log(JSON.stringify({name:n._name,pos:n._lpos,scale:n._lscale,size:c.find(c=>c.__type__==='cc.UITransform')?._contentSize}));}}", 
  diaryRead + diaryIds + "for(const n of a)if(n.__type__==='cc.Node'&&ids.includes(n._name))console.log(n._name,JSON.stringify(n._lpos), 'parent',a[n._parent?.__id__]?._name);",
  diaryRead + "for(const n of a)if(n.__type__==='cc.Node'&&n._name==='map'){console.log(n._lpos); for(const c of n._components||[])console.log(a[c.__id__]);}",
]

describe('Node 只读 JSON 查询', () => {
  afterEach(() => vi.restoreAllMocks())

  it.each(['win32', 'linux'])('在 %s 直接放行原始查询并跳过快照', platform => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue(platform as NodeJS.Platform)
    for (const code of queries) {
      expect(nodeJsonQuery(['-e', code])).toBe(true)
      const command = `node -e "${code}"`
      expect(commandRisk(command).risk).toBe('safe')
      expect(readOnlyCommand(command)).toBe(true)
    }
  })

  it.each(['win32', 'linux'])('在 %s 放行 diary 位置与组件查询', platform => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue(platform as NodeJS.Platform)
    for (const code of diaryQueries) {
      expect(nodeJsonQuery(['-e', code])).toBe(true)
      expect(commandRisk(`node -e "${code}"`).risk).toBe('safe')
      expect(readOnlyCommand(`node -e "${code}"`)).toBe(true)
    }
  })

  it('不将 require prefab 当作 JSON 读取，也不放行附加代码或动态路径', () => {
    const code = "const a=require('./cocos-proj/assets/common/prefabs/diary.prefab');" + diaryIds
      + "for(const n of a)if(n.__type__==='cc.Node'&&ids.includes(n._name))console.log(n._name,JSON.stringify(n._lpos));"
    expect(nodeJsonQuery(['-e', code])).toBe(false)
    expect(commandRisk(`node -e "${code}"`).risk).not.toBe('safe')
    for (const query of diaryQueries) {
      for (const changed of [
        query + ";require('child_process').execSync('danger')",
        query + ";require('fs').writeFileSync('x','y')",
        query.replace('./cocos-proj/assets/common/prefabs/diary.prefab', '../outside.json'),
        query.replace("'./cocos-proj/assets/common/prefabs/diary.prefab'", 'getPath()'),
        query.replace('console.log', 'eval'),
        query.replace(/\ba\b/g, 'JSON'),
      ]) {
        expect(nodeJsonQuery(['-e', changed])).toBe(false)
        expect(commandRisk(`node -e "${changed}"`).risk).not.toBe('safe')
      }
    }
  })

  it('允许绑定名变化和 --eval，但不接受额外启动参数', () => {
    const code = queries[0].replace(/\bfs\b/g, 'reader').replace("require('reader')", "require('fs')").replace(/\bp\b/g, 'data')
    expect(nodeJsonQuery(['--eval', code])).toBe(true)
    expect(nodeJsonQuery(['--require', 'hook.cjs', '-e', code])).toBe(false)
  })

  it.each([
    (code: string) => code + ";require('fs').writeFileSync('x','y')",
    (code: string) => code + ";require('child_process').execSync('danger')",
    (code: string) => code.replace('console.log', 'eval'),
    (code: string) => code.replace('readFileSync', 'writeFileSync'),
    (code: string) => code.replace('cocos-proj/assets/startmenu/prefabs/startMenu.prefab', '../outside.json'),
    (code: string) => code.replace('cocos-proj/assets/startmenu/prefabs/startMenu.prefab', '.ssh/id_rsa'),
    (code: string) => code.replace("require('fs')", "require('other')"),
    (code: string) => code.replace(/\bp\b/g, 'console'),
    (code: string) => code.replace('p[c.__id__]', 'p[c.constructor]'),
  ])('不放行变形或有副作用的代码', transform => {
    for (const code of queries) {
      const changed = transform(code)
      expect(nodeJsonQuery(['-e', changed])).toBe(false)
      expect(commandRisk(`node -e "${changed}"`).risk).not.toBe('safe')
    }
  })
})
