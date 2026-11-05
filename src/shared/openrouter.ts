import type { ModelDescriptor } from './models'
import { automaticOutputTokens } from './output-tokens'

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
/** 优先使用模型声明的输出能力，未知时以 64K 兜底；实际请求还需为输入留出空间。 */
export function defaultOpenrouterMaxTokens(model?: Pick<ModelDescriptor, 'maxOutputTokens' | 'maxContextTokens'> | null): number {
  return automaticOutputTokens({ provider: 'openrouter' }, model)
}
export const OPENROUTER_MANUFACTURERS: Record<string, string> = {
  openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', deepseek: 'DeepSeek',
  qwen: '通义千问', 'z-ai': '智谱', moonshotai: '月之暗面', xai: 'xAI',
  mistralai: 'Mistral', meta: 'Meta', 'meta-llama': 'Meta', minimax: 'MiniMax',
  'bytedance-seed': '字节跳动', stepfun: '阶跃星辰', 'nvidia': 'NVIDIA',
  openrouter: 'OpenRouter', xiaomi: '小米', tencent: 'Tencent', cohere: 'Cohere', ai21: 'AI21',
  ibm: 'IBM', amazon: 'Amazon', microsoft: 'Microsoft',
  fireworks: 'Fireworks AI', inception: 'Inception', thinkingmachines: 'Thinking Machines',
  'dots-studio': 'Dots Studio', 'nex-agi': 'Nex-AGI', 'aion-labs': 'Aion Labs',
  perceptron: 'Perceptron', 'prism-ml': 'PrismML', rekaai: 'Reka', relace: 'Relace',
  poolside: 'Poolside', sakana: 'Sakana AI', upstage: 'Upstage', typesafe: 'TypeSafe AI', unbiased: 'Unbiased',
}
/** 只归一化展示用的厂商标识，调用时保留模型原始 ID。 */
function manufacturerKey(id: string): string {
  const vendor = id.split('/')[0].replace(/^~+/, '').toLowerCase()
  const aliases: Record<string, string> = {
    'x-ai': 'xai', 'meta-llama': 'meta', 'ibm-granite': 'ibm',
    'deepseek-ai': 'deepseek', minimaxai: 'minimax', 'stepfun-ai': 'stepfun',
    'meituan-longcat': 'meituan', 'tongyi-mai': 'qwen', 'zai-org': 'z-ai',
    'whisper-large-v3': 'openai', 'whisper-large-v3-turbo': 'openai',
  }
  return Object.hasOwn(aliases, vendor) ? aliases[vendor] : vendor
}
export function openrouterManufacturer(id: string): string {
  const vendor = manufacturerKey(id)
  return Object.hasOwn(OPENROUTER_MANUFACTURERS, vendor) ? OPENROUTER_MANUFACTURERS[vendor] : vendor
}
export type ManufacturerCountryCode = 'US' | 'CN' | 'FR' | 'CA' | 'IL' | 'AE' | 'JP' | 'KR' | 'PL' | 'DE' | 'SA'
// 以厂商总部或运营主体来源为依据；新增及易混淆厂商的核对资料见 docs/model-data-sources.md。
const manufacturerCountries: Record<string, ManufacturerCountryCode> = {
  openai: 'US', anthropic: 'US', google: 'US', xai: 'US', meta: 'US', nvidia: 'US',
  amazon: 'US', microsoft: 'US', perplexity: 'US', nousresearch: 'US', allenai: 'US', liquid: 'US',
  inflection: 'US', 'arcee-ai': 'US',
  openrouter: 'US', ibm: 'US', fireworks: 'US', inception: 'US', thinkingmachines: 'US',
  perceptron: 'US', 'prism-ml': 'US', rekaai: 'US', relace: 'US', poolside: 'US', typesafe: 'US', unbiased: 'US',
  deepseek: 'CN', qwen: 'CN', 'z-ai': 'CN', moonshotai: 'CN', minimax: 'CN',
  'bytedance-seed': 'CN', bytedance: 'CN', stepfun: 'CN', baidu: 'CN', tencent: 'CN',
  thudm: 'CN', alibaba: 'CN', '01-ai': 'CN', internlm: 'CN', inclusionai: 'CN', meituan: 'CN',
  xiaomi: 'CN', 'dots-studio': 'CN', 'nex-agi': 'CN', fishaudio: 'CN', funaudiollm: 'CN', indexteam: 'CN', 'wan-ai': 'CN', 'xingchen-agi': 'CN',
  'black-forest-labs': 'DE', 'allam-2-7b': 'SA',
  mistralai: 'FR', cohere: 'CA', ai21: 'IL', tiiuae: 'AE', 'falcon-h1': 'AE',
  sakana: 'JP', upstage: 'KR', 'aion-labs': 'PL',
}
const countryNames: Record<ManufacturerCountryCode, string> = { US: '美国', CN: '中国', FR: '法国', CA: '加拿大', IL: '以色列', AE: '阿联酋', JP: '日本', KR: '韩国', PL: '波兰', DE: '德国', SA: '沙特阿拉伯' }
/** 厂商所属国家，仅用于标识模型来源，不推断实际请求路由。 */
export function openrouterManufacturerCountry(id: string): { code: ManufacturerCountryCode; name: string } | null {
  const vendor = manufacturerKey(id)
  const code = Object.hasOwn(manufacturerCountries, vendor) ? manufacturerCountries[vendor] : undefined
  return code ? { code, name: countryNames[code] } : null
}
/** 展示所有支持本程序文字输出和工具调用的模型，不限制厂家、版本或数量。 */
export function callableOpenrouterModels(models: ModelDescriptor[]): ModelDescriptor[] {
  return models.filter(model => model.capabilities.includes('tools') && model.capabilities.includes('completion'))
}
