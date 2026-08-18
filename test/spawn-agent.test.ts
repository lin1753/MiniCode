import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import type { ModelAdapter, AgentStep, ChatMessage } from '../src/types.js'
import { ToolRegistry } from '../src/tool.js'
import type { ToolDefinition } from '../src/tool.js'
import {
  validateSubAgentConfig,
  AGENT_TYPE_PRESETS,
  DEFAULT_AGENT_TYPE,
} from '../src/agent-pool.js'
import { createSpawnAgentTool } from '../src/tools/spawn-agent.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockModelAdapter(response?: string): ModelAdapter {
  return {
    async next(messages: ChatMessage[]): Promise<AgentStep> {
      // Return the provided response or a default
      const content = response ?? 'Sub-agent task completed successfully.'
      return {
        type: 'assistant',
        content,
        kind: 'final',
      }
    },
  }
}

function mockToolRegistry(toolNames: string[]): ToolRegistry {
  const tools: ToolDefinition<unknown>[] = toolNames.map(name => ({
    name,
    description: `Mock tool: ${name}`,
    inputSchema: { type: 'object', properties: {} },
    schema: { safeParse: () => ({ success: true, data: {} }) } as never,
    async run() {
      return { ok: true, output: `mock output from ${name}` }
    },
  }))
  return new ToolRegistry(tools)
}

function mockPermissionManager() {
  return {
    getSummary: () => [],
    beginTurn() {},
    endTurn() {},
    ensurePathAccess: async () => {},
    ensureCommand: async () => {},
    ensureEdit: async () => {},
  } as never
}

// ---------------------------------------------------------------------------
// Tests: validateSubAgentConfig
// ---------------------------------------------------------------------------

describe('validateSubAgentConfig', () => {
  test('returns null for empty task', () => {
    const result = validateSubAgentConfig('', 'coder')
    assert.equal(result, null)
  })

  test('returns null for whitespace-only task', () => {
    const result = validateSubAgentConfig('   ', 'coder')
    assert.equal(result, null)
  })

  test('creates config for known agent type', () => {
    const result = validateSubAgentConfig('review the auth code', 'code-reviewer')
    assert.ok(result !== null)
    assert.equal(result!.task, 'review the auth code')
    assert.equal(result!.agentType, 'code-reviewer')
    assert.equal(result!.maxSteps, AGENT_TYPE_PRESETS['code-reviewer'].maxSteps)
    assert.deepEqual(result!.allowedTools, AGENT_TYPE_PRESETS['code-reviewer'].allowedTools)
    assert.equal(result!.id.length, 8)
  })

  test('falls back to coder for unknown agent type', () => {
    const result = validateSubAgentConfig('do something', 'unknown-type')
    assert.ok(result !== null)
    assert.equal(result!.agentType, DEFAULT_AGENT_TYPE)
    assert.deepEqual(result!.allowedTools, AGENT_TYPE_PRESETS[DEFAULT_AGENT_TYPE].allowedTools)
  })

  test('preserves task whitespace trimming', () => {
    const result = validateSubAgentConfig('  fix the bug  ', 'test-runner')
    assert.ok(result !== null)
    assert.equal(result!.task, 'fix the bug')
  })

  test('all preset agent types have valid configs', () => {
    for (const [type, preset] of Object.entries(AGENT_TYPE_PRESETS)) {
      const result = validateSubAgentConfig(`test task for ${type}`, type)
      assert.ok(result !== null, `Preset "${type}" should produce a valid config`)
      assert.equal(result!.agentType, type)
      assert.equal(result!.maxSteps, preset.maxSteps)
      assert.ok(result!.allowedTools.length > 0, `Preset "${type}" should have tools`)
    }
  })
})

// ---------------------------------------------------------------------------
// Tests: createSpawnAgentTool
// ---------------------------------------------------------------------------

describe('createSpawnAgentTool', () => {
  const cwd = process.cwd()
  const model = mockModelAdapter()
  const parentTools = mockToolRegistry([
    'read_file', 'write_file', 'edit_file', 'grep_files',
    'list_files', 'run_command', 'spawn_agent', 'ask_user',
  ])
  const permissions = mockPermissionManager()

  function createTool() {
    return createSpawnAgentTool({
      cwd,
      tools: parentTools,
      model,
      permissions,
      modelName: 'mock-model',
    })
  }

  test('tool has correct name and description', () => {
    const tool = createTool()
    assert.equal(tool.name, 'spawn_agent')
    assert.ok(tool.description.length > 0)
  })

  test('input schema requires task field', () => {
    const tool = createTool()
    assert.ok(tool.inputSchema.required?.includes('task'))
  })

  test('returns error for empty task', async () => {
    const tool = createTool()
    const result = await tool.run({ task: '', agent_type: 'coder' }, { cwd })
    assert.equal(result.ok, false)
    assert.ok(result.output.includes('empty'))
  })

  test('spawns sub-agent with restricted tools', async () => {
    // Use a model that tracks what tools the sub-agent sees
    let receivedToolNames: string[] = []
    const trackingModel: ModelAdapter = {
      async next(messages: ChatMessage[]): Promise<AgentStep> {
        // Extract tool names from the system prompt to verify restriction
        const systemMsg = messages.find(m => m.role === 'system')
        if (systemMsg && 'content' in systemMsg) {
          receivedToolNames = ['system-prompt-received']
        }
        return {
          type: 'assistant',
          content: 'Code review complete. No issues found.',
          kind: 'final',
        }
      },
    }

    const tool = createSpawnAgentTool({
      cwd,
      tools: parentTools,
      model: trackingModel,
      permissions,
      modelName: 'mock-model',
    })

    const result = await tool.run(
      { task: 'Review the authentication module', agent_type: 'code-reviewer' },
      { cwd },
    )

    assert.equal(result.ok, true)
    assert.ok(result.output.includes('[Sub-Agent Result: code-reviewer]'))
    assert.ok(result.output.includes('Review the authentication module'))
    assert.ok(result.output.includes('Code review complete'))
    assert.deepEqual(receivedToolNames, ['system-prompt-received'])
  })

  test('sub-agent result includes metadata', async () => {
    const tool = createTool()
    const result = await tool.run(
      { task: 'Run all unit tests', agent_type: 'test-runner' },
      { cwd },
    )

    assert.equal(result.ok, true)
    assert.ok(result.output.includes('Steps used:'))
    assert.ok(result.output.includes('Duration:'))
    assert.ok(result.output.includes('[Sub-Agent Result: test-runner]'))
  })

  test('handles model errors gracefully', async () => {
    const failingModel: ModelAdapter = {
      async next(): Promise<AgentStep> {
        throw new Error('API rate limit exceeded')
      },
    }

    const tool = createSpawnAgentTool({
      cwd,
      tools: parentTools,
      model: failingModel,
      permissions,
      modelName: 'mock-model',
    })

    const result = await tool.run(
      { task: 'Research the codebase', agent_type: 'researcher' },
      { cwd },
    )

    assert.equal(result.ok, false)
    assert.ok(result.output.includes('[Sub-Agent Failed: researcher]'))
    assert.ok(result.output.includes('API rate limit exceeded'))
  })

  test('default agent_type is coder', async () => {
    const tool = createTool()
    const result = await tool.run(
      { task: 'Fix the bug', agent_type: 'coder' },
      { cwd },
    )

    assert.equal(result.ok, true)
    assert.ok(result.output.includes('[Sub-Agent Result: coder]'))
  })
})
