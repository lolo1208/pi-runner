import { useId, useState } from 'react'
import { CompatibleModelConnection } from './CompatibleModelConnection'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Input, type InputProps } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { selectedModelThinking, thinkingLabel, type ModelDescriptor, type ModelProfile, type ModelProfileView, type ModelSettings } from '../../../shared/models'
import { automaticOutputTokens, systemOutputTokens } from '../../../shared/output-tokens'
import { chatgptReferencePricing, openrouterCacheWritePrice, parseModelPricing } from '../../../shared/model-pricing'
import { useDeepseekPricing } from '../lib/use-deepseek-pricing'
import { DEEPSEEK_DEFAULT_OUTPUT_TOKENS, DEEPSEEK_MAX_OUTPUT_TOKENS, deepseekThinking } from '../../../shared/deepseek'

interface ModelProfileFieldsProps {
  profile: ModelProfile
  savedProfile: ModelProfileView | undefined
  settings: ModelSettings
  modelInfo?: ModelDescriptor | null
  infoLoading?: boolean
  apiKey: string
  removeKey: boolean
  onFieldChange: <Key extends Exclude<keyof ModelProfile, 'name'>>(field: Key, value: ModelProfile[Key]) => void
  onApiKeyChange: (value: string) => void
  onRemoveKeyChange: (remove: boolean) => void
  children?: React.ReactNode
  compactSetup?: boolean
}
const capabilityLabels: Record<string, string> = { completion: '文本生成', vision: '图片输入', tools: '工具调用', thinking: '推理', embedding: '向量嵌入', audio: '音频输入', video: '视频输入', pdf: 'PDF 输入' }
const formatPrice = (value: number | undefined): string => value == null ? '未知' : `$${value.toLocaleString('en-US', { maximumFractionDigits: 7 })}`
function IntegerParameterInput({ value, onValueChange, ...props }: Omit<InputProps, 'value' | 'onChange'> & { value: number | null | undefined; onValueChange: (value: number) => void }): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const current = value == null ? '' : String(Math.floor(value))
  return <Input {...props} type="number" inputMode="numeric" step="1" value={draft ?? current}
    onFocus={() => setDraft(current)} onBlur={() => setDraft(null)}
    onKeyDown={event => { if (['.', ',', 'e', 'E', '-', '+'].includes(event.key)) event.preventDefault() }}
    onPaste={event => { if (!/^\d+$/.test(event.clipboardData.getData('text'))) event.preventDefault() }}
    onChange={event => { const next = event.target.value; if (!/^\d*$/.test(next)) return; setDraft(next); if (next !== '') onValueChange(Number(next)) }} />
}
/**
 * “恢复默认参数”必须回到新建该供应商模型时的取值，而不是套用其它供应商的硬编码值：
 * 供应商默认输出额度、目录声明的上下文/输出上限、官方默认推理档位、流式空闲超时。
 */
function defaultParameters(profile: ModelProfile, modelInfo?: ModelDescriptor | null): Partial<ModelProfile> {
  const local = profile.provider === 'ollama'
  const managed = profile.provider === 'openrouter' || profile.provider === 'chatgpt' || profile.provider === 'ollama'
  const official = profile.provider === 'google'
  const selected = modelInfo?.thinking?.default
  // 目录声明的输出上限优先；Google 默认取 32K，与新建模型一致。
  const maxTokens = profile.provider === 'deepseek' ? Math.min(DEEPSEEK_DEFAULT_OUTPUT_TOKENS, modelInfo?.maxOutputTokens ?? DEEPSEEK_DEFAULT_OUTPUT_TOKENS) : official ? Math.min(65536, modelInfo?.maxOutputTokens ?? 65536)
    : managed ? automaticOutputTokens({ ...profile, contextTokens: null }, modelInfo) : 2048
  return {
    contextTokens: null,
    // 与保存逻辑对称：Google、OpenRouter、ChatGPT 不发送温度；其余恢复为 1。
    temperature: official || profile.provider === 'openrouter' || profile.provider === 'chatgpt' || profile.provider === 'deepseek' ? null : 1,
    maxTokens,
    timeoutSeconds: official || local || profile.provider === 'openrouter' || profile.provider === 'deepseek' ? 120 : 60,
    thinking: typeof selected === 'boolean' ? selected : null,
    thinkingLevel: profile.provider === 'deepseek' ? 'high' : typeof selected === 'string' ? selected as ModelProfile['thinkingLevel'] : null,
    ollamaThinkingLevel: local && typeof selected === 'string' ? selected : null,
  }
}

