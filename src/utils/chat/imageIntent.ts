const IMAGE_SUBJECT_PATTERN =
  /(이미지|그림|인포그래픽|포스터|광고|썸네일|일러스트|도표|visual|image|illustration|infographic|poster|thumbnail)/i

const KOREAN_GENERATION_PATTERN =
  /(그려(?:줘|주세요|봐|보자|볼까|보세요|줄래|주실래요)?|그리자|그릴까|만들어(?:줘|주세요|봐|보자|볼까|줄래|주실래요)?|만들자|생성해(?:줘|주세요|봐|보자|볼까|줄래|주실래요)?|생성하자|제작해(?:줘|주세요|봐|보자|볼까|줄래|주실래요)?|제작하자|디자인해(?:줘|주세요|봐|보자|볼까|줄래|주실래요)?|디자인하자|시각화해(?:줘|주세요|줄래)?|표현해(?:줘|주세요|줄래)?|출력해(?:줘|주세요)?)[.!?]*$/i

const KOREAN_DRAW_REQUEST_PATTERN =
  /(그려(?:줘|주세요|봐|보자|볼까|보세요|줄래|주실래요)?|그리자|그릴까)[.!?]*$/i

const ENGLISH_GENERATION_PATTERN =
  /\b(draw|generate|create|make|design|render)\b/i

const ENGLISH_DRAW_REQUEST_PATTERN = /^(?:please\s+)?(?:draw|render)\b/i

const CONTINUATION_PATTERN =
  /(더|연속|이외|제외|추가|같은|비슷|다시|another|more|again|additional|same|similar|in a row|consecutively)/i

const KOREAN_NUMBER_WORDS: Record<string, number> = {
  한: 1,
  하나: 1,
  두: 2,
  둘: 2,
  세: 3,
  셋: 3,
  네: 4,
  넷: 4,
  다섯: 5,
  여섯: 6,
  일곱: 7,
  여덟: 8,
  아홉: 9,
  열: 10,
}

const ENGLISH_NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
}

const KOREAN_NUMBER_PATTERN = Object.keys(KOREAN_NUMBER_WORDS)
  .sort((a, b) => b.length - a.length)
  .join('|')
const ENGLISH_NUMBER_PATTERN = Object.keys(ENGLISH_NUMBER_WORDS).join('|')

const KOREAN_IMAGE_COUNT_PATTERN = new RegExp(
  `(\\d{1,3}|${KOREAN_NUMBER_PATTERN})\\s*장(?!의)`,
  'i',
)
const ENGLISH_IMAGE_COUNT_PATTERN = new RegExp(
  `\\b(\\d{1,3}|${ENGLISH_NUMBER_PATTERN})\\s+(?:images?|pictures?|illustrations?|variations?)\\b`,
  'i',
)
const ENGLISH_MORE_COUNT_PATTERN = new RegExp(
  `\\b(\\d{1,3}|${ENGLISH_NUMBER_PATTERN})\\s+(?:more|additional)\\b`,
  'i',
)
const ENGLISH_BATCH_REQUEST_PATTERN = new RegExp(
  `^(?:please\\s+)?(?:draw|render|generate|create|make|design)\\s+(?:\\d{1,3}|${ENGLISH_NUMBER_PATTERN})\\s+(?:more|additional)\\b`,
  'i',
)
const SLASH_BATCH_COUNT_PATTERN = /^(\d{1,3})\s*[x×]\s+/i

export const MAX_IMAGE_BATCH_COUNT = 8

export type ImageGenerationRequest = {
  prompt: string
  count: number
  requestedCount: number
  usedPreviousPrompt: boolean
}

export function isImageGenerationRequest(text: string): boolean {
  const normalized = text.trim()
  if (/^\/image\b/i.test(normalized)) return true
  if (
    KOREAN_DRAW_REQUEST_PATTERN.test(normalized) ||
    ENGLISH_DRAW_REQUEST_PATTERN.test(normalized) ||
    ENGLISH_BATCH_REQUEST_PATTERN.test(normalized) ||
    (KOREAN_IMAGE_COUNT_PATTERN.test(normalized) &&
      KOREAN_GENERATION_PATTERN.test(normalized))
  ) {
    return true
  }
  if (!IMAGE_SUBJECT_PATTERN.test(normalized)) return false
  return (
    KOREAN_GENERATION_PATTERN.test(normalized) ||
    ENGLISH_GENERATION_PATTERN.test(normalized)
  )
}

