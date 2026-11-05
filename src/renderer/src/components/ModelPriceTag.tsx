import { Tooltip } from 'radix-ui'
import { BadgeDollarSign } from 'lucide-react'
import type { ModelDescriptor } from '../../../shared/models'
import { googleDynamicAlias, modelPriceTier, openrouterCacheWritePrice, parseModelPricing, type ModelPricing } from '../../../shared/model-pricing'
import { useDeepseekPricing } from '../lib/use-deepseek-pricing'
import type { DeepseekPricingPeriod } from '../../../shared/deepseek-pricing-period'
import { siliconflowUsdExchange } from '../../../shared/siliconflow-global-data'

const tierLabels = ['零调用费', '很便宜', '便宜', '适中', '较贵', '昂贵']
const formatPrice = (value: number | undefined): string => value == null ? '未知' : `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 7 })}`

function PriceDetails({ descriptor, pricing, period, isDeepseek }: { descriptor?: ModelDescriptor; pricing?: ModelPricing; period: DeepseekPricingPeriod; isDeepseek: boolean }): React.JSX.Element {
  const tier = modelPriceTier(pricing)
  if (!pricing) {
    const dynamic = googleDynamicAlias(descriptor?.id)
    const googleUnlisted = Boolean(descriptor?.id?.startsWith('gemini-'))
    return <>
      <strong className="model-price-tooltip-heading">{dynamic ? '动态别名' : '价格未知'}</strong>
      <p className="model-price-tooltip-note">{dynamic
        ? 'Google 会热切换该别名指向的底层型号，且官方未公布别名单价。'
        : googleUnlisted ? 'Google 定价页尚未公布该型号的单价，暂不评级。' : '暂无可准确匹配的单价，暂不评级。'}</p>
    </>
  }
  const local = pricing.kind === 'local'
  const reference = pricing.kind === 'api-reference'
  const official = pricing.kind === 'official'
  const estimate = pricing.kind === 'estimate'
  const cacheWrite = pricing.kind === 'catalog' ? openrouterCacheWritePrice(descriptor!.id, pricing) : pricing.cacheWrite
  const deepseek = isDeepseek
  const siliconflow = pricing.kind === 'siliconflow'
  const currencySymbol = pricing.currency === 'CNY' ? '¥' : '$'
  const format = (value: number | undefined): string => formatPrice(value).replace('$', currencySymbol)
  const source = siliconflow ? `SiliconFlow ${pricing.convertedFromCny || pricing.currency === 'CNY' ? '国内站 · 美元折算' : '国际站'}` : local ? 'Ollama 本地' : reference ? '模型官方参考' : official ? deepseek ? 'DeepSeek 官方' : 'Google 官方' : estimate ? '参考估算' : pricing.kind === 'cloud' ? 'Ollama 官方' : 'OpenRouter 目录'
  return <>
    <div className="model-price-tooltip-heading"><strong>{siliconflow ? 'SiliconFlow 官方价格' : local ? '本地运行' : reference ? 'API 参考价' : official ? '官方单价' : estimate ? '参考估算' : '模型单价'}</strong><span>{tier === null ? '不参与美元评级' : tierLabels[tier]}</span></div>
    {local ? <p className="model-price-tooltip-note">零平台调用费，不含硬件和电费。</p> : <>
      <div className="model-price-tooltip-unit">{pricing.currency === 'CNY' ? '人民币' : '美元'} / 百万 Token</div>
      <dl className="model-price-tooltip-rates">
        <div><dt>输入</dt><dd>{format(pricing.input)}</dd></div>
        <div><dt>输出</dt><dd>{format(pricing.output)}</dd></div>
        <div><dt>缓存读取</dt><dd className={pricing.cacheRead == null ? 'model-price-unknown' : undefined}>{format(pricing.cacheRead)}</dd></div>
        <div><dt>缓存写入</dt><dd className={cacheWrite == null ? 'model-price-unknown' : undefined}>{format(cacheWrite)}</dd></div>
      </dl>
      {tier !== null && <div className="model-price-tooltip-rating"><span>价格等级 <b>{tier} / 5</b></span><span>参考成本 {format(pricing.input * 0.75 + pricing.output * 0.25)}</span></div>}
      {siliconflow && <p className="model-price-tooltip-note">按当前连接区域的官网公开基础报价；促销、条件分档、时段和额外费用以服务商结算为准。</p>}
      {pricing.convertedFromCny && <p className="model-price-tooltip-note">国内人民币报价折算参考：1 USD = {siliconflowUsdExchange.cnyPerUsd} CNY（{siliconflowUsdExchange.checkedAt}）；来源 {siliconflowUsdExchange.source}，非支付结算汇率。</p>}
      {reference && <p className="model-price-tooltip-note">模型官方 API 参考价，不代表当前兼容接口或订阅的实际收费；请以当前服务商结算为准。</p>}
      {pricing.kind === 'cloud' && <p className="model-price-tooltip-note">采用常规时段单价。</p>}
      {official && <p className="model-price-tooltip-note">{deepseek ? `${period === 'peak' ? '当前高峰时段' : period === 'off-peak' ? '当前非高峰时段' : '待确认：当前为高峰候选时段，暂按高峰价显示；缺少当年中国节假日安排，若为节假日则为非高峰价'}；按 UTC 周一至周五 01:00–04:00、06:00–10:00 判断，排除中国节假日。实际费用以官方结算为准。` : '标准档、≤200k 输入、文本/图像/视频单价；音频与缓存存储另计。'}</p>}
      {estimate && <p className="model-price-tooltip-note">Google 未公布该型号或别名的单价，此处按同代已公布型号推算，仅供粗略比较；实际账单以 Google 结算页为准。</p>}
    </>}
    <div className="model-price-tooltip-footer"><span>{source}</span><time dateTime={pricing.checkedAt}>{pricing.checkedAt.slice(0, 10)}</time></div>
  </>
}

export function ModelPriceTag({ descriptor }: { descriptor?: ModelDescriptor }): React.JSX.Element {
  const { pricing, period, isDeepseek } = useDeepseekPricing(parseModelPricing(descriptor?.pricing))
  const tier = modelPriceTier(pricing)
  return <Tooltip.Provider delayDuration={250}><Tooltip.Root>
    <Tooltip.Trigger asChild><span className="model-price-tag" role="img" title="" aria-label={pricing?.currency === 'CNY' ? 'SiliconFlow 人民币价格' : tier === null ? '价格未知' : `价格等级 ${tier}${tier ? '，共 5 档' : '，零平台调用费'}${isDeepseek && period === 'unknown' ? '，节假日待确认，暂按高峰价显示' : ''}`}><BadgeDollarSign size={13} aria-hidden="true" /><span>{pricing?.currency === 'CNY' ? '¥' : tier === null ? '?' : tier}</span>{isDeepseek && period === 'unknown' && <span>待确认</span>}</span></Tooltip.Trigger>
    <Tooltip.Portal><Tooltip.Content className="model-price-tooltip" side="top" sideOffset={8} collisionPadding={12}>
      <PriceDetails descriptor={descriptor} pricing={pricing} period={period} isDeepseek={isDeepseek} />
    </Tooltip.Content></Tooltip.Portal>
  </Tooltip.Root></Tooltip.Provider>
}
