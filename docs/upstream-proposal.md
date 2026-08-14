# 上游提案：子代理调用传入思考程度（reasoningEffort）

> 本文档是给 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
> 提交 PR 的技术设计。全部结论基于对本部署所装源码的逐行核实（文件与行号以
> 调查时版本为准）。

## 背景问题

- 主代理可通过 UI 选择思考档，但 `subagent` / `subagent_fork` 工具没有思考档参数；
- 子代理创建链（`AgentOptions`）只传 provider/model/maxTokens，reasoningEffort 无处安放；
- 结果：所有子代理一律落「模型默认档」，无法按任务繁简分层（简单任务浅思考、困难任务深思考无从谈起）。

## 最小改动：3 个包、5 处文件（全部可选字段、向后兼容）

| 包 | 文件 | 位置 | 改动 |
|---|---|---|---|
| @deepseek-ai/dsh-agent | `lib/types/runtime-types.d.ts` | 约 21-28 行 | `AgentOptions` 加 `reasoningEffort?: ReasoningEffortId` |
| @deepseek-ai/dsh-agent-loop | `lib/index.js` | 约 672-684 行（`buildRequest`） | 种子档 = 显式 `options.reasoningEffort` **优先于** header 继承 |
| @deepseek-ai/dsh-tool-subagent | `lib/index.js` | 约 27-31 行（Config zod） | `agentOptions` 加 `reasoningEffort` |
| @deepseek-ai/dsh-tool-subagent | `lib/index.js` | 约 142-157 行（工具 schema） | 参数加 `reasoningEffort`（可选 string） |
| @deepseek-ai/dsh-tool-subagent | `lib/index.js` | 约 221-232 行（execute 组装） | 合并 `args.reasoningEffort` 进 `agentOptions` |

同步更新 `dsh-tool-subagent/lib/types/index.d.ts` 的 Config 接口声明。

## 代码级改动说明

### 1. dsh-agent：类型（无 zod schema，运行时透传已验证）

```ts
// 现状
export interface AgentOptions {
    provider?: string;
    model?: string;
    maxTokens?: number;
}
// 改后
export interface AgentOptions {
    provider?: string;
    model?: string;
    maxTokens?: number;
    /** Explicit reasoning effort seeded into this agent's first request and persisted via its request header. */
    reasoningEffort?: ReasoningEffortId;
}
```

关键事实：`AgentOptions` **没有 zod schema**（全 dsh-agent 无 AgentOptionsSchema，
`agents.create` 无校验），`resolveChildAgentOptions` 的 `...requested` 展开已在
运行时透传未知字段——类型加上后运行时无需再动。

### 2. dsh-agent-loop：buildRequest 种子（显式 > 继承）

```js
// 现状（约 678 行）
const reasoningEffort = persistedConfig?.provider === route.provider && persistedConfig.model === route.model && persistedHeader?.adapterDefaults?.reasoningEffort !== true ? persistedConfig.reasoningEffort : void 0;

// 改后
const inheritedEffort = persistedConfig?.provider === route.provider && persistedConfig.model === route.model && persistedHeader?.adapterDefaults?.reasoningEffort !== true ? persistedConfig.reasoningEffort : void 0;
const reasoningEffort = this.options.reasoningEffort ?? inheritedEffort;
```

语义链：spawn 子代理（新会话无 header）用显式档进首请求 → 档随 request/header
事件持久 → 续命对话与冷恢复自动延续；fork 子代理原继承路径保留、可被显式档覆盖。

### 3. dsh-tool-subagent（三处）

- **Config zod** 加 `reasoningEffort: z.string()`（推荐 **string 而非 enum**：
  档位是 provider 自有能力，不支持的档由 llm 层 `resolveCallFor` 抛
  `UNSUPPORTED_REASONING_EFFORT` 兜底，通用工具不硬编码 DeepSeek 的 off/high/max）。
- **工具参数**（description/prompt/run_in_background 之后）加：
  ```js
  reasoningEffort: {
    type: "string",
    description: "Optional reasoning-effort id for this child (adapter-owned, e.g. off/high/max on DeepSeek). Omit to use the model default."
  }
  ```
- **execute 组装**：合并 `{ ...config.agentOptions, ...args.reasoningEffort === void 0 ? {} : { reasoningEffort: args.reasoningEffort } }`。

## 明确不动的包

- **dsh-subagent**：`SubagentStartRequest.agentOptions` 引用 `AgentOptions` 类型自动获得
  新字段；两条创建路径（one-shot / continuable）原样透传。
- **dsh-session**：seed 验证已接受 `configRecord["reasoningEffort"]`；header fold、
  canonicalHeader、callConfigEquals 均认识该字段。
- **dsh-llm**：`LlmCallConfig.reasoningEffort` 已存在，能力校验与默认档补全已就绪。
- **dsh-workflow**：workflow 引擎明确拒绝 effort，worker 协议改动留作后续独立 PR。
- **dsh-agent-loop/invariant.js**：invariant 比较字段不含 reasoningEffort。

## 设计要点与风险

1. **向后兼容** ✅ 全部新增可选字段，旧调用/旧 yml 行为不变。
2. **zod 同步** ⚠️ tool-subagent 的 Config zod 必须同步加字段，否则 yml 配置会被剥。
3. **继承语义**：新增「显式 > fork 继承 > 默认」优先级；原有「模型覆盖则不继承」
   安全阀保留。
4. **adapterDefaults 一致性** ✅ 显式档走 requested 分支，header 回放与冷恢复一致。
5. **provider 通用性** ✅ 参数用 string，错误档位由 llm 层抛错，反馈明确。
6. **全走官方公开类型与正式路径**，不依赖任何未公开行为（比 preset 内 hack 方案稳）。

## PR 元信息

- **标题**：`feat(subagents): allow per-call reasoning effort (reasoningEffort) on subagent tools`
- **描述要点**：
  - Problem：subagent delegation exposes no per-call control over reasoning effort; every child falls back to the model default, so "simple task → shallow, hard task → deep" routing is impossible from the orchestrating agent.
  - Change：add optional `reasoningEffort` to `AgentOptions` (type only — no zod schema exists); seed it into the child's first request in `buildRequest` with explicit-over-inherited precedence; expose an optional `reasoningEffort` string parameter on `dsh-tool-subagent` tools and its `config.agentOptions`.
  - Semantics：explicit per-call effort > fork-inherited header effort (only when provider+model match) > adapter default. The chosen effort is persisted in the child's request/header event, so continuable follow-ups and cold resumes keep the same effort.
  - Validation：unsupported effort ids still reject via existing `UNSUPPORTED_REASONING_EFFORT` in dsh-llm — no new validation layer.
  - Compatibility：all fields optional; no zod schema changes elsewhere; invariant checks unaffected; workflows unchanged (follow-up PR).
  - Tests：unit — buildRequest precedence matrix (explicit/override/fork-inherit/default); tool — parameter passthrough into SubagentStartRequest.agentOptions.

## 与本仓库的关系

本仓库的 `plugins/subagent-routed.v2.js` 是在上游未合并前的**运行时参考实现**
（proxy 层注入），README 已标注其依赖的非正式契约与覆盖边界。上游合并后，
本插件应切换为官方参数、删掉 proxy workaround。
