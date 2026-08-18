import { createHash } from 'node:crypto'
import type { SkillSummary, LoadedSkill } from './skills.js'
import { discoverSkills, loadSkill } from './skills.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SkillMetadata = SkillSummary & {
  tags: string[]
  triggers: string[]
  boundaries: {
    appliesTo: string[]
    excludes: string[]
  }
  examples: Array<{ input: string; expected: string }>
  priority: number
  contentHash: string
}

export type RoutingQuery = {
  userInput: string
  cwd: string
  recentToolCalls?: string[]
  activeFilePath?: string
}

export type SkillCandidate = {
  skill: SkillMetadata
  score: number
  matchReasons: string[]
}

export type RoutingResult = {
  candidates: SkillCandidate[]
  scores: Map<string, number>
}

// ---------------------------------------------------------------------------
// Frontmatter parser (YAML subset — no external dependency)
// ---------------------------------------------------------------------------

export function parseFrontmatter(content: string): {
  meta: Partial<SkillMetadata>
  body: string
} {
  const normalized = content.replace(/\r\n/g, '\n')

  // Must start with ---
  if (!normalized.startsWith('---')) {
    return { meta: {}, body: normalized }
  }

  const endIndex = normalized.indexOf('\n---', 3)
  if (endIndex === -1) {
    return { meta: {}, body: normalized }
  }

  const rawYaml = normalized.slice(3, endIndex).trim()
  const body = normalized.slice(endIndex + 4).trim()

  const meta: Record<string, unknown> = {}
  const lines = rawYaml.split('\n')

  // Simple state machine for parsing YAML
  // Tracks current top-level key and optional sub-key for nested objects
  let currentKey = ''
  let currentSubKey = ''
  let currentArray: string[] | null = null
  let nestedObj: Record<string, string[]> | null = null

  function flushArray() {
    if (currentArray !== null) {
      if (currentSubKey && nestedObj) {
        nestedObj[currentSubKey] = currentArray
      } else if (currentKey) {
        meta[currentKey] = currentArray
      }
      currentArray = null
      currentSubKey = ''
    }
  }

  function flushNested() {
    if (nestedObj && currentKey) {
      meta[currentKey] = nestedObj
      nestedObj = null
    }
  }

  for (const line of lines) {
    const indent = line.length - line.trimStart().length
    const trimmed = line.trim()

    // Empty line
    if (!trimmed) continue

    // Array item (starts with - )
    if (trimmed.startsWith('- ')) {
      if (currentArray === null) {
        // Start an implicit array
        currentArray = []
      }
      currentArray.push(trimmed.slice(2).replace(/^["']|["']$/g, '').trim())
      continue
    }

    // Indented sub-key (part of nested object, e.g. "  appliesTo:")
    if (indent >= 2 && !trimmed.startsWith('-')) {
      const kvMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/)
      if (kvMatch) {
        const [, subKey, value] = kvMatch
        const val = value.trim()

        // Flush any pending array from previous sub-key
        flushArray()

        if (val === '' || val === '[]') {
          // Start new array for this sub-key
          currentSubKey = subKey
          currentArray = []
          if (!nestedObj) nestedObj = {}
        } else if (val.startsWith('[') && val.endsWith(']')) {
          // Inline array
          const items = val
            .slice(1, -1)
            .split(',')
            .map(s => s.replace(/^["']|["']$/g, '').trim())
            .filter(Boolean)
          if (!nestedObj) nestedObj = {}
          nestedObj[subKey] = items
        } else {
          // Scalar value in nested context
          if (!nestedObj) nestedObj = {}
          nestedObj[subKey] = [parseYamlScalar(val) as string]
        }
        continue
      }
    }

    // Top-level key
    if (indent === 0) {
      // Flush any pending structures from previous key
      flushArray()
      flushNested()

      const kvMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/)
      if (!kvMatch) continue

      const [, key, value] = kvMatch
      const val = value.trim()
      currentKey = key

      if (val === '' || val === '[]') {
        // Start of array or nested object (determined by next lines)
        currentArray = []
        nestedObj = null
      } else if (val.startsWith('[') && val.endsWith(']')) {
        // Inline array: [a, b, c]
        const items = val
          .slice(1, -1)
          .split(',')
          .map(s => s.replace(/^["']|["']$/g, '').trim())
          .filter(Boolean)
        meta[key] = items
        currentArray = null
      } else {
        // Scalar value
        meta[key] = parseYamlScalar(val)
        currentArray = null
      }
    }
  }

  // Flush pending structures
  flushArray()
  flushNested()

  return { meta, body }
}

function parseYamlScalar(val: string): string | number | boolean {
  const unquoted = val.replace(/^["']|["']$/g, '').trim()
  if (unquoted === 'true') return true
  if (unquoted === 'false') return false
  const num = Number(unquoted)
  if (!Number.isNaN(num) && unquoted !== '') return num
  return unquoted
}

// ---------------------------------------------------------------------------
// Metadata extraction
// ---------------------------------------------------------------------------

function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 12)
}

function extractMetadata(
  skillSummary: SkillSummary,
  fullContent: string,
): SkillMetadata {
  const { meta } = parseFrontmatter(fullContent)

  // Handle boundaries - may be nested object or legacy flat format
  let appliesTo: string[] = []
  let excludes: string[] = []
  if (meta.boundaries && typeof meta.boundaries === 'object' && !Array.isArray(meta.boundaries)) {
    const b = meta.boundaries as Record<string, unknown>
    if (Array.isArray(b.appliesTo)) appliesTo = b.appliesTo as string[]
    if (Array.isArray(b.excludes)) excludes = b.excludes as string[]
  } else if (Array.isArray(meta.boundaries)) {
    // Legacy: boundaries as flat array → treat as appliesTo
    appliesTo = meta.boundaries as unknown as string[]
  }

  return {
    ...skillSummary,
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    triggers: Array.isArray(meta.triggers) ? meta.triggers : [],
    boundaries: { appliesTo, excludes },
    examples: Array.isArray(meta.examples) ? (meta.examples as SkillMetadata['examples']) : [],
    priority: typeof meta.priority === 'number' ? meta.priority : 50,
    contentHash: contentHash(fullContent),
  }
}

// ---------------------------------------------------------------------------
// Tokenizer (simple lowercase split)
// ---------------------------------------------------------------------------

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, ' ')
    .split(' ')
    .filter(t => t.length > 1)
}

// ---------------------------------------------------------------------------
// Glob matching (minimal: supports * and **)
// ---------------------------------------------------------------------------

export function simpleGlobMatch(pattern: string, filePath: string): boolean {
  const patternParts = pattern.split('/')
  const fileParts = filePath.split('/')

  return matchParts(patternParts, fileParts, 0, 0)
}

function matchParts(
  patternParts: string[],
  fileParts: string[],
  pi: number,
  fi: number,
): boolean {
  // Pattern exhausted
  if (pi === patternParts.length) {
    return fi === fileParts.length
  }

  const segment = patternParts[pi]

  // ** matches zero or more directories
  if (segment === '**') {
    // Try matching ** against 0, 1, 2, ... path segments
    for (let skip = 0; fi + skip <= fileParts.length; skip++) {
      if (matchParts(patternParts, fileParts, pi + 1, fi + skip)) {
        return true
      }
    }
    return false
  }

  // File exhausted but pattern remains
  if (fi === fileParts.length) return false

  // * matches anything within a single segment
  if (segment === '*') {
    return matchParts(patternParts, fileParts, pi + 1, fi + 1)
  }

  // Exact match (or * glob within a single segment)
  if (segment === fileParts[fi]) {
    return matchParts(patternParts, fileParts, pi + 1, fi + 1)
  }

  // Segment with * wildcard (e.g. "*.ts")
  if (segment.includes('*')) {
    const regex = new RegExp(
      '^' + segment.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$',
    )
    if (regex.test(fileParts[fi])) {
      return matchParts(patternParts, fileParts, pi + 1, fi + 1)
    }
  }

  return false
}

// ---------------------------------------------------------------------------
// Two-stage routing
// ---------------------------------------------------------------------------

const TOP_K = 5
const MIN_SCORE_THRESHOLD = 5

function firstStageRecall(
  query: RoutingQuery,
  index: SkillMetadata[],
): SkillCandidate[] {
  const candidates: SkillCandidate[] = []
  const queryTokens = tokenize(query.userInput)

  for (const skill of index) {
    let score = 0
    const matchReasons: string[] = []

    // Trigger matching: substring match in user input (highest signal)
    for (const trigger of skill.triggers) {
      if (query.userInput.toLowerCase().includes(trigger.toLowerCase())) {
        score += 30
        matchReasons.push(`trigger: ${trigger}`)
      }
    }

    // Name matching
    if (query.userInput.toLowerCase().includes(skill.name.toLowerCase())) {
      score += 25
      matchReasons.push('name match')
    }

    // Tag matching: token overlap
    for (const tag of skill.tags) {
      const tagTokens = tokenize(tag)
      const overlap = queryTokens.filter(t => tagTokens.includes(t)).length
      if (overlap > 0) {
        score += (overlap / tagTokens.length) * 20
        matchReasons.push(`tag: ${tag}`)
      }
    }

    // Description matching: keyword overlap
    const descTokens = tokenize(skill.description)
    const descOverlap = queryTokens.filter(t => descTokens.includes(t)).length
    if (descOverlap > 0) {
      score += (descOverlap / Math.max(queryTokens.length, 1)) * 10
      matchReasons.push('description match')
    }

    if (score > 0) {
      candidates.push({ skill, score, matchReasons })
    }
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K)
}

function secondStageRanking(
  query: RoutingQuery,
  candidates: SkillCandidate[],
): SkillCandidate[] {
  for (const candidate of candidates) {
    const { skill } = candidate

    // Boundary: appliesTo match (positive)
    if (query.activeFilePath && skill.boundaries.appliesTo.length > 0) {
      const matches = skill.boundaries.appliesTo.some(pattern =>
        simpleGlobMatch(pattern, query.activeFilePath!),
      )
      if (matches) {
        candidate.score += 15
        candidate.matchReasons.push(`boundary: applies to ${query.activeFilePath}`)
      }
    }

    // Boundary: excludes match (negative)
    if (query.activeFilePath && skill.boundaries.excludes.length > 0) {
      const matches = skill.boundaries.excludes.some(pattern =>
        simpleGlobMatch(pattern, query.activeFilePath!),
      )
      if (matches) {
        candidate.score -= 20
        candidate.matchReasons.push(`excluded: ${query.activeFilePath}`)
      }
    }

    // Priority boost (0-100 → 0-5 bonus)
    candidate.score += (skill.priority / 100) * 5

    // Example similarity: check if any example input is a prefix substring
    for (const example of skill.examples) {
      const exampleLower = example.input.toLowerCase()
      const inputLower = query.userInput.toLowerCase()
      if (
        inputLower.includes(exampleLower.slice(0, 15)) ||
        exampleLower.includes(inputLower.slice(0, 15))
      ) {
        candidate.score += 10
        candidate.matchReasons.push(`example: ${example.input}`)
      }
    }

    // Project skills slightly preferred over user skills
    if (skill.source === 'project') {
      candidate.score += 2
    }
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .filter(c => c.score > MIN_SCORE_THRESHOLD)
}

// ---------------------------------------------------------------------------
// SkillRouter class
// ---------------------------------------------------------------------------

export class SkillRouter {
  private index: SkillMetadata[] = []
  private lastIndexCwd = ''

  async refreshIndex(cwd: string): Promise<void> {
    const summaries = await discoverSkills(cwd)
    const fullIndex: SkillMetadata[] = []

    for (const summary of summaries) {
      const skill = await loadSkill(cwd, summary.name)
      if (skill) {
        fullIndex.push(extractMetadata(summary, skill.content))
      }
    }

    this.index = fullIndex
    this.lastIndexCwd = cwd
  }

  getIndex(): SkillMetadata[] {
    return this.index
  }

  route(query: RoutingQuery): RoutingResult {
    const candidates = firstStageRecall(query, this.index)
    const ranked = secondStageRanking(query, candidates)
    const scores = new Map(ranked.map(c => [c.skill.name, c.score]))
    return { candidates: ranked, scores }
  }

  getLastIndexCwd(): string {
    return this.lastIndexCwd
  }
}
