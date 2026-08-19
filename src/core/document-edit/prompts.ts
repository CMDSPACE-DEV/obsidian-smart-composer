import type { DocumentEditSpecification, DocumentEditStrategy } from './types'

export function buildSpecificationSystemPrompt(): string {
  return [
    'Convert the editing instruction into one stable document-edit specification.',
    'Return JSON only with: goal, preserve, transform, optional outputLanguage, formattingRules, forbiddenChanges.',
    'Each list must contain short, concrete rules. Do not include the source document.',
  ].join(' ')
}

export function buildFallbackSpecification(
  instruction: string,
): DocumentEditSpecification {
  return {
    goal: instruction,
    preserve: [
      'Preserve factual meaning unless the instruction explicitly changes it.',
      'Preserve Markdown block structure and links.',
    ],
    transform: [instruction],
    formattingRules: [
      'Return only the edited Markdown for the supplied source unit.',
    ],
    forbiddenChanges: [
      'Do not add commentary about the editing process.',
      'Do not repeat read-only overlap context.',
    ],
  }
}

export function parseSpecification(
  value: string,
  instruction: string,
): DocumentEditSpecification {
  const stripped = value.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    const parsed = JSON.parse(stripped) as Partial<DocumentEditSpecification>
    if (
      typeof parsed.goal === 'string' &&
      Array.isArray(parsed.preserve) &&
      Array.isArray(parsed.transform) &&
      Array.isArray(parsed.formattingRules) &&
      Array.isArray(parsed.forbiddenChanges)
    ) {
      return {
        goal: parsed.goal,
        preserve: parsed.preserve.filter(isString),
        transform: parsed.transform.filter(isString),
        outputLanguage:
          typeof parsed.outputLanguage === 'string'
            ? parsed.outputLanguage
            : undefined,
        formattingRules: parsed.formattingRules.filter(isString),
        forbiddenChanges: parsed.forbiddenChanges.filter(isString),
      }
    }
  } catch {
    // A deterministic specification is safer than failing the whole job.
  }
  return buildFallbackSpecification(instruction)
}

export function buildChunkSystemPrompt(
  strategy: DocumentEditStrategy,
  specification: DocumentEditSpecification,
): string {
  const operation =
    strategy === 'transform'
      ? 'Edit every part of SOURCE according to SPECIFICATION. Return the complete edited Markdown for SOURCE only.'
      : 'Create a query-focused summary of SOURCE according to SPECIFICATION. Preserve names, claims, numbers, and heading context needed by a later reducer.'
  return [
    operation,
    'BEFORE and AFTER are read-only overlap context and must never be emitted.',
    'Do not wrap the whole response in a Markdown code fence.',
    'Do not add process commentary.',
    `SPECIFICATION:\n${JSON.stringify(specification)}`,
  ].join('\n\n')
}

export function buildReductionSystemPrompt(
  specification: DocumentEditSpecification,
): string {
  return [
    'Combine every numbered partial result into one coherent Markdown result.',
    'Do not omit a numbered result. Remove only genuine duplication.',
    'Preserve important names, claims, numbers, and distinctions.',
    'Return the combined Markdown only, without process commentary.',
    `SPECIFICATION:\n${JSON.stringify(specification)}`,
  ].join('\n\n')
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}
