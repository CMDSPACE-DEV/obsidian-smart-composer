import {
  MAX_IMAGE_BATCH_COUNT,
  buildImageGenerationPrompts,
  getImageGenerationPrompt,
  isImageGenerationContinuation,
  isImageGenerationRequest,
  parseImageGenerationRequest,
} from './imageIntent'

describe('image intent', () => {
  it.each([
    '/image A detailed editorial infographic',
    '텍스트가 많이 들어간 고품질 인포그래픽 이미지 그려봐',
    '한림대 색상으로 광고 포스터를 만들어줘',
    '연구 내용을 설명하는 그림을 생성해주세요',
    '고양이가 나오는 광고 이미지를 아무거나 그려보자',
    '2장 연속으로 더 그려보자',
    '지금 그리는 것 이외에 3장을 연속으로 더 그려보자',
    '이미지 하나 만들어볼까?',
    'Generate a polished infographic image',
    'Draw two more',
  ])('recognizes an explicit generation request: %s', (request) => {
    expect(isImageGenerationRequest(request)).toBe(true)
  })

  it.each([
    '이 이미지 내용을 설명해줘',
    '이미지 생성 기능이 왜 실패했는지 분석해줘',
    '광고 포스터의 구성 요소를 정리해줘',
    'Summarize the image generation documentation',
    '이미지 큐가 돌고 있는 동안 채팅도 계속 이어지는지 테스트해보자',
  ])('does not hijack an image-related chat request: %s', (request) => {
    expect(isImageGenerationRequest(request)).toBe(false)
  })

  it('removes only the explicit slash command from the image prompt', () => {
    expect(getImageGenerationPrompt('/image 1920x1080 research poster')).toBe(
      '1920x1080 research poster',
    )
    expect(getImageGenerationPrompt('인포그래픽 이미지 그려봐')).toBe(
      '인포그래픽 이미지 그려봐',
    )
  })

  it('parses a Korean multi-image request as separate outputs', () => {
    expect(
      parseImageGenerationRequest('고양이 광고 이미지 2장 연속으로 그려줘'),
    ).toEqual({
      prompt: '고양이 광고 이미지 한 장 그려줘',
      count: 2,
      requestedCount: 2,
      usedPreviousPrompt: false,
    })
  })

  it('supports Korean number words', () => {
    expect(
      parseImageGenerationRequest('서로 다른 인포그래픽 두 장 그려줘'),
    ).toMatchObject({
      prompt: '서로 다른 인포그래픽 한 장 그려줘',
      count: 2,
      requestedCount: 2,
    })
  })

  it('reuses the previous brief for a continuation-only batch', () => {
    expect(isImageGenerationContinuation('2장 연속으로 더 그려보자')).toBe(true)
    expect(
      isImageGenerationContinuation('고양이 광고 이미지 2장 더 그려보자'),
    ).toBe(false)
    expect(
      parseImageGenerationRequest('지금 그리는 것 이외에 3장을 더 그려보자', {
        previousPrompt: '고양이가 나오는 프리미엄 광고 이미지',
      }),
    ).toEqual({
      prompt: '고양이가 나오는 프리미엄 광고 이미지',
      count: 3,
      requestedCount: 3,
      usedPreviousPrompt: true,
    })
  })

  it('parses English batch counts and normalizes each output to one image', () => {
    expect(
      parseImageGenerationRequest('Generate three images of a research lab'),
    ).toMatchObject({
      prompt: 'Generate one image of a research lab',
      count: 3,
      requestedCount: 3,
    })
    expect(
      parseImageGenerationRequest('Draw two more', {
        previousPrompt: 'A premium editorial poster',
      }),
    ).toMatchObject({
      prompt: 'A premium editorial poster',
      count: 2,
      requestedCount: 2,
      usedPreviousPrompt: true,
    })
  })

  it('caps an excessive batch and allows the explicit Generate mode', () => {
    expect(parseImageGenerationRequest('12장 그려보자')).toMatchObject({
      count: MAX_IMAGE_BATCH_COUNT,
      requestedCount: 12,
    })
    expect(
      parseImageGenerationRequest('두 장 서로 다른 초안', {
        force: true,
      }),
    ).toMatchObject({
      count: 2,
      requestedCount: 2,
    })
  })

  it('builds one unique task prompt per requested variation', () => {
    const request = parseImageGenerationRequest('고양이 광고 이미지 3장 그려줘')
    expect(request).not.toBeNull()
    if (!request) throw new Error('Expected an image generation request')
    const prompts = buildImageGenerationPrompts(request)
    expect(prompts).toHaveLength(3)
    expect(prompts[0]).toContain('variation 1 of 3')
    expect(prompts[1]).toContain('variation 2 of 3')
    expect(prompts[2]).toContain('variation 3 of 3')
  })
})
