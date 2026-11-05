# 模型数据与维护来源

记录价格、默认参数和厂商国家的维护依据，不重复完整代码表。运行时以代码和服务商返回值为准。

## 更新数据源

| 数据 | 更新来源 | 维护位置 |
| --- | --- | --- |
| DeepSeek 价格、规格 | [官方定价与规格](https://api-docs.deepseek.com/quick_start/pricing)（2026-11-01） | `src/shared/model-pricing.ts`、`src/shared/deepseek.ts` |
| Google 价格 | [Gemini API 定价](https://ai.google.dev/gemini-api/docs/pricing)（2026-11-01） | `src/shared/model-pricing.ts` |
| Google 型号、规格与思考默认值 | [模型文档](https://ai.google.dev/gemini-api/docs/models)、[思考配置](https://ai.google.dev/gemini-api/docs/thinking)（型号快照 2026-10-28；思考配置 2026-11-01） | `src/shared/google.ts`、`src/main/models/google-client.ts` |
| ChatGPT 的 API 参考价 | [OpenAI 定价](https://developers.openai.com/api/docs/pricing)及对应模型页面（2026-10-15／2026-10-30） | `src/shared/model-pricing.ts` |
| Ollama 云端价格 | [Ollama 定价](https://ollama.com/pricing)（2026-10-14） | `src/shared/model-pricing.ts` |
| OpenRouter 目录、规格与价格 | [模型接口](https://openrouter.ai/api/v1/models)、[缓存文档](https://openrouter.ai/docs/guides/best-practices/prompt-caching)及 `https://openrouter.ai/api/v1/models/{模型ID}/endpoints`（缓存补全规则 2026-10-30） | `src/main/models/openrouter-client.ts`、`src/shared/model-pricing.ts` |
| SiliconFlow 国内价格、规格 | [国内定价页](https://www.siliconflow.cn/pricing)（2026-11-05） | `src/main/models/siliconflow-pricing.ts`、`src/shared/siliconflow-cn-data.ts` |
| SiliconFlow 国际价格、规格 | [国际定价页](https://www.siliconflow.com/pricing)、[文本模型](https://www.siliconflow.com/models/llm)、[视觉模型](https://www.siliconflow.com/models/vision)、[Embedding](https://www.siliconflow.com/models/embedding)、[Reranker](https://www.siliconflow.com/models/reranker)（2026-11-05） | `src/main/models/siliconflow-pricing.ts`、`src/shared/siliconflow-global-data.ts` |
| SiliconFlow 国际 API 默认参数 | [Chat Completions 文档](https://docs.siliconflow.com/en/api-reference/chat-completions/chat-completions)（2026-11-05） | `src/shared/siliconflow-global-data.ts` |
| SiliconFlow 人民币折算汇率 | [ExchangeRate-API](https://open.er-api.com/v6/latest/USD)（2026-11-05） | `src/shared/siliconflow-global-data.ts` |
| 厂商名称、国家与别名 | 下方组织来源与依据；原有记录 2026-10-14，补充映射未重新联网核验 | `src/shared/openrouter.ts`、`src/renderer/src/components/chat/ModelIcon.tsx` |

刷新模型目录不会自动更新内置价格、默认参数、汇率及厂商映射。维护时记录来源、核对日期及必要的生效时间；估算注明参考型号，未知不得当作免费或已确认。

## 重要规则与默认值

- **价格**：美元／百万 Token；缺失表示未知。等级按 `输入 × 0.75 + 输出 × 0.25` 计算，零成本为 0 档，非零成本以 0.5、2、5、15 为分界划分 1–5 档，不代表实际账单。
- **兼容接口参考价**：仅对准确匹配的 OpenAI、Google、DeepSeek 型号显示已有官方 API 参考价，不代表当前服务商实际收费。
- **SiliconFlow 区域与币种**：按官方 Base URL 区分国内 `api.siliconflow.cn/v1` 和国际 `api.siliconflow.com/v1`，不混用区域价格。统一美元展示；国内人民币价按 `1 USD = 6.685421 CNY`（2026-11-05）折算并注明日期，非支付结算汇率。
- **SiliconFlow 价格范围**：在线报价优先，静态快照兜底；型号精确匹配，Pro 不套用普通价。仅接入可明确表达的 Token 报价，单向计费、图像／音视频及复杂分档尚未完整支持。国内 GLM-5.3-Flash 零价数据与可见报价冲突，暂不采纳；缺失不回退到其他厂商参考价。
- **SiliconFlow 默认参数**：国际文档明确 `top_p=0.7`、推理模型 `thinking_budget=4096`（范围 128–32768）；`enable_thinking=true` 仅限文档列举型号。请求示例和取整上下文展示不当作默认值或精确限制；资料快照不覆盖用户配置。
- **DeepSeek**：已知型号默认输出 65,536、最大输出 393,216、上下文 1,000,000 Token，推理默认 `high`。内置价格为高峰价，非高峰半价；高峰候选为 UTC 工作日 01:00–04:00、06:00–10:00，排除中国节假日。节假日资料不足时提示待确认，暂用高峰价。时段与节假日维护见 `src/shared/deepseek-pricing-period.ts`。
- **Google**：价格按标准档、≤200k 输入的文本／图像／视频口径，音频和缓存存储另计；部分未知型号及 latest 别名按明确参考型号估算。代码在 2027-01-01 00:00 UTC 将 Gemini 3.6／3.8 Flash 的输入／输出／缓存读取价从 0.75／3.75／0.075 切换为 1.5／7.5／0.15。
- **Google 默认参数**：Temperature、上下文上限为空，超时 120 秒，输出为目录上限与 65,536 的较小值。思考默认值按型号配置：2.5 Pro／Flash 的 `medium` 表示动态开启，2.5 Flash-Lite 默认关闭；未知型号不猜测思考配置。
- **ChatGPT**：显示标准模式、短上下文的 OpenAI API 参考价，不是订阅费用；只匹配已核对型号。
- **Ollama**：已确认的本地模型显示零平台调用费，不含硬件和电费；自定义远程主机不套用 Ollama 官方云端价格。
- **OpenRouter 缓存**：目录价格优先；缺失写入价仅对明确支持的型号按官方规则或严格匹配的端点报价补全，实际费用受路由影响。
- **自动输出额度**：OpenRouter、ChatGPT 使用模型输出上限，未知时 65,536，并受上下文限制；Ollama 最多 32,768，且不超过上下文一半，上下文未知按 8,192。实现见 `src/shared/output-tokens.ts`。
- **思考档位**：有效用户选择优先，其次模型默认值，再回退到中档或开启；选择逻辑见 `src/shared/models.ts`，请求转换见 `src/main/models/pi-thinking.ts`。

## 厂商国家依据

OpenRouter 与 OpenAI 兼容接口共用厂商分组、国家及别名映射。国家表示总部、运营主体或研发组织来源，**不表示服务器位置或请求路由**；地址、招聘地点仅作辅助证据。补充组织链接不代表已完成国家归属核验，待核验项在表中注明。

| 厂商或目录标识 | 国家或地区 | 来源与关键依据 |
| --- | --- | --- |
| `openrouter` | 美国 | [服务条款](https://openrouter.ai/terms)：纽约联系地址 |
| `xiaomi` | 中国 | [官方介绍](https://www.mi.com/mea/about/index.html)：北京总部 |
| `dots-studio` | 中国 | [官网](https://studio.dots.ai/)：源于小红书团队 |
| `nex-agi` | 中国 | [上海创智学院说明](https://www.sii.edu.cn/_s3/2026/0130/c27a671/page.psp)：学院与合作团队开发 |
| `aion-labs` | 波兰 | [服务条款](https://www.aionlabs.ai/pl/terms/)：Deep Forge sp. z o.o.，并非同名以色列机构 |
| `sakana` | 日本 | [官方介绍](https://sakana.ai/company-info-old/)：东京总部 |
| `upstage` | 韩国 | [官网](https://www.upstage.ai/)：首尔办公地址、韩国组织来源 |
| `typesafe` | 美国 | [服务条款](https://typesafe.ai/legal/terms)：旧金山联系地址 |
| `unbiased` | 美国 | [条款](https://unbiased.ai/terms/)：Circuit & Chisel, Inc.，美国总部 |
| `relace` | 美国 | [隐私政策](https://relace.ai/legal/privacy-policy)：旧金山联系地址 |
| `prism-ml` | 美国 | [招聘页](https://prismml.com/careers)：Pasadena、San Francisco 团队 |
| `perceptron` | 美国 | [官方介绍](https://www.perceptron.inc/about)：Bellevue 研发团队，勿混淆同名公司 |
| `rekaai` | 美国 | [联系页](https://reka.ai/contact)：Sunnyvale 地址 |
| `poolside` | 美国 | [官方说明](https://www.poolside.ai/government)：自述美国公司，勿因巴黎办公室归为法国 |
| `fireworks` | 美国 | [招聘页](https://fireworks.ai/careers)：San Mateo 等地团队 |
| `inception` | 美国 | [公司动态](https://www.inceptionlabs.ai/blog/categories/company)：Palo Alto |
| `thinkingmachines` | 美国 | [官方 LinkedIn](https://www.linkedin.com/company/thinkingmachinesai/)：旧金山总部 |
| `arcee-ai` | 美国 | [官方介绍](https://www.arcee.ai/about)：美国模型实验室 |
| `liquid` | 美国 | [官方平台](https://platform.liquid.ai/)：Cambridge, Massachusetts 地址 |
| `mistralai` | 法国 | [法律声明](https://mistral.ai/fr/legal/)：巴黎注册及办公地点 |
| `cohere` | 加拿大 | [官方介绍](https://cohere.com/about)：Toronto 创立 |
| `ai21` | 以色列 | [隐私政策](https://www.ai21.com/terms-policies/privacy-policy/)：Tel Aviv 运营主体 |
| `black-forest-labs`（Black Forest Labs） | 德国 | [官方组织](https://huggingface.co/black-forest-labs) |
| `deepseek-ai`（DeepSeek） | 中国 | [官方组织](https://huggingface.co/deepseek-ai) |
| `fishaudio`（Fish Audio） | 中国 | [官方组织](https://huggingface.co/fishaudio) |
| `funaudiollm`（FunAudioLLM／阿里巴巴） | 中国 | [官方组织](https://huggingface.co/FunAudioLLM) |
| `indexteam`（Index Team） | 中国 | [官方组织](https://huggingface.co/IndexTeam) |
| `inclusionai`（InclusionAI） | 中国 | [官方组织](https://huggingface.co/inclusionAI) |
| `meituan-longcat`（美团 LongCat） | 中国 | [官方组织](https://huggingface.co/meituan-longcat) |
| `minimaxai`（MiniMax） | 中国 | [官方组织](https://huggingface.co/MiniMaxAI) |
| `stepfun-ai`（阶跃星辰） | 中国 | [官方组织](https://huggingface.co/stepfun-ai) |
| `tongyi-mai`（通义千问） | 中国 | [官方组织](https://huggingface.co/Tongyi-MAI) |
| `wan-ai`（通义万相） | 中国 | [官方组织](https://huggingface.co/Wan-AI) |
| `zai-org`（智谱） | 中国 | [官方组织](https://huggingface.co/zai-org) |
| `xingchen-agi`（Xingchen AGI） | 中国 | [组织页面](https://huggingface.co/xingchen-agi)，国家归属待进一步核验 |
| `allam-2-7b`（ALLaM 模型） | 沙特阿拉伯 | 用户确认；待补充型号来源 |
| `whisper-large-v3`、`whisper-large-v3-turbo`（OpenAI） | 美国 | [Whisper 模型](https://huggingface.co/openai/whisper-large-v3)；无厂商前缀时按完整模型名归组 |

展示时移除厂商标识开头的 `~`、忽略大小写并归一化别名；调用时保留原始模型 ID。来源不足时保留未知，不根据社区成员所在地推断国家。
