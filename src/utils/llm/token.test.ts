import { getEncoding } from 'js-tiktoken'

import { encodeTokenIds, tokenCount } from './token'

const corpus = [
  '',
  'Smart Composer keeps exact token semantics.',
  '옵시디언 폴더 전체를 정독하고 핵심 연결점을 정리해줘.',
  '# Heading\n\n- one\n- two\n\n```ts\nconst value = 42\n```',
  'Emoji and mixed Unicode: 🚀 🧠 café 한글 日本語',
  '긴 문장 '.repeat(2_000),
]

describe('cl100k tokenizer lite bundle', () => {
  const legacyEncoder = getEncoding('cl100k_base')

  it.each(corpus.map((text, index) => [index, text] as const))(
    'matches the legacy token ids for corpus item %i',
    async (_index, text) => {
      const expected = legacyEncoder.encode(text)
      await expect(encodeTokenIds(text)).resolves.toEqual(expected)
      await expect(tokenCount(text)).resolves.toBe(expected.length)
    },
  )

  it('shares one initialized encoder across concurrent calls', async () => {
    const values = await Promise.all(corpus.map((text) => tokenCount(text)))
    expect(values).toEqual(
      corpus.map((text) => legacyEncoder.encode(text).length),
    )
  })
})