export function ModelProfileFields({ profile, savedProfile, settings, modelInfo, infoLoading, apiKey, removeKey, onFieldChange, onApiKeyChange, onRemoveKeyChange, children, compactSetup = false }: ModelProfileFieldsProps): React.JSX.Element {
  const local = profile.provider === 'ollama'
  const subscription = profile.provider === 'chatgpt'
  const google = profile.provider === 'google'
  const router = profile.provider === 'openrouter'
  const basePricing = subscription ? chatgptReferencePricing(profile.model) ?? parseModelPricing(modelInfo?.pricing) : parseModelPricing(modelInfo?.pricing)
  const { pricing, period, isDeepseek } = useDeepseekPricing(basePricing)
  const fieldId = useId()
  const contextTokens = profile.contextTokens ?? modelInfo?.maxContextTokens
  const automatic = systemOutputTokens(profile.provider)
  const outputTokens = automaticOutputTokens(profile, modelInfo)
  const thinkingValues = modelInfo?.thinking?.values ?? []
  const thinkingOptions = thinkingValues.map(value => ({ value: `${typeof value === 'boolean' ? 'boolean' : 'level'}:${value}`, label: thinkingLabel(value) ?? String(value), raw: value }))
  const configuredThinking = selectedModelThinking(profile, modelInfo?.thinking)
  const selectedThinking = thinkingOptions.find(option => option.raw === configuredThinking)?.value
  const showThinking = !infoLoading && thinkingValues.some(value => value !== false && value !== 'off')
  const ConnectionSection = compactSetup ? 'section' : 'details'
  return <div className={`model-configuration-grid${compactSetup ? ' model-configuration-setup' : ''}`}>
    <div className="model-configuration-fields">
      {!compactSetup && <div className="model-parameter-fields">
      <Label htmlFor={`${fieldId}-max-tokens`}>{subscription ? '回复预留 Token' : '输出 Token 上限'}</Label>
      <div className={automatic ? 'model-parameter-row model-output-row' : 'model-parameter-row'}>
        {automatic ? <output id={`${fieldId}-max-tokens`} className="model-output-value h-9 min-w-0 rounded-md px-3 py-1 text-sm" aria-describedby={`${fieldId}-max-tokens-help`}>{infoLoading ? '读取中' : outputTokens.toLocaleString('en-US')}</output>
          : <IntegerParameterInput id={`${fieldId}-max-tokens`} min="1" max={Math.min(contextTokens ?? (profile.provider === 'deepseek' ? DEEPSEEK_MAX_OUTPUT_TOKENS : 131072), modelInfo?.maxOutputTokens ?? (profile.provider === 'deepseek' ? DEEPSEEK_MAX_OUTPUT_TOKENS : 131072), profile.provider === 'deepseek' ? DEEPSEEK_MAX_OUTPUT_TOKENS : 131072)} value={profile.maxTokens ?? 2048} placeholder="2048" aria-describedby={`${fieldId}-max-tokens-help`} onValueChange={value => onFieldChange('maxTokens', value)} />}
        <p id={`${fieldId}-max-tokens-help`} className="hint">{subscription ? '自动预留，实际输出由服务决定。' : automatic ? '自动设置，含思考与正文。' : google ? '包含思考与正文，启用推理时至少 1024 Token。' : profile.provider === 'deepseek' ? `包含思考与正文；模型最大输出 ${modelInfo?.maxOutputTokens?.toLocaleString('en-US') ?? '未知'} Token。` : '单次回复的最大 Token 数。'}</p>
      </div>
      <Label htmlFor={`${fieldId}-context`}>上下文上限（K）</Label>
      <div className="model-parameter-row">
        <div className="model-context-input"><IntegerParameterInput id={`${fieldId}-context`} min="1" max={Math.floor(Math.min(modelInfo?.maxContextTokens ?? 2097152, 2097152) / 1000)} value={contextTokens == null ? null : contextTokens / 1000} placeholder={infoLoading ? '读取中' : '输入整数'} onValueChange={value => onFieldChange('contextTokens', value * 1000)} /><span aria-hidden="true">K</span></div>
        <p className="hint">{local ? '每次请求生效，包含输入与输出。' : '按模型独立保存。'}</p>
      </div>
      {profile.provider === 'custom' && contextTokens != null && <p className="hint">实际上下文上限：{contextTokens.toLocaleString()} Token；手动修改上方数值时以整数 K 保存。</p>}
      {profile.contextTokens != null && modelInfo?.maxContextTokens != null && profile.contextTokens > modelInfo.maxContextTokens && <p className="error">设置超过模型支持的最大上下文。</p>}
      {!subscription && (profile.provider !== 'deepseek' || deepseekThinking(profile) === 'off') && (!router || modelInfo?.supportedParameters?.includes('temperature')) && <>
        <Label htmlFor={`${fieldId}-temperature`}>温度（Temperature）</Label>
        <div className="model-parameter-row">
          <Input id={`${fieldId}-temperature`} type="number" min="0" max={profile.protocol === 'anthropic' ? 1 : 2} step="0.1" value={profile.temperature ?? ''} placeholder="留空由服务决定" aria-describedby={`${fieldId}-temperature-help`} onChange={event => onFieldChange('temperature', event.target.value === '' ? null : Number(event.target.value))} />
          <p id={`${fieldId}-temperature-help`} className="hint">值越低，回复越稳定。</p>
        </div>
      </>}
      {(profile.provider === 'anthropic' || profile.provider === 'openai') && <>
        <Label htmlFor={`${fieldId}-cache`}>提示词缓存保留时间</Label>
        <div className="model-parameter-row">
          <Select value={profile.cacheRetention ?? 'short'} onValueChange={value => onFieldChange('cacheRetention', value as ModelProfile['cacheRetention'])}>
            <SelectTrigger id={`${fieldId}-cache`} aria-describedby={`${fieldId}-cache-help`}><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="short">默认</SelectItem><SelectItem value="long">延长</SelectItem></SelectContent>
          </Select>
          <p id={`${fieldId}-cache-help`} className="hint">仅官方接口生效；模型须支持延长缓存，可能增加缓存费用。</p>
        </div>
      </>}
      {router && <>
        <Label htmlFor={`${fieldId}-router-provider`}>首选上游</Label>
        <div className="model-parameter-row">
          <Input id={`${fieldId}-router-provider`} value={profile.openrouterProvider ?? ''} maxLength={100} placeholder="自动选择" aria-describedby={`${fieldId}-router-provider-help`} onChange={event => onFieldChange('openrouterProvider', event.target.value)} />
          <p id={`${fieldId}-router-provider-help`} className="hint">填写 OpenRouter 上游标识；不可用时允许回退，留空自动路由。</p>
        </div>
      </>}
      <Label htmlFor={`${fieldId}-timeout`}>超时（秒）</Label>
      <div className="model-parameter-row">
        <IntegerParameterInput id={`${fieldId}-timeout`} min="5" max="300" value={profile.timeoutSeconds ?? (local ? 120 : 60)} placeholder={local ? '120' : '60'} aria-describedby={`${fieldId}-timeout-help`} onValueChange={value => onFieldChange('timeoutSeconds', value)} />
        <p id={`${fieldId}-timeout-help`} className="hint">模型连续无响应的最长等待时间；持续输出不会超时。</p>
      </div>
      {(local || subscription || router || google || profile.provider === 'deepseek') && showThinking && <div className="model-thinking-field">
        <p id={`${fieldId}-thinking`}>{subscription ? '默认推理强度' : '推理模式'}</p>
        <RadioGroup className="model-thinking-options" aria-labelledby={`${fieldId}-thinking`} value={selectedThinking} onValueChange={value => {
          const raw = thinkingOptions.find(option => option.value === value)?.raw
          if (subscription || router || google || profile.provider === 'deepseek') { onFieldChange('thinkingLevel', typeof raw === 'string' ? raw as ModelProfile['thinkingLevel'] : null); onFieldChange('thinking', null) }
          else { onFieldChange('ollamaThinkingLevel', typeof raw === 'string' ? raw : null); onFieldChange('thinking', typeof raw === 'boolean' ? raw : null) }
        }}>
          {thinkingOptions.map(option => <RadioGroupItem key={option.value} variant="segmented" className="model-thinking-option" value={option.value}>{option.label}</RadioGroupItem>)}
        </RadioGroup>
      </div>}
      <Button type="button" variant="ghost" size="sm" className="model-reset" onClick={() => {
          const reset = defaultParameters(profile, modelInfo)
          onFieldChange('contextTokens', reset.contextTokens ?? null)
          onFieldChange('temperature', reset.temperature ?? null)
          onFieldChange('thinking', reset.thinking ?? null)
          onFieldChange('thinkingLevel', reset.thinkingLevel ?? null)
          onFieldChange('ollamaThinkingLevel', reset.ollamaThinkingLevel ?? null)
          if (!automatic && reset.maxTokens != null) onFieldChange('maxTokens', reset.maxTokens)
          if (reset.timeoutSeconds != null) onFieldChange('timeoutSeconds', reset.timeoutSeconds)
        }}>恢复默认参数</Button>
      </div>}
      {!local && !subscription && !router && !google && profile.provider !== 'deepseek' && !profile.compatibleConnectionId && <ConnectionSection className="provider-advanced" {...(!compactSetup ? { open: profile.provider === 'custom' } : {})}>{compactSetup ? <h4>连接与认证</h4> : <summary>连接与认证</summary>}
        <Label>Base URL<Input type="url" value={profile.baseUrl} onChange={event => onFieldChange('baseUrl', event.target.value)} /></Label>
        {profile.provider !== 'custom' && <Label>模型 ID<Input value={profile.model} maxLength={200} onChange={event => onFieldChange('model', event.target.value)} /></Label>}
        {!settings.encryptionAvailable && <p className="error" role="status">系统安全存储不可用，暂时不能保存或读取 API Key。</p>}
        <Label>API Key {savedProfile?.hasApiKey ? '· 已配置' : '· 未配置'}<Input type="password" value={apiKey} autoComplete="off" spellCheck={false} disabled={!settings.encryptionAvailable || removeKey} placeholder={savedProfile?.hasApiKey ? '留空保留现有密钥' : '输入服务密钥'} onChange={event => onApiKeyChange(event.target.value)} /></Label>
        {savedProfile?.hasApiKey && <Label className="checkbox-label"><Checkbox checked={removeKey} onCheckedChange={checked => onRemoveKeyChange(checked === true)} />保存时删除已存 API Key</Label>}
        {profile.provider === 'custom' && <CompatibleModelConnection key={profile.id} profile={profile} apiKey={apiKey} saved={Boolean(savedProfile) && !removeKey} onChange={onFieldChange} compact={compactSetup} />}
        {!compactSetup && profile.protocol === 'openai-compatible' && <Label>Token 参数<Select value={profile.tokenParameter} onValueChange={value => onFieldChange('tokenParameter', value as ModelProfile['tokenParameter'])}><SelectTrigger aria-label="Token 参数"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="max_completion_tokens">max_completion_tokens</SelectItem><SelectItem value="max_tokens">max_tokens</SelectItem></SelectContent></Select></Label>}
      </ConnectionSection>}
      {profile.compatibleConnectionId && <>
        <Label>Token 参数<Select value={profile.tokenParameter} onValueChange={value => onFieldChange('tokenParameter', value as ModelProfile['tokenParameter'])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="max_completion_tokens">max_completion_tokens</SelectItem><SelectItem value="max_tokens">max_tokens</SelectItem></SelectContent></Select></Label>
        <CompatibleModelConnection key={profile.id} profile={profile} apiKey="" parametersOnly onChange={onFieldChange} />
      </>}
      {children}
    </div>
    {!compactSetup && <aside className="model-specifications" aria-label="模型信息">
      <h4>能力</h4>
      {infoLoading && <p className="hint" role="status">正在读取模型信息…</p>}
      <dl><div><dt>输入类型</dt><dd>{modelInfo ? modelInfo.capabilities.includes('audio') ? '文字 · 图片 · 音频 · 视频 · PDF' : modelInfo.capabilities.includes('vision') ? '文字 · 图片' : modelInfo.capabilities.includes('completion') || modelInfo.capabilities.includes('embedding') ? '文字' : '未提供' : '未提供'}</dd></div>
        <div><dt>输出类型</dt><dd>{modelInfo ? modelInfo.capabilities.includes('completion') ? '文字' : modelInfo.capabilities.includes('embedding') ? '向量' : '未提供' : '未提供'}</dd></div>
        <div><dt>支持能力</dt><dd>{modelInfo?.capabilities.length ? modelInfo.capabilities.map(value => capabilityLabels[value] ?? value).join('、') : '服务未提供'}</dd></div>
      </dl>
      <h4>规格</h4><dl>
        <div><dt>最大上下文</dt><dd>{modelInfo?.maxContextTokens?.toLocaleString() ?? '未提供'}{modelInfo?.maxContextTokens ? ' tokens' : ''}</dd></div>
        {local && <>
          <div><dt>参数规模</dt><dd>{modelInfo?.parameterSize ?? '未提供'}</dd></div>
          <div><dt>量化</dt><dd>{modelInfo?.quantization ?? '未提供'}</dd></div>
          {modelInfo?.sizeBytes != null && <div><dt>模型大小</dt><dd>{(modelInfo.sizeBytes / 1024 ** 3).toFixed(2)} GiB</dd></div>}
        </>}
      </dl>
      {(subscription || router || google || profile.provider === 'deepseek') && <>
        <h4 className="model-pricing-heading">价格<span>美元 / 百万 Token</span></h4>
        {isDeepseek && <p className="hint" role="status">{period === 'peak' ? '当前高峰价格' : period === 'off-peak' ? '当前非高峰价格' : '待确认：当前为高峰候选时段，暂显示高峰价；节假日为非高峰价，请以官方结算为准。'}</p>}
        <dl aria-label="模型价格">
          <div><dt>输入</dt><dd>{formatPrice(pricing?.input)}</dd></div>
          <div><dt>输出</dt><dd>{formatPrice(pricing?.output)}</dd></div>
          <div><dt>缓存读取</dt><dd>{formatPrice(pricing?.cacheRead)}</dd></div>
          <div><dt>缓存写入</dt><dd>{formatPrice(router ? openrouterCacheWritePrice(profile.model, pricing) : pricing?.cacheWrite)}</dd></div>
        </dl>
      </>}
      <h4>模型信息</h4><dl><div><dt>模型 ID</dt><dd>{profile.model}</dd></div><div><dt>供应商</dt><dd>{local ? 'Ollama' : profile.provider}</dd></div><div><dt>服务地址</dt><dd>{profile.baseUrl}</dd></div></dl>
    </aside>}
  </div>
}
