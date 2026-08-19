import type { Tiktoken, TiktokenBPE } from 'js-tiktoken/lite'

// Caution: tokenCount is computationally expensive for large inputs.
// Frequent use, especially on large files, may significantly impact performance.
let encoderPromise: Promise<Tiktoken> | null = null

function getTokenEncoder(): Promise<Tiktoken> {
  if (!encoderPromise) {
    encoderPromise = Promise.all([
      import('js-tiktoken/lite'),
      import('js-tiktoken/ranks/cl100k_base'),
    ]).then(([{ Tiktoken: TiktokenConstructor }, rankModule]) => {
      return new TiktokenConstructor(resolveRankModule(rankModule))
    })
  }
  return encoderPromise
}

function resolveRankModule(value: unknown): TiktokenBPE {
  let current = value
  for (let depth = 0; depth < 3; depth += 1) {
    if (
      current &&
      typeof current === 'object' &&
      'pat_str' in current &&
      'special_tokens' in current &&
      'bpe_ranks' in current
    ) {
      return current as TiktokenBPE
    }
    if (current && typeof current === 'object' && 'default' in current) {
      current = (current as { default: unknown }).default
      continue
    }
    break
  }
  throw new Error('Unable to load the cl100k_base tokenizer ranks.')
}

export async function encodeTokenIds(text: string): Promise<number[]> {
  const encoder = await getTokenEncoder()
  return encoder.encode(text)
}

export async function tokenCount(text: string): Promise<number> {
  const encoder = await getTokenEncoder()
  return encoder.encode(text).length
}
