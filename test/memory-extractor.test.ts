import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { extractMemories } from '../src/memory/extractor.js'
import type { ModelAdapter, AgentStep, ChatMessage } from '../src/types.js'

// ---------------------------------------------------------------------------
// Mock model adapters
// ---------------------------------------------------------------------------

function mockModelReturning(json: string): ModelAdapter {
  return {
    async next(_messages: ChatMessage[]): Promise<AgentStep> {
      return {
        type: 'assistant',
        content: json,
        kind: 'final',
      }
    },
  }
}

function mockModelThrowing(): ModelAdapter {
  return {
    async next(): Promise<AgentStep> {
      throw new Error('Model unavailable')
    },
  }
}

function mockModelReturningGarbage(): ModelAdapter {
  return {
    async next(): Promise<AgentStep> {
      return {
        type: 'assistant',
        content: 'This is not JSON at all, just random text.',
        kind: 'final',
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessages(): ChatMessage[] {
  return [
    { role: 'user', content: 'Fix the TypeScript build error' },
    { role: 'assistant', content: 'I found the issue in tsconfig.json and fixed it.' },
  ]
}

// ---------------------------------------------------------------------------
// Tests: extractMemories
// ---------------------------------------------------------------------------

describe('extractMemories', () => {
  test('returns empty when no user messages', async () => {
    const result = await extractMemories({
      messages: [{ role: 'assistant', content: 'Hello' }],
      model: mockModelReturning('{}'),
    })
    assert.equal(result.procedural.length, 0)
    assert.equal(result.episodic.length, 0)
    assert.equal(result.userProfile.length, 0)
  })

  test('returns empty when no assistant messages', async () => {
    const result = await extractMemories({
      messages: [{ role: 'user', content: 'Hello' }],
      model: mockModelReturning('{}'),
    })
    assert.equal(result.procedural.length, 0)
  })

  test('parses valid JSON extraction result', async () => {
    const model = mockModelReturning(JSON.stringify({
      procedural: [
        {
          pattern: 'tsconfig fix',
          steps: ['Check tsconfig.json', 'Fix strict mode'],
          content: 'Fix TypeScript build by checking tsconfig strict mode',
          tags: ['typescript', 'build'],
        },
      ],
      episodic: [
        {
          problem: 'Build failed with ENOENT',
          solution: 'Added outDir to tsconfig',
          context: 'During npm run build',
          content: 'Build failed because outDir was missing in tsconfig.json',
          tags: ['build', 'tsconfig'],
        },
      ],
      userProfile: [
        {
          category: 'preference',
          observation: 'Prefers strict TypeScript',
          content: 'User prefers strict TypeScript configuration',
          tags: ['typescript', 'preferences'],
        },
      ],
    }))

    const result = await extractMemories({
      messages: makeMessages(),
      model,
    })

    assert.equal(result.procedural.length, 1)
    assert.equal(result.procedural[0].pattern, 'tsconfig fix')
    assert.equal(result.procedural[0].steps.length, 2)

    assert.equal(result.episodic.length, 1)
    assert.equal(result.episodic[0].problem, 'Build failed with ENOENT')
    assert.equal(result.episodic[0].solution, 'Added outDir to tsconfig')

    assert.equal(result.userProfile.length, 1)
    assert.equal(result.userProfile[0].category, 'preference')
  })

  test('handles markdown-wrapped JSON', async () => {
    const model = mockModelReturning('```json\n{"procedural":[],"episodic":[],"userProfile":[]}\n```')
    const result = await extractMemories({ messages: makeMessages(), model })
    assert.equal(result.procedural.length, 0)
    assert.equal(result.episodic.length, 0)
    assert.equal(result.userProfile.length, 0)
  })

  test('returns empty on invalid JSON', async () => {
    const result = await extractMemories({
      messages: makeMessages(),
      model: mockModelReturningGarbage(),
    })
    assert.equal(result.procedural.length, 0)
    assert.equal(result.episodic.length, 0)
    assert.equal(result.userProfile.length, 0)
  })

  test('returns empty on model error', async () => {
    const result = await extractMemories({
      messages: makeMessages(),
      model: mockModelThrowing(),
    })
    assert.equal(result.procedural.length, 0)
  })

  test('filters entries with missing required fields', async () => {
    const model = mockModelReturning(JSON.stringify({
      procedural: [
        { pattern: 'valid', steps: ['a'], content: 'Valid entry', tags: ['ok'] },
        { content: 'Missing pattern and steps', tags: ['bad'] }, // invalid
        { pattern: 'no-content', steps: [], tags: [] }, // missing content
      ],
      episodic: [],
      userProfile: [],
    }))

    const result = await extractMemories({ messages: makeMessages(), model })
    assert.equal(result.procedural.length, 1)
    assert.equal(result.procedural[0].pattern, 'valid')
  })

  test('filters userProfile entries with invalid category', async () => {
    const model = mockModelReturning(JSON.stringify({
      procedural: [],
      episodic: [],
      userProfile: [
        { category: 'preference', observation: 'Good', content: 'OK', tags: [] },
        { category: 'invalid_category', observation: 'Bad', content: 'Bad', tags: [] },
      ],
    }))

    const result = await extractMemories({ messages: makeMessages(), model })
    assert.equal(result.userProfile.length, 1)
    assert.equal(result.userProfile[0].category, 'preference')
  })

  test('returns empty for very short conversations', async () => {
    const result = await extractMemories({
      messages: [{ role: 'user', content: 'hi' }],
      model: mockModelReturning('{}'),
    })
    assert.equal(result.procedural.length, 0)
  })
})
