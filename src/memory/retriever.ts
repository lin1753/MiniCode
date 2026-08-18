import type { MemoryEntry } from './types.js'
import { MemoryStore } from './store.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_INJECTED_CHARS = 4_000
const MAX_INJECTED_MEMORIES = 5
const TYPE_LIMITS: Record<string, number> = {
  procedural: 2,
  episodic: 2,
  user_profile: 1,
}

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

export function retrieveRelevantMemories(args: {
  query: string
  store: MemoryStore
  maxMemories?: number
}): MemoryEntry[] {
  const { query, store, maxMemories = MAX_INJECTED_MEMORIES } = args
  const results = store.search(query, undefined, maxMemories * 3)

  if (results.length === 0) return []

  // Group by type and apply per-type limits
  const byType: Record<string, MemoryEntry[]> = {
    procedural: [],
    episodic: [],
    user_profile: [],
  }

  for (const entry of results) {
    const bucket = byType[entry.type]
    if (bucket) bucket.push(entry)
  }

  const selected: MemoryEntry[] = []

  for (const type of ['procedural', 'episodic', 'user_profile'] as const) {
    const limit = TYPE_LIMITS[type] ?? 2
    const bucket = byType[type] ?? []
    for (let i = 0; i < Math.min(limit, bucket.length); i++) {
      if (selected.length >= maxMemories) break
      selected.push(bucket[i])
    }
  }

  // Track usage for all selected memories
  for (const entry of selected) {
    store.incrementUsage(entry.id)
  }

  return selected
}

// ---------------------------------------------------------------------------
// Prompt rendering
// ---------------------------------------------------------------------------

export function renderMemoriesForPrompt(memories: MemoryEntry[]): string {
  if (memories.length === 0) return ''

  const sections: string[] = ['# Learned Memories']
  let totalChars = sections[0].length

  for (const memory of memories) {
    const typeLabel =
      memory.type === 'procedural' ? 'Pattern' :
      memory.type === 'episodic' ? 'Experience' :
      'User Preference'

    const section = [
      `## ${typeLabel}: ${memory.content.slice(0, 100)}`,
      `Tags: ${memory.tags.join(', ')}`,
      memory.content,
    ].join('\n')

    // Check budget (with separator)
    const added = section.length + 2
    if (totalChars + added > MAX_INJECTED_CHARS) break

    sections.push(section)
    totalChars += added
  }

  // Only return if we actually added memory sections
  if (sections.length <= 1) return ''

  return sections.join('\n\n')
}
