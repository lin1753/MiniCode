# MiniCode 二次开发任务进度

> 项目：MiniCode（轻量级终端 AI 编码助手）
> 开发周期：2026.3 - 2026.7
> 开发目标：实现简历中描述的三大核心功能

---

## 总览

| # | 功能模块 | 简历描述 | 状态 | 完成日期 |
|---|---------|---------|------|---------|
| Feature 3 | 中心化多 Agent 协作 | 主 Agent 统一规划审批，子 Agent 以 Tool Call 受控执行 | ✅ 已完成 | 2026-07-27 |
| Feature 1 | Skill 分层路由系统 | 分层组织 + 二阶段召回精排 | ✅ 已完成 | 2026-07-27 |
| Feature 2 | 自进化记忆沉淀 | 执行-反思-提炼-分类存储闭环 | ✅ 已完成 | 2026-07-27 |

---

## Feature 3：中心化多 Agent 协作 ✅

### 需求来源
简历描述：「设计中心化多 Agent 协作架构，以主 Agent 统一规划、审批与质量控制，子 Agent 以 Tool Call 方式受控执行，避免引入复杂的 Agent 间协调与状态管理基础设施；通过不移交控制权、最小化结果传递、工具权限约束与路径边界限制保障安全。」

### 设计决策
1. **复用 runAgentTurn()**：子 Agent 不引入新执行引擎，直接复用现有的 agent-loop
2. **同步阻塞执行**：子 Agent 在主 Agent 的工具调用轮次内同步执行，结果作为 tool_result 返回
3. **递归防护**：受限 ToolRegistry 自动排除 `spawn_agent` 工具，子 Agent 不能创建孙 Agent
4. **预设 agent 类型**：4 种预设（code-reviewer / test-runner / researcher / coder），各有独立工具白名单和步数上限

### 新建文件
| 文件 | 职责 |
|------|------|
| `src/agent-pool.ts` | SubAgentConfig / SubAgentResult 类型、AGENT_TYPE_PRESETS 预设配置、validateSubAgentConfig 校验 |
| `src/tools/spawn-agent.ts` | createSpawnAgentTool 工厂函数，构建受限 ToolRegistry，调用 runAgentTurn 执行子 Agent |
| `test/spawn-agent.test.ts` | 13 个测试用例：配置校验、工具创建、子 Agent 执行、错误处理 |

### 修改文件
| 文件 | 改动 |
|------|------|
| `src/index.ts` | 导入 createSpawnAgentTool，model+permissions 创建后注册到 tools |
| `src/tty-app.ts` | 导入 createSpawnAgentTool，permissions.whenReady() 后注册到 tools |
| `src/prompt.ts` | system prompt 追加 Sub-agent delegation 说明（6 行） |

### 验证结果
- `tsc --noEmit`：零错误
- `npm test`：232/232 通过，0 失败
- 新增测试：validateSubAgentConfig（6 个）+ createSpawnAgentTool（7 个）

---

## Feature 1：Skill 分层路由系统 🔄

### 需求来源
简历描述：「设计 Skill 分层路由系统，将原子 Tool、高层 Skill 与 Skill 目录分层组织，结合任务意图识别、元信息标签、适用边界与示例进行二阶段召回与精排，解决 Skill 自进化增长下的检索噪声、功能重叠、召回空间过大与 Token 成本高问题。」

### 实现计划

#### Phase 1：核心路由引擎
- [x] 创建 `src/skill-router.ts`
  - SkillMetadata 类型（扩展 SkillSummary，增加 tags/triggers/boundaries/examples/priority）
  - parseFrontmatter() — 简单 YAML 子集解析器
  - firstStageRecall() — 按 trigger(+30)/tag(+20)/desc(+10)/name(+25) 召回 top-5
  - secondStageRanking() — 按 boundary(+15/-20)/priority(+5)/example(+10)/project优先(+2) 精排
  - simpleGlobMatch() — 最小 glob 匹配器（支持 * 和 **）
  - SkillRouter class — refreshIndex() + route()

#### Phase 2：route_skill 工具
- [x] 创建 `src/tools/route-skill.ts`
  - createRouteSkillTool 工厂函数
  - 输入：{ query: string }
  - 输出：排序后的候选 skill 列表（名称、分数、匹配原因、标签）

