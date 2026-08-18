import { z } from 'zod'
import type { ToolDefinition } from '../tool.js'
import type { SkillRouter } from '../skill-router.js'

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

type Input = {
  query: string
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createRouteSkillTool(
  router: SkillRouter,
  cwd: string,
): ToolDefinition<Input> {
  return {
    name: 'route_skill',
    description:
      'Search for relevant skills based on your current task intent. ' +
      'Returns ranked skill recommendations with match reasons. ' +
      'Call this when you are unsure which skill applies, or when starting ' +
      'a complex task that might benefit from a skill.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Describe your current task or intent.',
        },
      },
      required: ['query'],
    },
    schema: z.object({
      query: z.string().min(1),
    }),
    async run(input: Input) {
      // Refresh index if cwd changed
      if (router.getLastIndexCwd() !== cwd) {
        await router.refreshIndex(cwd)
      }

      const index = router.getIndex()
      if (index.length === 0) {
        return {
          ok: true,
          output: 'No skills discovered. Add skills to .mini-code/skills/ or .claude/skills/ directories.',
        }
      }

      const result = router.route({ userInput: input.query, cwd })

      if (result.candidates.length === 0) {
        return {
          ok: true,
          output: [
            `No relevant skills found for: "${input.query}"`,
            '',
            `Available skills (${index.length}):`,
            ...index.map(s => `  - ${s.name}: ${s.description}`),
          ].join('\n'),
        }
      }

      const lines = result.candidates.map((c, i) =>
        [
          `${i + 1}. ${c.skill.name} (score: ${Math.round(c.score)})`,
          `   Description: ${c.skill.description}`,
          `   Match reasons: ${c.matchReasons.join(', ')}`,
          c.skill.tags.length > 0
            ? `   Tags: ${c.skill.tags.join(', ')}`
            : null,
          `   Source: ${c.skill.source}`,
        ]
          .filter(Boolean)
          .join('\n'),
      )

      return {
        ok: true,
        output: [
          `Found ${result.candidates.length} relevant skill(s) for: "${input.query}"`,
          '',
          lines.join('\n\n'),
        ].join('\n'),
      }
    },
  }
}
