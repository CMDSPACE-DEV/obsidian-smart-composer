import {
  analyzeDocumentEdit,
  classifyDocumentEditStrategy,
  estimateDocumentTokens,
} from './analysis'

describe('document edit analysis', () => {
  it('routes synthesis and insert-below work through map-reduce', () => {
    expect(classifyDocumentEditStrategy('전체를 요약해줘', 'replace')).toBe(
      'map-reduce',
    )
    expect(
      classifyDocumentEditStrategy('Write a conclusion', 'insert-after'),
    ).toBe('map-reduce')
    expect(classifyDocumentEditStrategy('문체를 다듬어줘', 'replace')).toBe(
      'transform',
    )
  })

  it('promotes document-sized transforms and allows an explicit strategy', () => {
    const source = '긴 문서 내용입니다. '.repeat(4_000)
    const automatic = analyzeDocumentEdit({
      source,
      instruction: '문체와 문법을 전부 다듬어줘',
      placement: 'replace',
    })
    const synthesis = analyzeDocumentEdit({
      source,
      instruction: '문체와 문법을 전부 다듬어줘',
      placement: 'replace',
      strategy: 'map-reduce',
    })

    expect(automatic).toMatchObject({
      strategy: 'transform',
      shouldPromote: true,
    })
    expect(synthesis.strategy).toBe('map-reduce')
    expect(synthesis.estimatedOutputTokens).toBeLessThan(
      automatic.estimatedOutputTokens,
    )
  })

  it('uses a conservative estimate for Korean text', () => {
    expect(estimateDocumentTokens('가나다라마바사')).toBeGreaterThan(
      estimateDocumentTokens('abcdefg'),
    )
  })
})
