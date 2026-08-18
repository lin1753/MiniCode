import { randomUUID } from 'node:crypto'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SubAgentConfig = {
  id: string
  task: string
  agentType: string
  context?: string
  maxSteps: number
  allowedTools: string[]
}

export type SubAgentResult = {
  id: string
  task: string
  agentType: string
  status: 'completed' | 'failed' | 'timeout'
  output: string
  stepsUsed: number
  duration: number
}

// ---------------------------------------------------------------------------
// Preset agent types
// ---------------------------------------------------------------------------

export type AgentTypePreset = {
  allowedTools: string[]
  maxSteps: number
}

export const AGENT_TYPE_PRESETS: Record<string, AgentTypePreset> = {
  'code-reviewer': {
    allowedTools: ['read_file', 'grep_files', 'list_files'],
    maxSteps: 8,
  },
  'test-runner': {
    allowedTools: ['read_file', 'run_command', 'grep_files', 'list_files'],
    maxSteps: 10,
  },
  researcher: {
    allowedTools: ['read_file', 'grep_files', 'list_files', 'web_fetch', 'web_search'],
    maxSteps: 10,
  },
  coder: {
    allowedTools: [
      'read_file',
      'write_file',
      'edit_file',
      'patch_file',
      'modify_file',
      'grep_files',
      'list_files',
      'run_command',
    ],
    maxSteps: 12,
  },
}

export const DEFAULT_AGENT_TYPE = 'coder'

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateSubAgentConfig(
  task: string,
  agentType: string,
): SubAgentConfig | null {
  const trimmedTask = task.trim()
  if (!trimmedTask) {
    return null
  }

  const preset = AGENT_TYPE_PRESETS[agentType] ?? AGENT_TYPE_PRESETS[DEFAULT_AGENT_TYPE]
  const resolvedType = AGENT_TYPE_PRESETS[agentType] ? agentType : DEFAULT_AGENT_TYPE

  return {
    id: randomUUID().slice(0, 8),
    task: trimmedTask,
    agentType: resolvedType,
    maxSteps: preset.maxSteps,
    allowedTools: [...preset.allowedTools],
  }
}
