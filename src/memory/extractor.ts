import type { ModelAdapter, ChatMessage } from '../types.js'
import type { ExtractionResult } from './types.js'

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const EXTRACTION_SYSTEM_PROMPT = [
  'You are a memory extraction assistant for a coding agent.',
  'Analyze the conversation and extract reusable memories.',
  'Return ONLY valid JSON, no markdown fences.',
  'If nothing noteworthy happened, return {"procedural":[],"episodic":[],"userProfile":[]}',
].join('\n')

const EXTRACTION_USER_PROMPT_TEMPLATE = `Analyze this conversation turn and extract reusable memories.

<conversation>
{conversation}
</conversation>

Extract into three categories:

1. **procedural** — "how to do X" patterns discovered during tool execution.
   Each entry: { "pattern": "short name", "steps": ["step1", ...], "content": "full description", "tags": ["relevant", "tags"] }

2. **episodic** — specific problem-solution pairs.
   Each entry: { "problem": "what went wrong", "solution": "how it was fixed", "context": "surroundings", "content": "full description", "tags": ["relevant", "tags"] }

3. **userProfile** — coding preferences, habits, toolchain choices.
   Each entry: { "category": "preference|habit|style|toolchain", "observation": "...", "content": "full description", "tags": ["relevant", "tags"] }

Rules:
- Only extract HIGH-CONFIDENCE memories from concrete events (not speculation).
- Each category should have 0-2 entries max.
- Tags should be 1-4 lowercase keywords.
- content should be a self-contained sentence.
- Return JSON: { "procedural": [...], "episodic": [...], "userProfile": [...] }`

// ---------------------------------------------------------------------------
// Message formatting
// ---------------------------------------------------------------------------

function formatMessagesForExtraction(messages: ChatMessage[]): string {
  const recent = messages.slice(-8)
  const parts: string[] = []

  for (const msg of recent) {
    switch (msg.role) {
      case 'user':
        parts.push(`User: ${msg.content}`)
        break
      case 'assistant':
        parts.push(`Assistant: ${msg.content}`)
        break
      case 'assistant_progress':
        parts.push(`Assistant (progress): ${msg.content}`)
        break
      case 'tool_result':
        parts.push(`Tool[${msg.toolName}]: ${msg.content.slice(0, 500)}`)
        break
      case 'assistant_tool_call':
        parts.push(`Tool Call: ${msg.toolName}(${JSON.stringify(msg.input).slice(0, 200)})`)
        break
      // Skip system, thinking, summary, boundary messages
    }
  }

  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// JSON parsing
// ---------------------------------------------------------------------------

function parseExtractionResult(content: string): ExtractionResult {
  const empty: ExtractionResult = {
    procedural: [],
    episodic: [],
    userProfile: [],
  }

  try {
    // Strip markdown code fences if present
    let text = content.trim()
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }

    const parsed = JSON.parse(text)

    if (typeof parsed !== 'object' || parsed === null) return empty

    return {
      procedural: Array.isArray(parsed.procedural)
        ? parsed.procedural.filter(validateProceduralEntry)
        : [],
      episodic: Array.isArray(parsed.episodic)
        ? parsed.episodic.filter(validateEpisodicEntry)
        : [],
      userProfile: Array.isArray(parsed.userProfile)
        ? parsed.userProfile.filter(validateUserProfileEntry)
        : [],
    }
  } catch {
    return empty
  }
}

function validateProceduralEntry(entry: unknown): boolean {
  if (typeof entry !== 'object' || entry === null) return false
  const e = entry as Record<string, unknown>
  return (
    typeof e.content === 'string' &&
    typeof e.pattern === 'string' &&
    Array.isArray(e.steps) &&
    Array.isArray(e.tags)
  )
}

function validateEpisodicEntry(entry: unknown): boolean {
  if (typeof entry !== 'object' || entry === null) return false
  const e = entry as Record<string, unknown>
  return (
    typeof e.content === 'string' &&
    typeof e.problem === 'string' &&
    typeof e.solution === 'string' &&
    typeof e.context === 'string' &&
    Array.isArray(e.tags)
  )
}

function validateUserProfileEntry(entry: unknown): boolean {
  if (typeof entry !== 'object' || entry === null) return false
  const e = entry as Record<string, unknown>
  return (
    typeof e.content === 'string' &&
    typeof e.observation === 'string' &&
    typeof e.category === 'string' &&
    ['preference', 'habit', 'style', 'toolchain'].includes(e.category as string) &&
    Array.isArray(e.tags)
  )
}

// ---------------------------------------------------------------------------
// Main extraction function
// ---------------------------------------------------------------------------

export async function extractMemories(args: {
  messages: ChatMessage[]
  model: ModelAdapter
}): Promise<ExtractionResult> {
  const empty: ExtractionResult = {
    procedural: [],
    episodic: [],
    userProfile: [],
  }

  // Need at least a user message and an assistant response
  const hasUser = args.messages.some(m => m.role === 'user')
  const hasAssistant = args.messages.some(
    m => m.role === 'assistant' || m.role === 'assistant_tool_call',
  )
  if (!hasUser || !hasAssistant) return empty

  const conversationText = formatMessagesForExtraction(args.messages)
  if (conversationText.length < 50) return empty

  const userPrompt = EXTRACTION_USER_PROMPT_TEMPLATE.replace(
    '{conversation}',
    conversationText,
  )

  const extractionMessages: ChatMessage[] = [
    { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ]

  try {
    const step = await args.model.next(extractionMessages)
    if (step.type === 'assistant' && step.content) {
      return parseExtractionResult(step.content)
    }
  } catch {
    // Extraction failure should never crash the main loop
  }

  return empty
}
