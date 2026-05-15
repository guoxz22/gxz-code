# GXZ-code

GXZ-code 是一个 **GLM 优先** 的本地终端 coding agent CLI。它参考 Claude Code 的本地终端工作方式，但实现是独立的；默认连接智谱 BigModel / GLM Coding Plan 端点，也可以连接 OpenAI 兼容或 Anthropic Messages 兼容的服务。

## 当前能力

- 默认使用 `glm-5.1` 和 `https://open.bigmodel.cn/api/coding/paas/v4`。
- 支持 OpenAI Chat Completions 兼容协议和工具调用。
- 支持 Anthropic Messages 兼容协议。
- 支持一次性命令、chat 模式和默认 TUI 交互界面。
- 运行 `gxz` 或 `gxz-code` 即可进入类似 Claude Code 的终端对话界面。
- 支持 session 保存、恢复、搜索和导出。
- TUI 支持 `/context`、`/resume`、`/model`、`/mcp`、`/review`、`/compact`、`/doctor`、`/skills`、`/permissions`、`/exit` 等 slash 命令。
- 支持 slash 命令提示：输入 `/r` 会显示 `/resume`、`/review` 等候选；可用上下键选择、Tab 补全、Enter 执行。
- 支持输入历史、Ctrl-R 历史搜索、Ctrl-J/Shift-Enter 换行、Ctrl-C 中断当前模型运行。
- 带砖红色 FOX 启动图案和 `/dashboard` 状态面板。
- 支持 `/effort` 和 `/effect`：`low`、`medium`、`high`、`xhigh`。
- 支持 GLM 模型别名：`glm`、`turbo`、`air`；也支持 Claude 风格别名：`opus`、`sonnet`、`haiku`，但 Claude 模型需要 Anthropic API key。
- 支持本地 memory、custom slash commands、hooks、skills。
- 内置工具包括：文件读写、patch 预览/应用、文件搜索、shell、web fetch、todo、monitor、git worktree、GitHub CLI、MCP、LSP、subagent、team 编排。
- 支持 MCP stdio 和 streamable HTTP server，支持 tools/resources/prompts，MCP prompts 会作为 slash suggestion 出现。
- 支持 LSP code action、hover、references 和 workspace edit 基础应用。
- 支持 GitHub/GitLab PR/MR 信息读取，GitHub CLI dry-run 写操作。
- 默认不存储 API key，配置展示会自动脱敏。

## 安装

```bash
npm install
npm run build
```

本地运行：

```bash
node dist/src/cli.js --help
node dist/src/cli.js
node dist/src/cli.js "检查这个仓库并总结结构"
```

全局链接：

```bash
npm link
gxz
gxz-code
gxz-code "读取 package.json 并解释 scripts"
```

## GLM 配置

不要把密钥写进仓库。请使用环境变量：

```bash
export GLM_API_KEY="..."
# 或 BIGMODEL_API_KEY / ZHIPU_API_KEY
```

PowerShell：

```powershell
$env:GLM_API_KEY = "..."
```

默认值：

- Provider：`glm-openai`
- Model：`glm-5.1`
- OpenAI 兼容端点：`https://open.bigmodel.cn/api/coding/paas/v4`
- Anthropic 兼容端点：`https://open.bigmodel.cn/api/anthropic`

切换模型：

```bash
gxz-code --model glm-5-turbo "修复失败测试"
gxz-code --model turbo "快速检查代码"
gxz-code --provider glm-anthropic --model glm-4.5-air "审查这个文件"
```

模型别名：

```text
glm, default       -> glm-openai/glm-5.1
turbo             -> glm-openai/glm-5-turbo
air               -> glm-openai/glm-4.5-air
opus              -> anthropic/claude-opus-4-7
sonnet            -> anthropic/claude-sonnet-4-6
haiku             -> anthropic/claude-haiku-4-5
```

