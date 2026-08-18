// ---------------------------------------------------------------------------
// Memory types for the self-evolving memory sedimentation system
// ---------------------------------------------------------------------------

export type MemoryType = 'procedural' | 'episodic' | 'user_profile'

export type MemoryConfidence = 'high' | 'medium' | 'low'

// Base memory entry — all three types share these fields
export type MemoryEntry = {
  id: string
  type: MemoryType
  content: string
  tags: string[]
  sourceSessionId: string
  sourceTimestamp: string
  usageCount: number
  lastUsedAt?: string
  createdAt: string
  confidence: MemoryConfidence
}

// Procedural: "how to do X" patterns discovered during tool execution
// Example: "When running TypeScript compilation errors, check tsconfig.json strict mode first"
export type ProceduralMemory = MemoryEntry & {
  type: 'procedural'
  pattern: string   // short pattern name
  steps: string[]   // ordered steps
}

// Episodic: specific problem-solution pairs
// Example: "When the build failed with ENOENT on dist/, outDir was missing in tsconfig"
export type EpisodicMemory = MemoryEntry & {
  type: 'episodic'
  problem: string
  solution: string
  context: string
}

// User Profile: preferences, coding style, common patterns
// Example: "User prefers Chinese comments, uses strict TypeScript, prefers vitest over jest"
export type UserProfileMemory = MemoryEntry & {
  type: 'user_profile'
  category: 'preference' | 'habit' | 'style' | 'toolchain'
  observation: string
}

// Extraction result from the LLM
export type ExtractionResult = {
  procedural: Omit<ProceduralMemory, 'id' | 'createdAt' | 'usageCount'>[]
  episodic: Omit<EpisodicMemory, 'id' | 'createdAt' | 'usageCount'>[]
  userProfile: Omit<UserProfileMemory, 'id' | 'createdAt' | 'usageCount'>[]
}
