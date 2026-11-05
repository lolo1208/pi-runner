/** 国际官网公开文本价快照，美元／百万 Token；2026-11-05 实际采集。
 * 来源：https://www.siliconflow.com/pricing
 * 数组依次为输入、输出、可选缓存读取。仅精确匹配目录中唯一的型号名。
 * 官网展示的 1049K/262K 等为取整值，不当作精确上下文上限。
 */
export const siliconflowGlobalPrices: Record<string, readonly [number, number, number?]> = {
  'DeepSeek-V4.1-Flash': [0.15, 0.6, 0.003],
  'DeepSeek-V4-Flash-0731': [0.22, 0.66, 0.014],
  'DeepSeek-V4-Flash-Vision-Exp': [0.44, 1.32, 0.028],
  'DeepSeek-V4-Pro': [1.50162, 3.135, 0.135],
  'DeepSeek-V4-Pro-0813': [1.32, 3.96, 0.044],
  'gemma-4-12B-it': [0.1, 0.3],
  'gemma-4-26B-A4B-it': [0.14, 0.4, 0.05],
  'gemma-4-31B-it': [0.75, 1, 0.25],
  // 用户提供的国际官网渲染截图核对；静态 HTML 请求未包含这两行。
  'GLM-5V-Turbo': [1.2, 4, 0.24],
  'GLM-4.5-Air': [0.14, 0.86],
  'GLM-5': [0.95, 2.55, 0.2],
  'GLM-5.1': [1.19, 3.74, 0.6],
  'GLM-5.2': [1.302, 4.092, 0.26],
  'GLM-5.3': [1.4, 4.4, 0.26],
  'GLM-5.3-Flash': [0.15, 0.5, 0.03],
  'gpt-oss-120b': [0.05, 0.45, 0.075],
  'gpt-oss-20b': [0.04, 0.18],
  'Hunyuan-A13B-Instruct': [0.14, 0.57],
  'Hy3': [0.132, 0.528, 0.033],
  'Kimi-K2.5': [0.45, 2.25, 0.07],
  'Kimi-K2.6': [0.77, 3.4, 0.14],
  'Kimi-K2.7-Code': [0.85916, 3.8, 0.17993],
  'Kimi-K3': [2.7, 13.5, 0.27],
  'MiniMax-M3': [0.3, 1.2, 0.06],
  'Qwen3.5-122B-A10B': [0.26, 2.08],
  'Qwen3.5-9B': [0.1, 0.15],
  'Qwen3.6-27B': [0.3, 3.2],
  'Qwen3.6-35B-A3B': [0.24, 1.8, 0.15],
  'Qwen3.8-2.4T-A95B': [2, 6, 0.25],
  // 国际 /models/llm 页面补采；未声明的缓存价不推算。
  'GLM-4.7': [0.42, 2.2],
  'DeepSeek-V3.2': [0.27, 0.42],
  'DeepSeek-V3.2-Exp': [0.27, 0.41],
  'DeepSeek-V3.1-Terminus': [0.27, 1],
  'DeepSeek-V3.1': [0.27, 1],
  'DeepSeek-V3': [0.25, 1],
  'DeepSeek-R1': [0.5, 2.18],
  'Ling-flash-2.0': [0.14, 0.57],
  'Qwen3-Coder-480B-A35B': [0.25, 1],
  'Qwen3-Coder-30B-A3B-Instruct': [0.07, 0.28],
  'Qwen3-30B-A3B-Instruct-2507': [0.09, 0.3],
  'Seed-OSS-36B-Instruct': [0.21, 0.57],
  'Qwen3-32B': [0.14, 0.57],
  'Qwen3-14B': [0.07, 0.28],
  'Qwen3-8B': [0.06, 0.06],
  'LongCat-2.0': [0.75, 2.95],
  'DeepSeek-V4-Flash': [0.13, 0.28],
  'Qwen2.5-72B-Instruct': [0.59, 0.59],
  'Qwen2.5-7B-Instruct': [0.05, 0.05],
  'Qwen3.5-35B-A3B': [0.24, 1.8],
  'Qwen3.5-27B': [0.25, 2],
  'Step-3.5-Flash': [0.1, 0.3],
  // 国际 /models/vision 补采。
  'Qwen3-VL-32B-Thinking': [0.2, 1.5],
  'Qwen3-VL-32B-Instruct': [0.2, 0.6],
  'Qwen3-VL-8B-Instruct': [0.18, 0.68],
  'Qwen3-VL-30B-A3B-Thinking': [0.29, 1],
  'Qwen3-VL-30B-A3B-Instruct': [0.29, 1],
}

/** 汇率仅用于参考展示，不代表支付结算汇率；1 USD = 6.685421 CNY。
 * 来源：https://open.er-api.com/v6/latest/USD；服务端更新 2026-11-05 00:02:31 UTC。
 */
export const siliconflowUsdExchange = { cnyPerUsd: 6.685421, checkedAt: '2026-11-05', source: 'https://open.er-api.com/v6/latest/USD' } as const

/** 国际官方 API 文档声明的默认值，不是模型请求示例。
 * https://docs.siliconflow.com/en/api-reference/chat-completions/chat-completions
 * temperature=0.7、max_tokens=4096、top_k=50 仅为示例，不能当作默认值。
 * thinking_budget 只适用于推理模型；enable_thinking 的默认 true 仅适用于文档列出的型号。
 */
export const siliconflowGlobalApiDefaults = { top_p: 0.7, thinking_budget: 4096 } as const
