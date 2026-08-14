/**
 * scheduler-subagent-routed: 带 model / effort 参数的子代理路由工具 + 思考档 proxy。
 *
 * 设计：主代理派发时可选指定 model（如 deepseek-v4-flash / deepseek-v4-pro）
 * 与 effort（off / minimal / low / medium / high / xhigh / max，七档）。
 * effort 通过 ContinuableSetupContribution
 * 在子代理的创建窗口安装一个 `agent/request` waterfall 拦截器，把请求
 * config 的 reasoningEffort 替换为指定档。未指定时行为与官方工具一致
 * （模型继承主代理、思考档用模型默认档）。
 *
 * 本文件零依赖（不 import 任何 npm 包）：预设目录旁没有 node_modules，
 * 手写 ToolDefinition 形状直接交给 ctx.tools.register。
 *
 * 限制（README 已如实标注）：
 * - 仅覆盖 continuable 子代理（本工具固定后台模式）；one-shot / workflow
 *   子代理不经过本 proxy。
 * - 依赖「agentOptions 运行时透传」这一非正式契约；官方未来加 zod 校验
 *   时需升级。
 */

export const name = "scheduler-subagent-routed"
export const inject = ["subagents", "tools"]

const EFFORTS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"])
const INSTALLED = Symbol.for("dsh-multiagent-modes/effort-proxy")

/** 每个子代理创建时执行：安装思考档 proxy。幂等（防双预设双注册）。 */
function effortProxy(childCtx) {
  const agent = childCtx.agent
  if (agent === undefined) return () => {}
  const effort = agent.options && agent.options.reasoningEffort
  if (typeof effort !== "string" || effort.length === 0) return () => {}
  if (childCtx[INSTALLED] === true) return () => {}
  childCtx[INSTALLED] = true
  return childCtx.on("agent/request", async (_payload, next) => {
    const resolved = await next()
    return { ...resolved, reasoningEffort: effort }
  })
}

const INHERITS = {
  description: "Delegate a task to a subagent that inherits this conversation: a child agent seeded with all completed turns so far (it does not see the current in-flight turn). It runs in the background as a durable continuable child — the runtime notifies you when it settles, and send_message continues the same child conversation. Optional `model` routes this child to a specific model (\"deepseek-v4-flash\" for cheap/fast work, \"deepseek-v4-pro\" for hard work; omit to inherit the main agent's model). Optional `effort` sets this child's reasoning effort, one of \"off\" (no thinking, fastest/cheapest), \"minimal\"/\"low\" (quick answers), \"medium\"/\"high\" (normal reasoning), \"xhigh\" (hard debugging), \"max\" (deep reasoning for critical decisions); omit for the model's default.",
  prompt: "The task for the subagent. It already sees this conversation's completed turns, so build on them freely and state only what is new.",
}
const INDEPENDENT = {
  description: "Delegate a self-contained task to a subagent (a separate agent that works in its own context; it does not see this conversation, so include everything it needs). It runs in the background as a durable continuable child — the runtime notifies you when it settles, and send_message continues the same child conversation. Optional `model` routes this child to a specific model (\"deepseek-v4-flash\" for cheap/fast work, \"deepseek-v4-pro\" for hard work; omit to inherit the main agent's model). Optional `effort` sets this child's reasoning effort, one of \"off\" (no thinking, fastest/cheapest), \"minimal\"/\"low\" (quick answers), \"medium\"/\"high\" (normal reasoning), \"xhigh\" (hard debugging), \"max\" (deep reasoning for critical decisions); omit for the model's default.",
  prompt: "The complete, self-contained task for the subagent. It does not share this conversation's context, so include everything it needs.",
}

function makeTool(ctx, provider, toolName, wording) {
  return ctx.tools.register({
    name: toolName,
    description: wording.description,
    parameters: {
      description: {
        type: "string",
        required: true,
        description: "A short (3-5 word) description of the delegated task, for display.",
      },
      prompt: {
        type: "string",
        required: true,
        description: wording.prompt,
      },
      model: {
        type: "string",
        description: "Optional model id for this child (e.g. \"deepseek-v4-flash\", \"deepseek-v4-pro\"). Omit to inherit the main agent's model.",
      },
      effort: {
        type: "string",
        description: "Optional reasoning effort for this child, one of \"off\" (no thinking), \"minimal\"/\"low\" (quick answers), \"medium\"/\"high\" (normal reasoning), \"xhigh\" (hard debugging), \"max\" (deep reasoning). Omit for the model's default effort.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          childId: { type: "string" },
        },
        required: ["childId"],
      },
      render: (_args, value) => [{ type: "text", text: `started subagent ${value.childId}` }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const parent = exec.agent
      if (parent === undefined) throw new Error("subagent tool requires a calling agent (exec.agent was undefined)")
      if (args.effort !== undefined && !EFFORTS.has(args.effort)) {
        throw new Error(`invalid effort "${args.effort}": expected one of off, minimal, low, medium, high, xhigh, max`)
      }
      const agentOptions = {
        ...(args.model !== undefined ? { model: args.model } : {}),
        ...(args.effort !== undefined ? { reasoningEffort: args.effort } : {}),
      }
      const started = await ctx.subagents.startContinuable({
        provider,
        label: args.description,
        request: {
          prompt: [{ type: "text", text: args.prompt }],
          parent,
          agentOptions,
        },
        signal: exec.signal,
      })
      return { childId: started.childId }
    },
  })
}

export function apply(ctx) {
  const disposers = [
    makeTool(ctx, "spawn", "subagent", INDEPENDENT),
    makeTool(ctx, "fork", "subagent_fork", INHERITS),
    ctx.subagents.registerContinuableSetup(effortProxy),
  ]
  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
  })
}