export function getImageGenerationPrompt(text: string): string {
  return text.replace(/^\/image\b\s*/i, '').trim()
}

export function isImageGenerationContinuation(text: string): boolean {
  const prompt = getImageGenerationPrompt(text)
  return (
    CONTINUATION_PATTERN.test(prompt) && !IMAGE_SUBJECT_PATTERN.test(prompt)
  )
}

export function parseImageGenerationRequest(
  text: string,
  options: {
    force?: boolean
    previousPrompt?: string
  } = {},
): ImageGenerationRequest | null {
  const sourcePrompt = getImageGenerationPrompt(text)
  if (!options.force && !isImageGenerationRequest(text)) return null

  const countMatch = findImageCount(sourcePrompt)
  const requestedCount = countMatch?.count ?? 1
  const count = Math.min(MAX_IMAGE_BATCH_COUNT, Math.max(1, requestedCount))
  const previousPrompt = options.previousPrompt?.trim()
  const shouldReusePrevious =
    !!previousPrompt && isImageGenerationContinuation(sourcePrompt)
  const prompt =
    shouldReusePrevious && previousPrompt
      ? previousPrompt
      : normalizeBatchPrompt(sourcePrompt, countMatch)

  return {
    prompt: prompt || sourcePrompt,
    count,
    requestedCount,
    usedPreviousPrompt: shouldReusePrevious,
  }
}

export function buildImageGenerationPrompts(
  request: ImageGenerationRequest,
): string[] {
  if (request.count === 1) return [request.prompt]
  return Array.from({ length: request.count }, (_, index) =>
    [
      request.prompt,
      '',
      `Generate exactly one output image for batch variation ${index + 1} of ${request.count}.`,
      'Keep the core brief consistent while varying composition and visual details.',
    ].join('\n'),
  )
}

function findImageCount(
  prompt: string,
): { count: number; token: string } | null {
  const slashCount = prompt.match(SLASH_BATCH_COUNT_PATTERN)
  if (slashCount?.[1]) {
    return {
      count: Number(slashCount[1]),
      token: slashCount[0],
    }
  }
  const koreanCount = prompt.match(KOREAN_IMAGE_COUNT_PATTERN)
  if (koreanCount?.[1]) {
    return {
      count: parseCount(koreanCount[1], KOREAN_NUMBER_WORDS),
      token: koreanCount[0],
    }
  }
  const englishCount = prompt.match(ENGLISH_IMAGE_COUNT_PATTERN)
  if (englishCount?.[1]) {
    return {
      count: parseCount(englishCount[1], ENGLISH_NUMBER_WORDS),
      token: englishCount[0],
    }
  }
  const englishMoreCount = prompt.match(ENGLISH_MORE_COUNT_PATTERN)
  if (englishMoreCount?.[1]) {
    return {
      count: parseCount(englishMoreCount[1], ENGLISH_NUMBER_WORDS),
      token: englishMoreCount[0],
    }
  }
  return null
}

function parseCount(
  value: string,
  numberWords: Record<string, number>,
): number {
  return /^\d+$/.test(value)
    ? Number(value)
    : (numberWords[value.toLowerCase()] ?? 1)
}

function normalizeBatchPrompt(
  prompt: string,
  countMatch: { count: number; token: string } | null,
): string {
  let normalized = prompt
  if (countMatch && countMatch.count > 1) {
    const replacement = /[a-z]/i.test(countMatch.token) ? 'one image' : '한 장'
    normalized = normalized.replace(countMatch.token, replacement)
  }
  return normalized
    .replace(/(?:연속(?:으로)?|각각)\s*/g, '')
    .replace(/\b(?:in a row|consecutively|as a batch)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
