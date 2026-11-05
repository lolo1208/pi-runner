import type { ModelProfile } from '../../shared/models'

/** 两条调用链使用相同合并顺序；null 可用于省略服务不支持的可选字段。 */
export function applyCompatibleParameters(body: Record<string, unknown>, profile: ModelProfile): void {
  if (profile.provider !== 'custom' || !profile.compatibleParameters) return
  for (const [key, value] of Object.entries(profile.compatibleParameters)) {
    if (value === null) delete body[key]
    else body[key] = value
  }
}
