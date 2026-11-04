export interface LocalSkill {
  id: string
  name: string
  description: string
  enabled: boolean
}

export function validSkillDirectoryName(name: string): boolean {
  return name.length > 0 && name.length <= 200 && !/^[.]|[. ]$|[<>:"/\\|?*\x00-\x1f]/.test(name)
    && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
}

export function validSkillIds(value: unknown): value is string[] | undefined {
  return value === undefined || Array.isArray(value) && value.length <= 32 && value.every(id => typeof id === 'string' && validSkillDirectoryName(id)) && new Set(value).size === value.length
}
