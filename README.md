# dsh-multiagent-modes · 多 Agent 协作模式

> Multi-agent collaboration presets for DeepSeek Harness: subagents do the work, the main agent never loses its train of thought. Balanced & efficient tiers.
> 多 Agent 协作预设：子代理执行，主代理思维链不断；均衡/高效两档。

## 这是什么 / What this is

一对 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 **Agent 预设（agent preset）**：

| 目录 | id | 显示名 | 起步档 |
|---|---|---|---|
| `scheduler/` | `scheduler` | 协作模式-均衡 | 均衡（单轮并发 ≤10，细拆多轮、边收边吸收） |
| `scheduler-fast/` | `scheduler-fast` | 协作模式-高效 | 高效（单轮并发 ≤20，积极多轮） |

核心设计：**主代理只做拆解、调度、验收与汇总；重活全部由子代理并行完成，只回传浓缩结论。** 完整执行过程留在子会话里，主代理的上下文只装决策点与结论——几乎不触发压缩，**思维链不断、细节不丢**。

## 核心理念 / Core ideas

1. **思维链保真（最强卖点）**：主代理单干会触发上下文压缩、早期推理被摘要化；子代理模式把执行留在子会话，主代理思维链全程保真。
2. **效率**：子代理并行执行，主代理只决策；吞吐来自分工正确，不是无脑堆并发。
3. **省 token（副产品）**：回传压缩 + 细拆多轮自然压低 token，但绝不为省 token 牺牲思维链完整。
4. **按复杂度分流**：`subagent` / `subagent_fork` 支持每单指定 `model`（flash/pro）与 `effort`（七档 off/minimal/low/medium/high/xhigh/max）——18 格里的模型与思考两个维度都能按任务逐单落地。
5. **汇报格式分级**：汇总/比对 → JSON；阅读理解 → 结构化 markdown；单一结论 → 结论（1~3 行）→ 关键依据 → 风险。

完整手册见 [docs/调度模式.md](docs/调度模式.md)：三维度（模型 × 思考 × 委派）+ 六个锚点 + 18 格全集。

## 安装 / Install

把两个目录复制到用户预设根目录，然后重启 DSH：

```powershell
$dst = "$env:USERPROFILE\.dsh\.agent-presets"
Copy-Item -Recurse -Force scheduler     $dst
Copy-Item -Recurse -Force scheduler-fast $dst
```

之后在「Agent 预设」选择器里选择「协作模式-均衡」或「协作模式-高效」开新会话。

## 用法 / Usage

- **两档在对话中随时切换**：说「高效」切高效，说「均衡」切均衡（persona 软切换，无需换预设）。
- **建议设置**：在 Web GUI 的 settings 中把 `agent-loop` 的 `maxParallelToolCalls` 设为 **20**（全局硬上限，只兜底不驱动行为）；两档差异由 persona 软限制实现（均衡 ≤10 / 高效 ≤20）。**另需**把思考档 `off` 映射为 wire 值 `none`（settings 的 `off:"none"` 映射）——一期 wire 测试已证 raw `off` 直发中转会 400，该映射是 `effort=off` 的硬前提，插件内不兜底。
- **每单指定模型与思考档**：`subagent` / `subagent_fork` 都有可选参数 `model`（如 `deepseek-v4-flash` / `deepseek-v4-pro`，不传 = 继承主代理模型）和 `effort`（七档 `off`/`minimal`/`low`/`medium`/`high`/`xhigh`/`max`，不传 = 模型默认档；机械活 `off`、简单执行 `minimal`/`low`、正常推理 `medium`/`high`、疑难 `xhigh`、关键决策 `max`）。例：并行派两个子任务，一个 `subagent(model: flash, effort: off)` 快速干活，一个 `subagent(model: pro, effort: max)` 攻坚。七档已在本部署中转适配器（dsh-relay-compat）上端到端实测 7/7 全通（2026-08-14，含 DSH 侧能力校验）；注意官方 `dsh-llm-deepseek` 适配器仅声明 off/high/max 三档，七档能力来自中转适配器，换适配器需重验。
- **工具固定后台运行**：两个子代理工具始终以 continuable 后台模式运行——立即返回 childId，子代理结束时会通知主代理收结果。
- **思考档 proxy**：`effort` 由本预设自带的本地插件在子代理创建窗口注入请求（agent/request 拦截），无需官方改动。注意：该机制只覆盖 `subagent` / `subagent_fork` 的 continuable 子代理；one-shot 与 workflow 的子代理不经过此 proxy。上游最小改动方案见 [docs/upstream-proposal.md](docs/upstream-proposal.md)。

## 仓库结构 / Layout

```
scheduler/            协作模式-均衡（agent.cordis.yml + preset.yml + plugins/ + skills/）
scheduler-fast/       协作模式-高效（同上）
docs/                 完整策略手册（含 18 格全集）、测试计划与上游提案
scripts/              双预设一致性校验脚本（verify-identical.ps1）
```

## 维护 / Maintenance

- `scheduler/` 与 `scheduler-fast/` 的 `plugins/subagent-routed.v2.js` 与
  `skills/scheduler-modes/SKILL.md` 必须**双份保持一致**（两预设仅允许
  persona 速率档与 preset 元数据不同）。改动后运行
  `pwsh scripts/verify-identical.ps1` 校验，不一致会报错退出。
- 完整策略手册 `docs/调度模式.md` 与两份 SKILL 为同一事实的三份副本
  （SKILL 为运行时加载的唯一事实源），改动须同步。

## 许可证 / License

[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)（署名-相同方式共享）：

- ✅ 可商用、可修改、可再分发；
- ⚠️ 衍生作品必须同样以 CC BY-SA 4.0 开源，并保留原作者署名；
- 🔒 如需闭源衍生或商业独占授权，请先联系作者。

## 相关链接 / Links

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（官方）
- [dsh-relay-compat](https://github.com/y08lin4/dsh-relay-compat)（DSH 接入第三方中转的兼容工具包：developer-role 补丁 + 一键重打 + 医生插件 + 接入手册）
- [dsh-plugin topic](https://github.com/topics/dsh-plugin)（社区插件生态）
- [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)（社区插件列表）