注意：`opus`、`sonnet`、`haiku` 是 Anthropic Claude 模型别名，需要 `ANTHROPIC_API_KEY`。GLM API key 不能直接调用 Claude 模型。

## 其他 Provider

OpenAI 兼容：

```bash
export OPENAI_API_KEY="..."
export OPENAI_BASE_URL="https://api.openai.com/v1"
gxz-code --provider openai --model gpt-4.1 "总结 src"
```

Anthropic 兼容：

```bash
export ANTHROPIC_API_KEY="..."
export ANTHROPIC_BASE_URL="https://api.anthropic.com"
gxz-code --provider anthropic --model sonnet "检查代码"
```

## 常用 CLI

```text
gxz-code
gxz-code [options] [prompt]
gxz-code chat [options]
gxz-code tui [options]
gxz-code team [options] <goal>
gxz-code config --show
gxz-code models
gxz-code sessions
gxz-code status
gxz-code diff
gxz-code init
gxz-code doctor
gxz-code skills
gxz-code mcp
gxz-code diagnostics
gxz-code code-action --path <file> --action <name>
gxz-code patch --path <file> --old <text> --new <text> [--apply]
gxz-code review
gxz-code pr [--repo owner/repo --number 123]
gxz-code github --action pr-view --repo owner/repo --number 123
gxz-code commit --message "说明为什么要提交"
gxz-code cost --resume my-session
gxz-code bridge --port 37818
```

## TUI Slash Commands

进入 TUI：

```powershell
gxz
```

常用命令：

```text
/help
/dashboard
/context
/history
/clear
/sessions
/resume [session-id]
/save [session-id]
/cost [session-id]
/model [name]
/provider [glm-openai|glm-anthropic|openai|anthropic]
/effort [low|medium|high|xhigh]
/effect [low|medium|high|xhigh]
/config
/settings [list|get <key>|set <key> <value>]
/init
/memory [show|add|init]
/commands [list|new]
/hooks
/tools
/skills
/doctor
/compact
/status
/diff
/diagnostics [command]
/mcp [tools|resources|prompts]
/mcp call <server> <tool> [json]
/mcp read-resource <server> <uri>
/mcp get-prompt <server> <prompt> [json]
/mcp:<server>:<prompt> [json]
/code-action <path> <action>
/patch <path> <old> <new> [--apply]
/review
/team <goal>
/pr [github|gitlab repo number]
/github <pr-view|pr-diff|pr-checks|issue-view|issue-list|pr-comment|issue-comment|issue-create> [repo] [number|limit] [body] [--publish]
/monitor [start|list|read|stop]
/worktree [list|add|remove]
/permissions [off|risky|all|clear|allow-tool|deny-tool|allow-shell|deny-shell]
/exit
```

TUI 交互：

- 输入 `/` 或 `/r` 会显示命令候选。
- Up/Down 选择候选，Tab 补全，Enter 执行。
- 无候选时 Up/Down 浏览历史。
- Ctrl-R 搜索历史，Esc 退出搜索。
- Ctrl-J 或 Shift-Enter 插入换行。
- Ctrl-C 中断当前模型运行但保留会话。

## 本地 Memory / Commands / Hooks

Memory 文件：

```text
~/.gxz-code/GXZ.md          用户记忆
./GXZ.md                    项目记忆
./.gxz-code/memory.md       本地项目记忆
```

自定义 slash commands：

```text
~/.gxz-code/commands/*.md
./.gxz-code/commands/*.md
```

例如 `explain.md` 会变成 `/explain`。Markdown 中可用 `$ARGUMENTS` 或 `{{arguments}}` 接收参数。

Hooks 配置文件：`./.gxz-code/hooks.json`

```json
{
  "UserPromptSubmit": [{ "command": "node scripts/on-prompt.js" }],
  "PreToolUse": [{ "command": "node scripts/pre-tool.js" }],
  "PostToolUse": [{ "command": "node scripts/post-tool.js" }]
}
```

