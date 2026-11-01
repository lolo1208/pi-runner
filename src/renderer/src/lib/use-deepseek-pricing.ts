import { useSyncExternalStore } from 'react'
import { currentDeepseekPricing, deepseekPricingPeriod, DEEPSEEK_PRICING_SOURCE } from '../../../shared/deepseek-pricing-period'
import type { ModelPricing } from '../../../shared/model-pricing'

const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (!timer) timer = setInterval(() => { for (const notify of listeners) notify() }, 1000)
  return () => {
    listeners.delete(listener)
    if (!listeners.size && timer) { clearInterval(timer); timer = undefined }
  }
}

/** 共享一个计时器，跨时段时同步刷新价格标签与模型详情。 */
export function useDeepseekPricing(pricing: ModelPricing | undefined) {
  const isDeepseek = pricing?.source === DEEPSEEK_PRICING_SOURCE
  const period = useSyncExternalStore(isDeepseek ? subscribe : () => () => {}, deepseekPricingPeriod, deepseekPricingPeriod)
  return { isDeepseek, period, pricing: isDeepseek ? currentDeepseekPricing(pricing, period) : pricing }
}
