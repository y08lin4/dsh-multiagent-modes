<#
verify-identical.ps1 - 校验 scheduler / scheduler-fast 双预设一致性

- 插件与 SKILL 必须逐字节相同（SHA256 比对），不一致即 FAIL 退出码 1；
- preset.yml 允许不同（预期仅预设名/描述），仅提示；
- agent.cordis.yml 允许不同（预期仅 persona 速率档几行），打印 diff 供人工核对。

用法：pwsh scripts/verify-identical.ps1
退出码：0 = 关键文件一致；1 = 关键文件不一致。
#>

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$fail = $false

$identical = @(
  "plugins/subagent-routed.v2.js",
  "skills/scheduler-modes/SKILL.md"
)

foreach ($rel in $identical) {
  $ha = (Get-FileHash (Join-Path $root "scheduler/$rel") -Algorithm SHA256).Hash
  $hb = (Get-FileHash (Join-Path $root "scheduler-fast/$rel") -Algorithm SHA256).Hash
  if ($ha -eq $hb) { Write-Host "OK    $rel" }
  else { Write-Host "DIFF  $rel ($ha != $hb)"; $fail = $true }
}

# preset.yml：有意差异，仅提示
$p1 = Get-Content (Join-Path $root "scheduler/preset.yml") -Raw
$p2 = Get-Content (Join-Path $root "scheduler-fast/preset.yml") -Raw
if ($p1 -ne $p2) { Write-Host "NOTE  preset.yml 存在差异（预期：仅预设名/描述）" }
else { Write-Host "WARN  preset.yml 完全相同（两预设名应不同？）" }

# agent.cordis.yml：打印差异，预期仅 persona 速率档几行
Write-Host "--- agent.cordis.yml diff（预期仅 persona 速率档几行）---"
git -C $root diff --no-index -- scheduler/agent.cordis.yml scheduler-fast/agent.cordis.yml
$code = $LASTEXITCODE
if ($code -ne 0 -and $code -ne 1) { $fail = $true }

if ($fail) {
  Write-Host "FAIL：双预设关键文件不一致，请双份同步后重跑。"
  exit 1
}
Write-Host "PASS：双预设关键文件一致。"
exit 0
