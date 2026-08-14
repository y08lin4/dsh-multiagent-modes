# pi-ai 补丁：`supportsDeveloperRole`

## 这是什么

一个针对 `@deepseek-ai/dsh-llm-pi-ai` 的本地补丁，让它把
`compat.supportsDeveloperRole` 这个开关从配置透传到 `@earendil-works/pi-ai`。

**它解决的错误**（DeepSeek 兼容中转，如 new-api / lyai 面板）：

```
400: messages[0].role: unknown variant `developer`,
expected one of `system`, `user`, `assistant`, `tool`, `latest_reminder`
```

## 为什么需要它

`@earendil-works/pi-ai` 在 OpenAI-completions 协议下，对「会推理的模型」默认把
system prompt 的 role 发成 `developer`（OpenAI 新风格）。但 DeepSeek 后端只认
`system`，于是报 400。

官方适配器 `@deepseek-ai/dsh-llm-deepseek`（provider 名 `deepseek-official`）
**根本不会发 `developer`**，所以：

- **走官方 `deepseek-official` → 不需要这个补丁。**
- **走中转 `lyai`（pi-ai 路径）→ 需要这个补丁 + 设置 `supportsDeveloperRole: false`。**

## 生效条件（两个都要）

1. 补丁打上（下面命令）。
2. `settings.yaml` 里对应 model 的 `compat` 设成 `false`：

```yaml
llm-pi-ai:
  providers:
    lyai:
      api: openai-completions
      models:
        - id: deepseek-v4-pro
          compat:
            supportsReasoningEffort: true
            supportsDeveloperRole: false   # ← 关键
```

两者缺一，`developer` 400 会复现。改完必须**重启 DSH**。

## 重新打补丁（npx 缓存刷新 / 换机器后）

补丁是打在 npx 缓存里的，缓存刷新后会被丢弃。重新打：

```powershell
# 1. 找到当前缓存的包目录（hash 每次可能不同）
$pkg = Get-ChildItem "$env:LOCALAPPDATA\npm-cache\_npx" -Recurse -Filter "index.js" |
       Where-Object { $_.FullName -like "*dsh-llm-pi-ai\lib\index.js" } |
       Select-Object -First 1
$root = Split-Path (Split-Path $pkg.FullName)   # ...\node_modules\@deepseek-ai\dsh-llm-pi-ai

# 2. 从包根目录打补丁
Push-Location $root
git -c core.autocrlf=false apply -p1 "C:\Users\lin\Desktop\deepseek\dsh-multiagent-modes\docs\patches\dsh-llm-pi-ai-supportsDeveloperRole.patch"
Pop-Location
```

> `core.autocrlf=false` 必须加：包内 JS 是 LF 换行，否则 Windows 的 git 会转成
> CRLF，导致文件被改写。
>
> 打完后重启 DSH 才生效。

## 验证

```powershell
Select-String -Path "$root\lib\index.js" -Pattern "supportsDeveloperRole" |
  Measure-Object | Select-Object -ExpandProperty Count
# 应输出 5
```

## 补丁打不上 / 版本漂移了怎么办

如果 `@deepseek-ai/dsh-llm-pi-ai` 升级导致补丁无法干净 apply，手动做这 5 处等价改动：

1. `resolveModelCompat()` 里加一行读取：
   `const supportsDeveloperRole = entry.compat?.supportsDeveloperRole ?? route?.supportsDeveloperRole;`
2. 早退条件补上 `&& supportsDeveloperRole === void 0`。
3. `invalid(...)` 的非 openai-completions 报错条件补上
   `|| entry.compat?.supportsDeveloperRole !== void 0`。
4. 返回的 `compat` 对象补上 `...supportsDeveloperRole === void 0 ? {} : { supportsDeveloperRole }`。
5. `compatProfile` 的 zod schema 补上 `supportsDeveloperRole: z.boolean()`。

改完同样要保证 `settings.yaml` 里 `supportsDeveloperRole: false` 且重启 DSH。

## 上游

根治方案是把这 5 处改动提 PR 到 `@deepseek-ai/dsh-llm-pi-ai`。补丁文件本身即
diff，可直接用于 PR。
