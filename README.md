# MiniCode

> 轻量终端 AI 编程助手 · Lightweight terminal AI coding agent

MiniCode 是一个运行在终端里的 AI 编程助手：输入需求，它读代码、调工具、改文件，最后在同一会话里给你结果。

MiniCode is a terminal AI coding agent: describe the task, it reads code, calls tools, edits files, and answers in the same session.

```bash
npm install
npm run install-local
minicode
```

## 特性 Features

- **Agent 循环 Agent loop**：`model -> tool -> model` 多步工具调用，一次提问可连续读文件、搜代码、跑命令、改代码。
  Multi-step tool calling in a single turn: read, search, run, edit.
- **全新欢迎卡片 Welcome card**：启动居中展示 LOGO + 模型 / 工作区 / 会话数 / Memory 状态，自适应终端宽窄。
  Centered welcome card showing model, workspace, saved sessions and memory status, adapts to terminal width.
- **一键复制 Copy**：`/copy` 复制最后一条回答；鼠标选中文本自动复制（OSC 52 + `clip` / `pbcopy` / `xclip` 三层兜底，Windows 下 UTF-16LE + BOM 保证中文不乱码）。
  `/copy` copies the last answer; mouse selection auto-copies. OSC 52 + native clipboard fallback, UTF-16LE + BOM on Windows for CJK.
- **完整 TUI**：输入历史、slash 菜单、transcript 滚动、工具执行状态、permission 审批流（Up/Down + Enter，也支持快捷键）。
  Full-screen TUI with history, slash menu, transcript scrolling, tool status and approval flow.
- **会话持久化 Sessions**：每轮自动保存，`/resume` 挑选恢复、`/rename` 改名、`/fork` 分叉、`/new` 重开，按工作区隔离，30 天过期清理。
  Auto-saved per working directory with resume / rename / fork / new, 30-day expiry.
- **长会话上下文 Context**：provider 用量优先的 context 统计 + TUI 徽标，`/compact` 手动压缩，`snip` 确定性裁剪，`collapse` 投影式摘要，高水位自动压缩。
  Provider-usage-first context stats, manual `/compact`, deterministic `/snip`, projection `/collapse`, auto-compact at high utilization.
- **安全边界 Safety**：写文件先 review diff（unified diff），路径 + 命令权限检查，危险操作走审批。
  Review-before-write with unified diff, path + command permission checks, approval for dangerous actions.
- **扩展 Extension**：本地 `SKILL.md` 技能发现 + `load_skill`，MCP（stdio / streamable-http，`Content-Length` 与 `newline-json` 自适应）动态注册为 `mcp__<server>__<tool>`。
  Local `SKILL.md` skills and MCP servers auto-registered as tools, resources and prompts helpers included.

## 安装 Installation · 安装

```bash
cd MiniCode-main
npm install
npm run install-local
```

安装器会问模型名、`ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`，配置落在：

The installer asks for model name, `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN`. Config lives in:

- `~/.mini-code/settings.json`
- `~/.mini-code/mcp.json`

环境变量覆盖 Config overrides:

```bash
export MINI_CODE_HOME=/path/to/config      # 配置目录 config dir
export MINI_CODE_BIN_DIR=/path/to/bin      # launcher 目录 launcher dir
export MINI_CODE_MOUSE=1                   # 开启鼠标跟踪（选中复制） Enable mouse tracking
```

`~/.local/bin` 不在 `PATH` 里时记得加上 Add to `PATH` if needed:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## 快速开始 Quick Start

```bash
minicode                 # 启动 installed launcher
npm run dev              # 开发模式 dev mode
MINI_CODE_MODEL_MODE=mock npm run dev  # 离线演示 offline demo, no API key
```

## 命令 Commands

常用 slash 命令 Common slash commands:

| 命令 Command | 说明 Description |
|---|---|
| `/help` | 所有命令一览 list all commands |
| `/tools` `/skills` `/mcp` `/status` `/memory` | 工具 / 技能 / MCP / 模型状态 / 记忆一览 inspect tools, skills, MCP, model, memory |
| `/copy` | 复制最后一条回答 copy last answer |
| `/resume` `/resume <id>` | 会话选择器 / 按 ID 恢复 picker / resume by id |
| `/rename <name>` `/new` `/fork` | 改名 / 重开 / 分叉 rename / fresh / fork |
| `/compact` `/snip` `/collapse` | 压缩 / 裁剪中段 / 投影折叠 compress / snip middle / collapse spans |
| `/init` | 初始化 `.mini-code/` + `MINI.md` scaffold project memory |
| `/model` `/model <name>` | 查看 / 切换模型 show / switch model |
| `/read <path>` `/write <p>::<c>` `/edit <p>::<s>::<r>` | 快捷读写改 shortcut file ops |
| `/cmd [cwd::]<command>` | 跑允许的命令 run allowed command |
| `/exit` | 退出 exit |

管理命令 Management:

```bash
minicode --resume            # 启动时进会话选择器 open picker on launch
minicode --resume <id>       # 直接恢复 resume by id
minicode --fork <id>         # 分叉后恢复 fork and resume
minicode mcp list | add | remove | login | logout
minicode skills list | add | remove
```

## 配置 Configuration

`~/.mini-code/settings.json` 示例 Example:

```json
{
  "model": "your-model-name",
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    }
  },
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.anthropic.com",
    "ANTHROPIC_AUTH_TOKEN": "your-token"
  }
}
```

优先级 Priority：`settings.json` > `mcp.json` > 项目 `.mcp.json` project config > 本地兼容配置 compat local settings > 环境变量 env.

技能发现 Skill discovery：`./.mini-code/skills/<name>/SKILL.md`、`~/.mini-code/skills/<name>/SKILL.md`、`./.claude/skills/`、`~/.claude/skills/`。

项目记忆 Project memory（`/memory` 查看 inspected via `/memory`）：全局 `~/.mini-code/MINI.md` + 从 cwd 向上逐层找 `MINI.md` / `CLAUDE.md` / `.mini-code/rules/*.md`，越靠近 cwd 优先级越高，支持 `@relative/path.md` 引用。

Global `~/.mini-code/MINI.md` plus upward walk for `MINI.md` / `CLAUDE.md` / rules; closer to cwd wins; `@path` includes supported.

## 开发 Development · 开发

```bash
npm run check   # tsc --noEmit, PR 前必跑 required before PR
npm test        # 全部测试 all tests (node:test + tsx, test/*.test.ts)
npm run lint    # eslint src test
```

单测 Single test:

```bash
node --import tsx --test test/<name>.test.ts
```

核心目录 Layout:

- `src/index.ts` — CLI 入口 entry (TTY → `tty-app.ts`，非 TTY → readline)
- `src/agent-loop.ts` — `model -> tool -> model` 主循环 main loop
- `src/tools/` + `src/tool.ts` — 内置工具与注册表 builtin tools & registry
- `src/tty-app.ts` + `src/ui.ts` + `src/tui/` — 终端状态机与渲染 TUI state machine & rendering
- `src/session.ts` — JSONL 会话持久化 session persistence
- `src/compact/` — compact / snip / collapse 上下文管理 context management
- `src/permissions.ts` + `src/file-review.ts` — 权限与写前 review permissions & review
- `src/skills.ts` + `src/mcp.ts` — 技能与 MCP skills & MCP
- `src/memory/` — 自进化记忆 evolving memory

保持轻量：小步 PR、显式数据流、能不加依赖就不加。
Keep it lightweight: small PRs, explicit data flow, minimal dependencies.

## License

MIT — 见 See [LICENSE](./LICENSE).
