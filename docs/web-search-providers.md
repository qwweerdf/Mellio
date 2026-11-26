# 各供应商联网搜索接入调研

> 2026-11-26 调研。当前 Mellio 只有 OpenAI 兼容的 `/chat/completions` 适配层；下表的“难度”按现有架构评估。

| 供应商 | 接入方式 | 模型自己决定？ | 来源 citations | 难度 |
|---|---|---|---|---|
| **OpenRouter** | Chat Completions 里加 `tools: [{ type: "openrouter:web_search" }]` | ✅ 0–N 次 | ✅ 标准化 `url_citation` annotations | ⭐ 最容易 |
| **Qwen / 通义** | OpenAI 兼容模式加 `enable_search: true` | ✅ | ❌ 兼容接口不返回来源 | ⭐⭐ 简单但残 |
| **Groq** | `groq/compound` 自动搜；或 `browser_search` 工具 | 模型相关 | 部分支持 | ⭐⭐ |
| **OpenAI** | 必须走 Responses API 的 `web_search` 工具 | ✅ | ✅ annotations | ⭐⭐⭐ 要新协议 |
| **xAI / Grok** | 必须走 Responses API 的 `web_search` / `x_search` | ✅ | ✅ | ⭐⭐⭐ 要新协议 |
| **Anthropic** | Messages API 的 `web_search_20250305` 服务端工具 | ✅ | ✅ 始终返回 | ⭐⭐⭐ 要新协议 |
| **Gemini** | `google_search` grounding | ✅ | ✅ `groundingMetadata` | ⭐⭐⭐ 要新协议 |
| **Kimi** | 旧的 `$web_search` 已废弃，新 `/v1/tools/search` 要自己做工具循环 | 客户端循环 | 自己组装 | ⭐⭐⭐⭐ |
| **Perplexity** | Sonar Chat Completions 已停止，迁移 Agent API | — | — | ⭐⭐⭐⭐ 暂缓 |
| **Mistral / Cohere / 本地模型** | 没有好用的原生搜索 | — | — | ❌ 不建议现在做 |

## 推荐顺序

1. **OpenRouter**：复用现有 OpenAI 兼容层，一个入口覆盖大量模型，来源格式与现有解析器一致
2. **Responses 适配器**：OpenAI + xAI 共用，支持当前通用模型的官方搜索
3. **Anthropic / Gemini**：协议独立，按需直连
4. **Qwen / Groq**：作为补充；Qwen 兼容接口没有来源
5. **Kimi / Perplexity**：等协议稳定后再做

## 备注

- OpenRouter 用新的服务端工具 `openrouter:web_search`，不要用旧的 `:online`（旧的每次强制搜一次）
- 搜索按次计费，建议在服务商设置里保留「允许联网搜索」总开关，聊天框不放开每条的开关
- Kimi `$web_search` 于 2026-10-20 废弃；Perplexity Sonar Chat Completions 已停止支持

## 参考

- [OpenRouter Web Search](https://openrouter.ai/docs/guides/features/plugins/web-search)
- [OpenAI Web Search](https://developers.openai.com/api/docs/guides/tools-web-search)
- [xAI Web Search](https://docs.x.ai/developers/tools/web-search)
- [Anthropic Web Search Tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)
- [Qwen OpenAI-compatible API](https://help.aliyun.com/en/model-studio/qwen-api-via-openai-chat-completions)
- [Groq API Reference](https://console.groq.com/docs/api-reference)
- [Kimi Web Search](https://platform.kimi.ai/docs/guide/use-web-search)
- [Perplexity Sonar → Agent API migration](https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/overview)
- [Gemini Google Search grounding](https://ai.google.dev/gemini-api/docs/google-search)
