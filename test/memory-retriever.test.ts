import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../src/memory/store.js'
import { retrieveRelevantMemories, renderMemoriesForPrompt } from '../src/memory/retriever.js'
import type { MemoryEntry } from '../src/memory/types.js'

function addEntry(
  store: MemoryStore,
  overrides: Partial<MemoryEntry> = {},
): MemoryEntry {
  return store.add({
    type: 'procedural',
    content: 'Default test memory',
    tags: ['test'],
    sourceSessionId: 'test-session',
    sourceTimestamp: new Date().toISOString(),
    confidence: 'medium',
    ...overrides,
  })
}

// ---------------------------------------------------------------------------
// Tests: retrieveRelevantMemories
// ---------------------------------------------------------------------------

describe('retrieveRelevantMemories', () => {
  test('returns empty for empty store', () => {
    const store = new MemoryStore()
    const results = retrieveRelevantMemories({ query: 'anything', store })
    assert.deepEqual(results, [])
  })

  test('retrieves by keyword match', () => {
    const store = new MemoryStore()
    addEntry(store, { content: 'TypeScript strict mode fixes type errors', tags: ['typescript'] })
    addEntry(store, { content: 'Python uses pytest for testing', tags: ['python'] })

    const results = retrieveRelevantMemories({ query: 'typescript build', store })
    assert.ok(results.length >= 1)
    assert.ok(results[0].content.includes('TypeScript'))
  })

  test('limits by type distribution (max 2 procedural)', () => {
    const store = new MemoryStore()
    for (let i = 0; i < 10; i++) {
      addEntry(store, { content: `Procedural ${i}`, tags: ['common'] })
    }

    const results = retrieveRelevantMemories({
      query: 'common',
      store,
      maxMemories: 5,
    })
    const procedural = results.filter(e => e.type === 'procedural')
    assert.ok(procedural.length <= 2)
  })

  test('mixes types in results', () => {
    const store = new MemoryStore()
    addEntry(store, { content: 'TS pattern', tags: ['ts'], type: 'procedural' })
    addEntry(store, { content: 'TS experience', tags: ['ts'], type: 'episodic' })
    addEntry(store, { content: 'TS preference', tags: ['ts'], type: 'user_profile' })

    const results = retrieveRelevantMemories({ query: 'ts', store })
    const types = new Set(results.map(e => e.type))
    assert.ok(types.size >= 2, 'Should include multiple types')
  })

  test('increments usage for retrieved entries', () => {
    const store = new MemoryStore()
    const entry = addEntry(store, { tags: ['searchable'] })

    retrieveRelevantMemories({ query: 'searchable', store })
    const updated = store.getAll().find(e => e.id === entry.id)!
    assert.ok(updated.usageCount > 0)
  })
})

// ---------------------------------------------------------------------------
// Tests: renderMemoriesForPrompt
// ---------------------------------------------------------------------------

describe('renderMemoriesForPrompt', () => {
  test('returns empty string for no memories', () => {
    const result = renderMemoriesForPrompt([])
    assert.equal(result, '')
  })

  test('renders memories as markdown sections', () => {
    const memories: MemoryEntry[] = [
      {
        id: '1',
        type: 'procedural',
        content: 'Check tsconfig.json strict mode first',
        tags: ['typescript', 'tsconfig'],
        sourceSessionId: 's1',
        sourceTimestamp: new Date().toISOString(),
        usageCount: 3,
        createdAt: new Date().toISOString(),
        confidence: 'medium',
      },
    ]

    const result = renderMemoriesForPrompt(memories)
    assert.ok(result.includes('# Learned Memories'))
    assert.ok(result.includes('## Pattern:'))
    assert.ok(result.includes('Check tsconfig.json strict mode first'))
    assert.ok(result.includes('Tags: typescript, tsconfig'))
  })

  test('respects character budget', () => {
    const memories: MemoryEntry[] = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      type: 'procedural' as const,
      content: 'A'.repeat(500),
      tags: ['test'],
      sourceSessionId: 's1',
      sourceTimestamp: new Date().toISOString(),
      usageCount: 0,
      createdAt: new Date().toISOString(),
      confidence: 'medium' as const,
    }))

    const result = renderMemoriesForPrompt(memories)
    // Budget is 4000 chars — should not render all 20 entries
    assert.ok(result.length < 4500, `Result should respect budget, got ${result.length}`)
    assert.ok(result.includes('# Learned Memories'))
  })

  test('renders different type labels', () => {
    const memories: MemoryEntry[] = [
      {
        id: '1',
        type: 'procedural',
        content: 'Pattern A',
        tags: [],
        sourceSessionId: 's1',
        sourceTimestamp: new Date().toISOString(),
        usageCount: 0,
        createdAt: new Date().toISOString(),
        confidence: 'medium',
      },
      {
        id: '2',
        type: 'episodic',
        content: 'Experience B',
        tags: [],
        sourceSessionId: 's1',
        sourceTimestamp: new Date().toISOString(),
        usageCount: 0,
        createdAt: new Date().toISOString(),
        confidence: 'medium',
      },
      {
        id: '3',
        type: 'user_profile',
        content: 'Preference C',
        tags: [],
        sourceSessionId: 's1',
        sourceTimestamp: new Date().toISOString(),
        usageCount: 0,
        createdAt: new Date().toISOString(),
        confidence: 'medium',
      },
    ]

    const result = renderMemoriesForPrompt(memories)
    assert.ok(result.includes('## Pattern:'))
    assert.ok(result.includes('## Experience:'))
    assert.ok(result.includes('## User Preference:'))
  })
})
