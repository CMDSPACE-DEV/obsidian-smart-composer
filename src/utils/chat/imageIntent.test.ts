import {
  getImageGenerationPrompt,
  isImageGenerationRequest,
} from './imageIntent'

describe('image intent', () => {
  it.each([
    '/image A detailed editorial infographic',
    '텍스트가 많이 들어간 고품질 인포그래픽 이미지 그려봐',
    '한림대 색상으로 광고 포스터를 만들어줘',
    '연구 내용을 설명하는 그림을 생성해주세요',
    'Generate a polished infographic image',
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
})
