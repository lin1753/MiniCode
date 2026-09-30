# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

MiniCode is a lightweight terminal coding assistant (TypeScript, ESM, strict mode). Small Claude Code-like `model -> tool -> model` agent loop with full-screen TUI. Keep changes small, explicit, and traceable; avoid large abstractions or new dependencies unless clearly necessary.

## Commands

```bash
npm install
npm run dev                          # dev TUI (tsx src/index.ts)
MINI_CODE_MODEL_MODE=mock npm run dev # offline demo, no API key
npm run check                        # tsc --noEmit (run before PR)
npm test                             # all tests: node test/run-tests.mjs
npm run lint                         # eslint src test
npm run install-local                # interactive installer (model, ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN)
```

Single test (runner is `node:test` + `tsx`, auto-discovers `test/*.test.ts`):

```bash
node --import tsx --test test/<name>.test.ts
```

## Big-picture architecture

- `src/index.ts`: CLI entry. TTY → `runTtyApp()` (`src/tty-app.ts`); piped/non-TTY → readline fallback. Handles `--resume` / `--fork`, `minicode mcp|skills` management (`src/manage-cli.ts`), runtime/config/model/tool wiring.
- `src/agent-loop.ts` (`runAgentTurn`): the core loop. Per step: snip-compact → microcompact → context-collapse projection → auto-compact (if critical) → `model.next()` → execute tool calls → append `assistant_tool_call` + `tool_result` messages. Handles empty responses, thinking-block `pause_turn`/`max_tokens` retries, `ask_user` turn-pause.
- Tools: `src/tool.ts` registry + `src/tools/*` builtins (`read/write/edit/patch/modify_file`, `list/grep_files`, `run_command`, `web_fetch/search`, `ask_user`, `load_skill`, `spawn_agent`, MCP resource/prompt helpers). `src/tools/index.ts` builds the default registry; MCP tools register dynamically as `mcp__<server>__<tool>`.
- Model adapters: `src/anthropic-adapter.ts` (Anthropic-compatible Messages API, preserves thinking blocks across tool turns) and `src/mock-model.ts` (offline mode).
- TUI: `src/tty-app.ts` is the state machine (transcript, input, approval, session-picker, clipboard via OSC 52 + `clip`/`pbcopy`/`xclip`). Rendering split into `src/ui.ts` + `src/tui/` (`screen.ts` alt-screen diff render, `transcript.ts` wrap/scroll/selection, `chrome.ts`, `markdown.ts`, `input.ts`, `input-parser.ts`). Tests exist for CJK width, wrapping, selection, input parsing.
- Sessions: `src/session.ts` — per-cwd append-only JSONL in `~/.mini-code/projects/`, `parentUuid` chains, compact boundaries, fork/rename, 30-day expiry. Resume loads from latest compact boundary; transcript rebuilds from event log.
- Context management: `src/compact/` (`auto-compact`, `manual-compact`, `microcompact`, `snipCompact` deterministic middle-removal, `context-collapse` projection summaries). `src/utils/token-estimator.ts` is provider-usage-first with local-estimate fallback/tail. `src/utils/tool-result-storage.ts` persists results >50k chars under `~/.mini-code/tool-results/` and substitutes preview+path (200k visible budget).
- Safety: `src/permissions.ts` (cwd + path allowlist/denylist, command gating, per-turn edit approvals) + `src/file-review.ts` (unified-diff review before write). Do not weaken without explicit justification in the PR.
- Memory: `src/memory.ts` layered static instructions (`~/.mini-code/MINI.md` → ancestor walk of `MINI.md`/`CLAUDE.md`/`.mini-code/rules/*.md`, `@path` includes, ~8k/file, ~20k total) plus self-evolving `src/memory/` (`store.ts`, `retriever.ts`, `reflection.ts` post-turn async extraction).
- Skills/MCP: `src/skills.ts` + `src/skill-router.ts` discover `SKILL.md` under `.mini-code/skills/`, `.claude/skills/` (user + project). `src/mcp.ts` stdio client with `Content-Length` → `newline-json` fallback, remote `streamable-http`; see `src/mcp-status.ts`.
- Config (`src/config.ts`): priority `~/.mini-code/settings.json` > `~/.mini-code/mcp.json` > project `.mcp.json` > compat local settings > env. Overrides: `MINI_CODE_HOME`, `MINI_CODE_BIN_DIR`. `/init` (`src/init.ts`) scaffolds `.mini-code/`, `MINI.md` with detected stack.
- Concurrency: `src/background-tasks.ts` (long `run_command` surfaces as shell tasks), `src/agent-pool.ts` + `src/tools/spawn-agent.ts` for sub-agents.

## Conventions

- ESM with NodeNext: relative imports use `.js` suffixes for `.ts` files. Target ES2022, `strict: true`.
- ESLint: `no-empty` allows empty `catch`; `_`-prefixed unused vars ignored; `any` allowed. Test files exempt from unused-vars rule.
- Tests use `node:test` + `node:assert/strict`, TS imported directly via `tsx` (see `test/run-tests.mjs`, `test/windows-clipboard-encoding.test.ts` for clipboard-encoding pattern).
- User-facing behavior changes must update `README.md` / `USAGE.md` / `ARCHITECTURE.md` (plus `*_ZH.md` mirrors where applicable). Full slash-command list lives in `src/cli-commands.ts`; docs: `USAGE.md`, `ARCHITECTURE.md`, `CONTRIBUTING.md`, `CLAUDE_CODE_PATTERNS.md`.
- Stay aligned with Claude Code's design direction; one feature/fix per PR; check issues before starting medium+ features.
