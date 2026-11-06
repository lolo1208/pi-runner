import { Cable, Cpu } from 'lucide-react'
import type { ProviderId } from '../../../../shared/models'
import openai from '../../assets/model-icons/openai.svg'
import claude from '../../assets/model-icons/claude.svg'
import deepseek from '../../assets/model-icons/deepseek.svg'
import qwen from '../../assets/model-icons/qwen.svg'
import meta from '../../assets/model-icons/meta.svg'
import gemini from '../../assets/model-icons/gemini.svg'
import mistral from '../../assets/model-icons/mistral.svg'
import grok from '../../assets/model-icons/grok.svg'
import zhipu from '../../assets/model-icons/zhipu.svg'
import minimax from '../../assets/model-icons/minimax.svg'
import moonshot from '../../assets/model-icons/moonshot.svg'
import ollama from '../../assets/model-icons/ollama.svg'
import stepfun from '../../assets/model-icons/stepfun.svg'
import xiaomimimo from '../../assets/model-icons/xiaomimimo.svg'
import ai21 from '../../assets/model-icons/ai21.svg'
import aionlabs from '../../assets/model-icons/aionlabs.svg'
import aws from '../../assets/model-icons/aws.svg'
import bytedance from '../../assets/model-icons/bytedance.svg'
import cohere from '../../assets/model-icons/cohere.svg'
import dotsstudio from '../../assets/model-icons/dotsstudio.svg'
import fireworks from '../../assets/model-icons/fireworks.svg'
import ibm from '../../assets/model-icons/ibm.svg'
import inception from '../../assets/model-icons/inception.svg'
import microsoft from '../../assets/model-icons/microsoft.svg'
import nvidia from '../../assets/model-icons/nvidia.svg'
import openrouter from '../../assets/model-icons/openrouter.svg'
import perceptron from '../../assets/model-icons/perceptron.svg'
import poolside from '../../assets/model-icons/poolside.svg'
import reka from '../../assets/model-icons/reka.svg'
import relace from '../../assets/model-icons/relace.svg'
import sakana from '../../assets/model-icons/sakana.svg'
import upstage from '../../assets/model-icons/upstage.svg'
import tencent from '../../assets/model-icons/tencent.svg'
import groq from '@lobehub/icons-static-svg/icons/groq.svg'
import siliconcloud from '@lobehub/icons-static-svg/icons/siliconcloud.svg'
import bfl from '@lobehub/icons-static-svg/icons/bfl.svg'
import fishaudio from '@lobehub/icons-static-svg/icons/fishaudio.svg'
import longcat from '@lobehub/icons-static-svg/icons/longcat.svg'
import bilibiliIndex from '@lobehub/icons-static-svg/icons/bilibiliindex.svg'
import alibaba from '@lobehub/icons-static-svg/icons/alibaba.svg'
import antgroup from '@lobehub/icons-static-svg/icons/antgroup.svg'

