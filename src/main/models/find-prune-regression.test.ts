import { afterEach, describe, expect, it, vi } from 'vitest'
import { commandRisk, readOnlyCommand } from './tool-permissions'

const query = 'cd C:/work/shei; git status --short | head -20; find . -path ./node_modules -prune -o -path ./target -prune -o -path ./.git -prune -o -type f -print | head -200'

describe('find 排除目录只读分类', () => {
  afterEach(() => vi.restoreAllMocks())
  it.each(['win32', 'linux'] as const)('只读复合命令直接放行：%s', platform => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
    expect(readOnlyCommand(query)).toBe(true)
    expect(commandRisk(query, 'C:/work/shei').risk).toBe('safe')
  })
  it.each(['find . -prune -o -delete', 'find . -prune -o -exec touch x', 'find . -prune -o -execdir touch x', 'head -20 --output=x', 'find . -- -delete'])('危险参数仍不放行：%s', command => {
    expect(readOnlyCommand(command)).toBe(false)
  })
})
