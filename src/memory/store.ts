import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { isEnoentError } from '../utils/errors.js'
import type {
  MemoryEntry,
  MemoryType,
  ProceduralMemory,
  EpisodicMemory,
  UserProfileMemory,
} from './types.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MEMORY_DIR_NAME = 'memories'
const MAX_MEMORIES_PER_TYPE = 200
const MAX_TOTAL_CHARS_BUDGET = 16_000

const FILE_NAMES: Record<MemoryType, string> = {
  procedural: 'procedural.json',
  episodic: 'episodic.json',
  user_profile: 'user-profile.json',
}

const INDEX_FILE = 'index.json'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function homeDir(): string {
  return process.env.MINI_CODE_HOME ?? (
    process.platform === 'win32'
      ? path.join(process.env.USERPROFILE ?? '', '.mini-code')
      : path.join(process.env.HOME ?? '', '.mini-code')
  )
}

function memoryDir(): string {
  return path.join(homeDir(), MEMORY_DIR_NAME)
}

function memoryFilePath(type: MemoryType): string {
  return path.join(memoryDir(), FILE_NAMES[type])
}

function indexPath(): string {
  return path.join(memoryDir(), INDEX_FILE)
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, ' ')
    .split(' ')
    .filter(t => t.length > 1)
}

// ---------------------------------------------------------------------------
// MemoryStore
// ---------------------------------------------------------------------------

export class MemoryStore {
  private entries = new Map<string, MemoryEntry>()
  private tagIndex = new Map<string, Set<string>>()

  async load(): Promise<void> {
    this.entries.clear()
    this.tagIndex.clear()

    for (const type of ['procedural', 'episodic', 'user_profile'] as MemoryType[]) {
      try {
        const raw = await readFile(memoryFilePath(type), 'utf8')
        const items: MemoryEntry[] = JSON.parse(raw)
        for (const item of items) {
          this.entries.set(item.id, item)
          this.rebuildTagIndexForEntry(item)
        }
      } catch (error) {
        if (!isEnoentError(error)) {
          // Corrupted file — start fresh for this type
          console.error(`Failed to load ${type} memories:`, error)
        }
      }
    }
  }

  async save(type: MemoryType): Promise<void> {
    const dir = memoryDir()
    await mkdir(dir, { recursive: true })

    const items = [...this.entries.values()].filter(e => e.type === type)
    await writeFile(memoryFilePath(type), JSON.stringify(items, null, 2), 'utf8')
    await this.saveIndex()
  }

  private async saveIndex(): Promise<void> {
    const index: Record<string, string[]> = {}
    for (const [tag, ids] of this.tagIndex) {
      index[tag] = [...ids]
    }
    await writeFile(indexPath(), JSON.stringify(index, null, 2), 'utf8')
  }

  add(
    entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'usageCount'>,
  ): MemoryEntry {
    const full: MemoryEntry = {
      ...entry,
      id: randomUUID().slice(0, 8),
      createdAt: new Date().toISOString(),
      usageCount: 0,
    }
    this.entries.set(full.id, full)
    this.rebuildTagIndexForEntry(full)
    this.evict()
    return full
  }

  search(query: string, type?: MemoryType, limit = 10): MemoryEntry[] {
    const queryTokens = tokenize(query)
    const candidates: Array<{ entry: MemoryEntry; score: number }> = []

    for (const entry of this.entries) {
      const [, memory] = entry
      if (type && memory.type !== type) continue

      let score = 0

      // Tag overlap scoring
      for (const tag of memory.tags) {
        const tagTokens = tokenize(tag)
        const overlap = queryTokens.filter(t => tagTokens.includes(t)).length
        if (overlap > 0) {
          score += (overlap / Math.max(tagTokens.length, 1)) * 30
        }
      }

      // Content keyword overlap
      const contentTokens = tokenize(memory.content)
      const contentOverlap = queryTokens.filter(t =>
        contentTokens.includes(t),
      ).length
      if (contentOverlap > 0) {
        score += (contentOverlap / Math.max(queryTokens.length, 1)) * 20
      }

      // Usage bonus (frequently used memories are more relevant)
      score += Math.min(memory.usageCount, 10) * 2

      if (score > 0) {
        candidates.push({ entry: memory, score })
      }
    }

    return candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(c => c.entry)
  }

  incrementUsage(id: string): void {
    const entry = this.entries.get(id)
    if (entry) {
      entry.usageCount++
      entry.lastUsedAt = new Date().toISOString()
    }
  }

  evict(): void {
    for (const type of ['procedural', 'episodic', 'user_profile'] as MemoryType[]) {
      const items = [...this.entries.values()]
        .filter(e => e.type === type)
        .sort((a, b) => {
          // Lower usage = evict first
          if (a.usageCount !== b.usageCount) return a.usageCount - b.usageCount
          // Older = evict first
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        })

      if (items.length > MAX_MEMORIES_PER_TYPE) {
        const toRemove = items.slice(0, items.length - MAX_MEMORIES_PER_TYPE)
        for (const entry of toRemove) {
          this.entries.delete(entry.id)
          this.removeFromTagIndex(entry)
        }
      }
    }

    // Enforce total character budget
    let totalChars = 0
    const allByAge = [...this.entries.values()].sort(
      (a, b) => a.usageCount - b.usageCount || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )
    for (const entry of allByAge) {
      totalChars += entry.content.length
    }
    while (totalChars > MAX_TOTAL_CHARS_BUDGET && allByAge.length > 0) {
      const oldest = allByAge.shift()!
      totalChars -= oldest.content.length
      this.entries.delete(oldest.id)
      this.removeFromTagIndex(oldest)
    }
  }

  getAll(): MemoryEntry[] {
    return [...this.entries.values()]
  }

  getCount(): number {
    return this.entries.size
  }

  // --- Tag index helpers ---

  private rebuildTagIndexForEntry(entry: MemoryEntry): void {
    for (const tag of entry.tags) {
      const set = this.tagIndex.get(tag) ?? new Set()
      set.add(entry.id)
      this.tagIndex.set(tag, set)
    }
  }

  private removeFromTagIndex(entry: MemoryEntry): void {
    for (const tag of entry.tags) {
      const set = this.tagIndex.get(tag)
      if (set) {
        set.delete(entry.id)
        if (set.size === 0) this.tagIndex.delete(tag)
      }
    }
  }
}
