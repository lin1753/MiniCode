import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../src/memory/store.js'
import type { MemoryEntry } from '../src/memory/types.js'

function makeEntry(overrides: Partial<MemoryEntry> = {}): Omit<MemoryEntry, 'id' | 'createdAt' | 'usageCount'> {
  return {
    type: 'procedural',
    content: 'When build fails, check tsconfig.json strict mode',
    tags: ['typescript', 'build', 'tsconfig'],
    sourceSessionId: 'test-session',
    sourceTimestamp: new Date().toISOString(),
    confidence: 'medium',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests: MemoryStore
// ---------------------------------------------------------------------------

describe('MemoryStore', () => {
  test('starts empty with no entries', () => {
    const store = new MemoryStore()
    assert.equal(store.getCount(), 0)
    assert.deepEqual(store.getAll(), [])
  })

  test('add creates entry with id, timestamp, and usageCount=0', () => {
    const store = new MemoryStore()
    const entry = store.add(makeEntry())
    assert.ok(typeof entry.id === 'string')
    assert.ok(entry.id.length === 8)
    assert.ok(typeof entry.createdAt === 'string')
    assert.equal(entry.usageCount, 0)
    assert.equal(entry.type, 'procedural')
    assert.equal(entry.content, 'When build fails, check tsconfig.json strict mode')
  })

  test('add increments count', () => {
    const store = new MemoryStore()
    store.add(makeEntry())
    store.add(makeEntry({ type: 'episodic', content: 'Different entry' }))
    assert.equal(store.getCount(), 2)
  })

  test('search matches by tag keyword', () => {
    const store = new MemoryStore()
    store.add(makeEntry({ tags: ['typescript', 'build'] }))
    store.add(makeEntry({ type: 'episodic', content: 'Unrelated', tags: ['python'] }))

    const results = store.search('typescript build')
    assert.equal(results.length, 1)
    assert.deepEqual(results[0].tags, ['typescript', 'build'])
  })

  test('search matches by content keyword', () => {
    const store = new MemoryStore()
    store.add(makeEntry({ content: 'Vitest is faster than Jest for this project', tags: [] }))
    store.add(makeEntry({ content: 'Python uses pytest', tags: [] }))

    const results = store.search('vitest testing')
    assert.ok(results.length >= 1)
    assert.ok(results[0].content.includes('Vitest'))
  })

  test('search filters by type', () => {
    const store = new MemoryStore()
    store.add(makeEntry({ tags: ['test'] }))
    store.add(makeEntry({ type: 'episodic', content: 'ep', tags: ['test'] }))

    const results = store.search('test', 'episodic')
    assert.equal(results.length, 1)
    assert.equal(results[0].type, 'episodic')
  })

  test('search returns empty for no match', () => {
    const store = new MemoryStore()
    store.add(makeEntry({ tags: ['typescript'] }))

    const results = store.search('python django')
    assert.equal(results.length, 0)
  })

  test('search respects limit', () => {
    const store = new MemoryStore()
    for (let i = 0; i < 20; i++) {
      store.add(makeEntry({ content: `Memory ${i}`, tags: ['common'] }))
    }
    const results = store.search('common', undefined, 5)
    assert.equal(results.length, 5)
  })

  test('incrementUsage updates usageCount and lastUsedAt', () => {
    const store = new MemoryStore()
    const entry = store.add(makeEntry())
    assert.equal(entry.usageCount, 0)

    store.incrementUsage(entry.id)
    const updated = store.getAll().find(e => e.id === entry.id)!
    assert.equal(updated.usageCount, 1)
    assert.ok(typeof updated.lastUsedAt === 'string')
  })

  test('evict removes oldest low-usage entries when exceeding limit', () => {
    const store = new MemoryStore()
    // Add 210 procedural memories (limit is 200)
    for (let i = 0; i < 210; i++) {
      store.add(makeEntry({ content: `Memory ${i}` }))
    }
    // All are low usage, so evict should remove the oldest 10
    store.evict()
    const procedural = store.getAll().filter(e => e.type === 'procedural')
    assert.ok(procedural.length <= 200)
  })

  test('high-usage entries survive eviction', () => {
    const store = new MemoryStore()
    // Add 200 low-usage entries
    for (let i = 0; i < 200; i++) {
      store.add(makeEntry({ content: `Low ${i}` }))
    }
    // Add 10 high-usage entries
    for (let i = 0; i < 10; i++) {
      const entry = store.add(makeEntry({ content: `High ${i}` }))
      // Simulate high usage
      for (let j = 0; j < 20; j++) {
        store.incrementUsage(entry.id)
      }
    }
    store.evict()
    const all = store.getAll()
    const highUsage = all.filter(e => e.content.startsWith('High'))
    assert.equal(highUsage.length, 10, 'High-usage entries should survive')
  })

  test('search ranks higher-usage entries first', () => {
    const store = new MemoryStore()
    const low = store.add(makeEntry({ content: 'TypeScript tip', tags: ['typescript'] }))
    const high = store.add(makeEntry({ content: 'TypeScript pattern', tags: ['typescript'] }))

    // Boost high usage
    for (let i = 0; i < 10; i++) store.incrementUsage(high.id)

    const results = store.search('typescript')
    assert.equal(results.length, 2)
    assert.equal(results[0].id, high.id)
  })

  test('save and load round-trips entries', async () => {
    const store = new MemoryStore()
    store.add(makeEntry({ content: 'Test memory 1', tags: ['test'] }))
    store.add(makeEntry({ type: 'episodic', content: 'Test memory 2', tags: ['test'] }))
    await store.save('procedural')
    await store.save('episodic')

    const store2 = new MemoryStore()
    await store2.load()
    assert.equal(store2.getCount(), 2)

    // Clean up to avoid affecting other tests
    const { rm } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const home = process.env.MINI_CODE_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.mini-code')
    await rm(join(home, 'memories'), { recursive: true, force: true }).catch(() => {})
  })

  test('load handles missing files gracefully', async () => {
    // Ensure no files exist
    const { rm } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const home = process.env.MINI_CODE_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.mini-code')
    await rm(join(home, 'memories'), { recursive: true, force: true }).catch(() => {})

    const store = new MemoryStore()
    // Should not throw even if no memory files exist
    await store.load()
    assert.equal(store.getCount(), 0)
  })
})
