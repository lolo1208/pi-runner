import type { ModelPricing } from './model-pricing'

export const DEEPSEEK_PRICING_SOURCE = 'https://api-docs.deepseek.com/quick_start/pricing'
export type DeepseekPricingPeriod = 'peak' | 'off-peak' | 'unknown'

// 国务院办公厅 2026 年节假日放假安排；只收录已核实的年份。
// https://www.gov.cn/zhengce/content/202511/content_7047090.htm
const holidays: Record<number, readonly (readonly [string, string])[]> = {
  2026: [['01-01', '01-03'], ['02-15', '02-23'], ['04-04', '04-06'], ['05-01', '05-05'], ['06-19', '06-21'], ['09-25', '09-27'], ['10-01', '10-07']],
}

/** 官方按 UTC 工作日划分高峰；周末即使是调休上班日也仍为非高峰。 */
export function deepseekPricingPeriod(now: Date = new Date()): DeepseekPricingPeriod {
  if (!Number.isFinite(now.getTime())) return 'unknown'
  const day = now.getUTCDay()
  const minute = now.getUTCHours() * 60 + now.getUTCMinutes()
  if (day === 0 || day === 6 || !((minute >= 60 && minute < 240) || (minute >= 360 && minute < 600))) return 'off-peak'
  const year = now.getUTCFullYear()
  const ranges = holidays[year]
  if (!ranges) return 'unknown'
  const date = now.toISOString().slice(5, 10)
  return ranges.some(([start, end]) => date >= start && date <= end) ? 'off-peak' : 'peak'
}

/** 单价表存储高峰价格，只在展示时按当前时间换算，不修改持久化目录。 */
export function currentDeepseekPricing(pricing: ModelPricing | undefined, period: DeepseekPricingPeriod): ModelPricing | undefined {
  if (!pricing || pricing.source !== DEEPSEEK_PRICING_SOURCE) return pricing
  // 无法确认节假日时仅会处于高峰候选时段，暂按高峰价展示并由界面标注待确认。
  if (period === 'unknown' || period === 'peak') return pricing
  return { ...pricing, input: pricing.input / 2, output: pricing.output / 2,
    ...(pricing.cacheRead != null ? { cacheRead: pricing.cacheRead / 2 } : {}),
    ...(pricing.cacheWrite != null ? { cacheWrite: pricing.cacheWrite / 2 } : {}) }
}