type ModelIconEntry = { label: string; icon?: string; monogram?: string }
type ModelBrand = ModelIconEntry & { pattern: RegExp }
const brands: ModelBrand[] = [
  { pattern: /black-forest-labs|(?:^|\/)flux(?:[-./]|$)/i, label: 'Black Forest Labs', icon: bfl },
  { pattern: /fishaudio/i, label: 'Fish Audio', icon: fishaudio },
  { pattern: /meituan-longcat|longcat/i, label: '美团 LongCat', icon: longcat },
  { pattern: /indexteam|index-tts/i, label: 'Index Team', icon: bilibiliIndex },
  { pattern: /funaudiollm/i, label: 'FunAudioLLM', icon: alibaba },
  { pattern: /inclusionai/i, label: 'InclusionAI', icon: antgroup },
  { pattern: /siliconflow|siliconcloud/i, label: '硅基流动', icon: siliconcloud },
  { pattern: /groq/i, label: 'Groq', icon: groq },
  { pattern: /bytedance|seed[-_/]/i, label: '字节跳动', icon: bytedance },
  { pattern: /nvidia|nemotron/i, label: 'NVIDIA', icon: nvidia },
  { pattern: /cohere|command-r/i, label: 'Cohere', icon: cohere },
  { pattern: /ai21|jamba/i, label: 'AI21', icon: ai21 },
  { pattern: /ibm|granite/i, label: 'IBM', icon: ibm },
  { pattern: /amazon|aws\/|nova-[a-z]/i, label: 'Amazon', icon: aws },
  { pattern: /microsoft|phi-/i, label: 'Microsoft', icon: microsoft },
  { pattern: /fireworks/i, label: 'Fireworks AI', icon: fireworks },
  { pattern: /inception|mercury/i, label: 'Inception', icon: inception },
  { pattern: /dots[-_/ ]?studio/i, label: 'Dots Studio', icon: dotsstudio },
  { pattern: /aion[-_/ ]?labs/i, label: 'Aion Labs', icon: aionlabs },
  { pattern: /perceptron/i, label: 'Perceptron', icon: perceptron },
  { pattern: /poolside/i, label: 'Poolside', icon: poolside },
  { pattern: /reka/i, label: 'Reka', icon: reka },
  { pattern: /relace/i, label: 'Relace', icon: relace },
  { pattern: /sakana/i, label: 'Sakana AI', icon: sakana },
  { pattern: /upstage|solar-/i, label: 'Upstage', icon: upstage },
  { pattern: /tencent/i, label: 'Tencent', icon: tencent },
  { pattern: /openrouter/i, label: 'OpenRouter', icon: openrouter },
  { pattern: /thinking[-_/ ]?machines/i, label: 'Thinking Machines', monogram: 'TM' },
  { pattern: /nex[-_/ ]?agi/i, label: 'Nex-AGI', monogram: 'NX' },
  { pattern: /prism[-_/ ]?ml/i, label: 'PrismML', monogram: 'PM' },
  { pattern: /typesafe/i, label: 'TypeSafe AI', monogram: 'TS' },
  { pattern: /unbiased/i, label: 'Unbiased', monogram: 'UB' },
  { pattern: /step\s*fun|stepfun/i, label: '阶跃星辰', icon: stepfun },
  { pattern: /xiaomi|mimo/i, label: '小米 MiMo', icon: xiaomimimo },
  { pattern: /claude|anthropic/i, label: 'Claude', icon: claude },
  { pattern: /deepseek/i, label: 'DeepSeek', icon: deepseek },
  { pattern: /qwen|qwq|tongyi-mai|wan-ai/i, label: 'Qwen', icon: qwen },
  { pattern: /llama|meta-llama/i, label: 'Meta', icon: meta },
  { pattern: /gemini|gemma/i, label: 'Google Gemini', icon: gemini },
  { pattern: /mistral|mixtral|codestral|ministral|devstral|magistral/i, label: 'Mistral', icon: mistral },
  { pattern: /grok/i, label: 'Grok', icon: grok },
  { pattern: /glm|zhipu|zai-org/i, label: '智谱', icon: zhipu },
  { pattern: /minimax/i, label: 'MiniMax', icon: minimax },
  { pattern: /kimi|moonshot/i, label: 'Kimi', icon: moonshot },
  { pattern: /gpt|chatgpt|codex|(?:^|\/)whisper-large-v3(?:[-./]|$)|(?:^|[/])o[134](?:[-:/]|$)/i, label: 'OpenAI', icon: openai },
]
const providers: Partial<Record<ProviderId, ModelIconEntry>> = {
  'claude-subscription': { label: 'Claude 订阅', icon: claude },
  google: { label: 'Google AI Studio', icon: gemini },
  openai: { label: 'OpenAI', icon: openai }, chatgpt: { label: 'OpenAI', icon: openai },
  anthropic: { label: 'Claude', icon: claude }, deepseek: { label: 'DeepSeek', icon: deepseek },
  ollama: { label: 'Ollama', icon: ollama }, openrouter: { label: 'OpenRouter', icon: openrouter },
}

export function ModelIcon({ model, provider, size = 15 }: { model?: string; provider?: ProviderId; size?: number }): React.JSX.Element {
  if (provider === 'custom' && !model) return <Cable size={size} aria-label="兼容接口图标" />
  const brand = brands.find(brand => brand.pattern.test(model ?? '')) ?? (provider ? providers[provider] : undefined)
  if (brand?.monogram) return <span className="chat-model-monogram" role="img" aria-label={`${brand.label} 图标`} style={{ width: size, height: size }}>{brand.monogram}</span>
  if (!brand) {
    if (provider !== 'openrouter' || !model) return <Cpu size={size} aria-label="通用模型图标" />
    const vendor = model.split('/')[0].replace(/^~+/, '')
    const monogram = vendor.split(/[-_.\s]+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || vendor.slice(0, 2).toUpperCase()
    return <span className="chat-model-monogram" role="img" aria-label={`${vendor} 图标`} style={{ width: size, height: size }}>{monogram}</span>
  }
  if (!brand.icon) return <Cpu size={size} aria-label="通用模型图标" />
  return <span className="chat-model-icon" role="img" aria-label={`${brand.label} 图标`} style={{ width: size, height: size, maskImage: `url("${brand.icon}")`, WebkitMaskImage: `url("${brand.icon}")` }} />
}
