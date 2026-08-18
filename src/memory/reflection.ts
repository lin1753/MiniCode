import type { ModelAdapter, ChatMessage } from '../types.js'
import type { MemoryStore } from './store.js'
import { extractMemories } from './extractor.js'

// ---------------------------------------------------------------------------
// Post-turn reflection hook
// ---------------------------------------------------------------------------

/**
 * After each agent turn completes, analyze the conversation to extract
 * reusable memories. This runs asynchronously — errors are silently swallowed
 * so the main loop is never affected.
 *
 * Returns the number of memories added (0 on failure).
 */
export async function postTurnReflection(args: {
  messages: ChatMessage[]
  model: ModelAdapter
  store: MemoryStore
  sessionId: string
}): Promise<number> {
  try {
    const extraction = await extractMemories({
      messages: args.messages,
      model: args.model,
    })

    const now = new Date().toISOString()
    let addedCount = 0

    // Add procedural memories
    for (const proc of extraction.procedural) {
      args.store.add({
        ...proc,
        type: 'procedural',
        sourceSessionId: args.sessionId,
        sourceTimestamp: now,
        confidence: 'medium',
      })
      addedCount++
    }

    // Add episodic memories
    for (const episodic of extraction.episodic) {
      args.store.add({
        ...episodic,
        type: 'episodic',
        sourceSessionId: args.sessionId,
        sourceTimestamp: now,
        confidence: 'medium',
      })
      addedCount++
    }

    // Add user profile observations
    for (const profile of extraction.userProfile) {
      args.store.add({
        ...profile,
        type: 'user_profile',
        sourceSessionId: args.sessionId,
        sourceTimestamp: now,
        confidence: 'medium',
      })
      addedCount++
    }

    // Persist all three types if anything was added
    if (addedCount > 0) {
      await Promise.all([
        args.store.save('procedural'),
        args.store.save('episodic'),
        args.store.save('user_profile'),
      ])
    }

    return addedCount
  } catch {
    // Reflection must never crash the main loop
    return 0
  }
}
