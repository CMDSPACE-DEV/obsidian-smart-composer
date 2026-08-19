import type { DocumentEditAnalysis, DocumentEditStrategy } from './types'

const SUMMARY_INTENT =
  /(?:요약|정리|개요|핵심|추출|목차|outline|summari[sz]e|extract|findings)/i

export function estimateDocumentTokens(value: string): number {
  let ascii = 0
  let nonAscii = 0
  for (const character of value) {
    if (character.charCodeAt(0) <= 0x7f) ascii += 1
    else nonAscii += 1
  }
  return Math.max(1, Math.ceil(ascii / 3.6 + nonAscii * 1.35))
}

export function classifyDocumentEditStrategy(
  instruction: string,
  placement: 'replace' | 'insert-after',
): DocumentEditStrategy {
  if (placement === 'insert-after' || SUMMARY_INTENT.test(instruction)) {
    return 'map-reduce'
  }
  return 'transform'
}

export function analyzeDocumentEdit(input: {
  source: string
  instruction: string
  placement: 'replace' | 'insert-after'
  strategy?: DocumentEditStrategy
}): DocumentEditAnalysis {
  const strategy =
    input.strategy ??
    classifyDocumentEditStrategy(input.instruction, input.placement)
  const estimatedSourceTokens = estimateDocumentTokens(input.source)
  const outputRatio = strategy === 'transform' ? 1.1 : 0.16
  const estimatedOutputTokens = Math.ceil(estimatedSourceTokens * outputRatio)
  const estimatedChunks = Math.max(1, Math.ceil(estimatedSourceTokens / 6_000))
  const shouldPromote =
    estimatedSourceTokens >= 12_000 ||
    estimatedOutputTokens >= 10_000 ||
    (strategy === 'transform' && input.source.length >= 24_000)
  const reason = shouldPromote
    ? strategy === 'transform'
      ? 'The requested replacement is too large for one reliable response.'
      : 'The complete source should be read in checkpointed sections.'
    : 'The selection fits the bounded inline-edit path.'

  return {
    strategy,
    estimatedSourceTokens,
    estimatedOutputTokens,
    estimatedChunks,
    shouldPromote,
    reason,
  }
}