#### Phase 3：集成
- [x] 修改 `src/skills.ts`
  - SkillSummary 添加可选字段 tags?, triggers?, priority?
  - extractDescription() 增加 frontmatter 跳过逻辑
- [x] 修改 `src/tools/index.ts`
  - 创建 SkillRouter 实例，refreshIndex()，注册 route_skill 工具
- [x] 修改 `src/prompt.ts`
  - 追加路由使用指引

#### Phase 4：测试
- [x] 创建 `test/skill-router.test.ts`
  - frontmatter 解析测试
  - 第一阶段召回准确性
  - 第二阶段排序验证
  - 边界排除测试
  - 空输入处理

### 进度记录
| 时间 | 进展 |
|------|------|
| 2026-07-27 | Feature 1 启动，Phase 1 开始 |
| 2026-07-27 | ✅ 创建 `src/skill-router.ts` — 两阶段路由引擎（parseFrontmatter、firstStageRecall、secondStageRanking、simpleGlobMatch、SkillRouter class） |
| 2026-07-27 | ✅ 创建 `src/tools/route-skill.ts` — route_skill 工具（自动刷新索引、输出排序候选列表） |
| 2026-07-27 | ✅ 修改 `src/skills.ts` — SkillSummary 增加 tags/triggers/priority 可选字段，extractDescription 跳过 frontmatter |
| 2026-07-27 | ✅ 修改 `src/tools/index.ts` — 创建 SkillRouter 实例并注册 route_skill |
| 2026-07-27 | ✅ 修改 `src/prompt.ts` — system prompt 追加 Skill 路由使用指引 |
| 2026-07-27 | ✅ 创建 `test/skill-router.test.ts` — frontmatter 解析、glob 匹配、路由提取等 21 个测试用例 |
| 2026-07-27 | ✅ 验证通过：tsc --noEmit 零错误，npm test 253/253 通过 |

---

## Feature 2：自进化记忆沉淀 ⏳

### 需求来源
简历描述：「设计自进化记忆沉淀机制，将执行过程中的程序性经验、情景记忆、用户画像自动提炼为可复用记忆资产，构建"执行-反思-提炼-分类存储-索引更新-按需复用"的闭环，实现跨会话复用、错误修复加速、Skill 能力生长。」

### 实现计划（待启动）

> ✅ 已全部完成（2026-07-27）

#### Phase 1：类型与存储
- [x] 创建 `src/memory/types.ts` — MemoryType / MemoryEntry / ProceduralMemory / EpisodicMemory / UserProfileMemory
- [x] 创建 `src/memory/store.ts` — MemoryStore 类（load/save/add/search/incrementUsage/evict）

#### Phase 2：提取与检索
- [x] 创建 `src/memory/extractor.ts` — extractMemories() LLM 分析最近对话
- [x] 创建 `src/memory/retriever.ts` — retrieveRelevantMemories() + renderMemoriesForPrompt()

#### Phase 3：反思钩子与集成
- [x] 创建 `src/memory/reflection.ts` — postTurnReflection() 异步钩子
- [x] 修改 `src/prompt.ts` — buildSystemPrompt 增加 dynamicMemories 参数
- [x] 修改 `src/index.ts` + `src/tty-app.ts` — 集成 MemoryStore 初始化、检索、反思

#### Phase 4：测试
- [x] 创建 `test/memory-store.test.ts`
- [x] 创建 `test/memory-retriever.test.ts`
- [x] 创建 `test/memory-extractor.test.ts`

---

## 通用信息

### 开发环境
- TypeScript 5.9, Node.js 22, ESM (NodeNext)
- 测试框架：node:test + node:assert/strict
- 校验库：Zod v4
- 差异库：diff v8

### 代码规范
- 每个工具文件遵循 `ToolDefinition<TInput>` 接口：name + description + inputSchema + schema (Zod) + run()
- 工厂模式：`createXxxTool(deps): ToolDefinition<Input>`
- 新模块放在 src/ 对应子目录（tools/、memory/、compact/）
- 测试文件放在 test/ 目录，命名 `*.test.ts`