## MCP

stdio server：

```bash
gxz-code mcp --action add --server filesystem --cmd node --args '["./path/to/server.js"]'
```

streamable HTTP server：

```bash
gxz-code mcp --action add --server docs --url http://localhost:3000/mcp --headers '{"Authorization":"Bearer token"}'
```

常用操作：

```bash
gxz-code mcp --action list
gxz-code mcp --action resources
gxz-code mcp --action prompts
gxz-code mcp --action read-resource --server filesystem --uri file:///README.md
gxz-code mcp --action get-prompt --server docs --prompt-name review --arguments '{"topic":"api"}'
gxz-code mcp --action test --server filesystem
gxz-code mcp --action remove --server filesystem
```

MCP prompts 会在 TUI 中以 `/mcp:<server>:<prompt>` 形式出现在 slash suggestion 中。

## Patch / LSP

Patch 预览和应用：

```bash
gxz-code patch --path src/file.ts --old "old text" --new "new text"
gxz-code patch --path src/file.ts --old "old text" --new "new text" --apply
```

TUI 中 `/patch <path> <old> <new>` 会先显示 diff 并询问是否应用。

真实 LSP：

```bash
export GXZ_LSP_COMMAND=typescript-language-server
export GXZ_LSP_ARGS='["--stdio"]'
gxz-code code-action --path src/file.ts --action lsp
gxz-code code-action --path src/file.ts --action hover
gxz-code code-action --path src/file.ts --action references
```

## Monitor / Worktree

```text
/monitor start npm test -- --watch
/monitor list
/monitor read <id> 80
/monitor stop <id>
/worktree list
/worktree add ../gxz-feature feature/experiment
/worktree remove ../gxz-feature
```

## Team / Subagent

```bash
gxz-code team "给 provider stream parser 添加一个聚焦测试"
gxz-code team --plan-json '{"tasks":[{"id":"map","role":"explore","prompt":"map tests"},{"id":"check","role":"verifier","prompt":"verify tests","dependsOn":["map"]}]}'
```

## PR / GitHub

```bash
gxz-code pr
gxz-code pr --platform github --repo owner/repo --number 123
gxz-code pr --platform gitlab --repo group/project --number 123 --comment "LGTM with notes"
gxz-code pr --platform github --repo owner/repo --number 123 --comment "review body" --publish
```

GitHub CLI helpers：

```bash
gxz-code github --action pr-view --repo owner/repo --number 123
gxz-code github --action pr-diff --repo owner/repo --number 123
gxz-code github --action pr-checks --repo owner/repo --number 123
gxz-code github --action issue-list --repo owner/repo --limit 20
gxz-code github --action issue-view --repo owner/repo --number 456
gxz-code github --action pr-comment --repo owner/repo --number 123 --body "review note"
gxz-code github --action pr-comment --repo owner/repo --number 123 --body "review note" --publish
gxz-code github --action issue-create --repo owner/repo --title "Bug" --body "Details"
```

GitHub 写操作默认 dry-run，需要 `--publish` 才会真正执行。

## 安全说明

- GXZ-code 不会把 API key 写入仓库。
- `config --show` 只显示 key 是否存在，不显示真实值。
- 文件工具只能访问 workspace 内路径。
- shell 默认只允许保守的只读命令，写入类命令需要 `--allow-shell`。
- GitHub 发布类操作默认 dry-run。

## 测试

```bash
npm run typecheck
npm test
npm run smoke
```

当前项目包含覆盖 config、providers、tools、agent loop、TUI、MCP、LSP、GitHub、monitor、worktree 等模块的测试。

## 参考

- BigModel Chat Completions API: https://docs.bigmodel.cn/api-reference
- BigModel Coding Plan 工具配置: https://docs.bigmodel.cn/cn/coding-plan/tool/others
- Anthropic Messages API: https://docs.anthropic.com/en/api/overview
