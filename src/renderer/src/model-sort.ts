import { PROVIDER_PRESETS, type ModelProfileView } from '../../shared/models'

const modelCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

/** 按供应商排列，同一供应商内按模型标识的自然顺序倒序排列。 */
export function compareModelProfiles(a: ModelProfileView, b: ModelProfileView): number {
  const aIndex = PROVIDER_PRESETS.findIndex(preset => preset.id === a.provider)
  const bIndex = PROVIDER_PRESETS.findIndex(preset => preset.id === b.provider)
  const providerOrder = (aIndex < 0 ? PROVIDER_PRESETS.length : aIndex) - (bIndex < 0 ? PROVIDER_PRESETS.length : bIndex)
  return providerOrder || modelCollator.compare(a.provider, b.provider) || modelCollator.compare(b.model, a.model) || modelCollator.compare(b.name, a.name) || modelCollator.compare(a.id, b.id)
}
