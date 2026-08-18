import { z } from 'zod'
import type { ToolDefinition } from '../tool.js'
import { ToolRegistry } from '../tool.js'
import type { ToolContext } from '../tool.js'
import type { ModelAdapter } from '../types.js'
import type { PermissionManager } from '../permissions.js'
import { runAgentTurn } from '../agent-loop.js'
import {
  validateSubAgentConfig,
  type SubAgentConfig,
} from '../agent-pool.js'

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

type Input = {
  task: string
  agent_type: string
  context?: string
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export type SpawnAgentDeps = {
  cwd: string
  tools: ToolRegistry
  model: ModelAdapter
  permissions: PermissionManager
  modelName: string
}

export function createSpawnAgentTool(deps: SpawnAgentDeps): ToolDefinition<Input> {
  return {
    name: 'spawn_agent',
    description:
      'Spawn a sub-agent to perform a focused task independently. ' +
      'The sub-agent runs with a limited set of tools and returns its result as text. ' +
      'Use for: code review, parallel research, test execution, independent sub-tasks. ' +
      'Do NOT use for tasks that require the full conversation context.',
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'The task description for the sub-agent to execute.',
        },
        agent_type: {
          type: 'string',
          description:
            'The type of sub-agent: "code-reviewer" (read-only review), ' +
            '"test-runner" (run tests), "researcher" (search/read/web), ' +
            '"coder" (read/write/edit code). Defaults to "coder".',
        },
        context: {
          type: 'string',
          description:
            'Optional extra context to include in the sub-agent prompt (e.g. file paths, constraints).',
        },
      },
      required: ['task'],
    },
    schema: z.object({
      task: z.string().min(1),
      agent_type: z.string().min(1).default('coder'),
      context: z.string().optional(),
    }),
    async run(input: Input, _context: ToolContext) {
      // ---- 1. Validate config ----
      const config = validateSubAgentConfig(input.task, input.agent_type)
      if (!config) {
        return {
          ok: false,
          output: 'spawn_agent: task must not be empty.',
        }
      }

      // ---- 2. Build restricted tool registry ----
      const restrictedTools = buildRestrictedRegistry(deps.tools, config)

      // ---- 3. Build sub-agent system prompt ----
      const allowedList = config.allowedTools.join(', ')
      const systemParts = [
        `You are a ${config.agentType} sub-agent.`,
        `Task: ${config.task}`,
        config.context ? `Additional context: ${config.context}` : null,
        `You have access to these tools: ${allowedList}`,
        'Complete the task step by step. Report your final result clearly.',
        'Do not attempt to spawn more agents.',
      ].filter(Boolean)

      const subMessages: Awaited<ReturnType<typeof runAgentTurn>> extends never
        ? never
        : Parameters<typeof runAgentTurn>[0]['messages'] = [
          { role: 'system', content: systemParts.join('\n\n') },
        ]

      // ---- 4. Run the sub-agent loop ----
      const startTime = Date.now()
      let stepsUsed = 0

      try {
        const resultMessages = await runAgentTurn({
          model: deps.model,
          tools: restrictedTools,
          messages: subMessages,
          cwd: deps.cwd,
          permissions: deps.permissions,
          maxSteps: config.maxSteps,
          modelName: deps.modelName,
          onToolStart() {
            stepsUsed++
          },
        })

        // Extract the last assistant message as the result
        const lastAssistant = [...resultMessages]
          .reverse()
          .find(m => m.role === 'assistant')

        const output =
          lastAssistant && 'content' in lastAssistant
            ? lastAssistant.content
            : 'Sub-agent completed with no output.'

        return {
          ok: true,
          output: [
            `[Sub-Agent Result: ${config.agentType}]`,
            `Task: ${config.task}`,
            `Steps used: ${stepsUsed}`,
            `Duration: ${Date.now() - startTime}ms`,
            '',
            output,
          ].join('\n'),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          ok: false,
          output: [
            `[Sub-Agent Failed: ${config.agentType}]`,
            `Task: ${config.task}`,
            `Error: ${message}`,
          ].join('\n'),
        }
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildRestrictedRegistry(
  parentTools: ToolRegistry,
  config: SubAgentConfig,
): ToolRegistry {
  const allowedSet = new Set(config.allowedTools)

  const filtered = parentTools
    .list()
    .filter(
      tool =>
        allowedSet.has(tool.name) && tool.name !== 'spawn_agent',
    )

  return new ToolRegistry(filtered)
}
