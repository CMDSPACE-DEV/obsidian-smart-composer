const IMAGE_SUBJECT_PATTERN =
  /(이미지|그림|인포그래픽|포스터|광고|썸네일|일러스트|도표|visual|image|illustration|infographic|poster|thumbnail)/i

const KOREAN_GENERATION_PATTERN =
  /(그려|그려줘|그려주세요|그려봐|만들어|만들어줘|만들어주세요|생성해|생성해줘|생성해주세요|제작해|제작해줘|제작해주세요|디자인해|디자인해줘|디자인해주세요|출력해|출력해줘)(?:\s*(?:봐|줘|주세요))?[.!?]*$/i

const ENGLISH_GENERATION_PATTERN =
  /\b(draw|generate|create|make|design|render)\b/i

export function isImageGenerationRequest(text: string): boolean {
  const normalized = text.trim()
  if (/^\/image\b/i.test(normalized)) return true
  if (!IMAGE_SUBJECT_PATTERN.test(normalized)) return false
  return (
    KOREAN_GENERATION_PATTERN.test(normalized) ||
    ENGLISH_GENERATION_PATTERN.test(normalized)
  )
}

export function getImageGenerationPrompt(text: string): string {
  return text.replace(/^\/image\b\s*/i, '').trim()
}
