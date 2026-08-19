import type { DocumentEditUnit } from './types'

type MarkdownBlock = {
  from: number
  to: number
  content: string
}

export function splitMarkdownForDocumentEdit(
  source: string,
  options: {
    preserveFrontmatter: boolean
    targetCharacters?: number
    maxAtomicCharacters?: number
  },
): DocumentEditUnit[] {
  const targetCharacters = Math.max(2_000, options.targetCharacters ?? 12_000)
  const maxAtomicCharacters = Math.max(
    targetCharacters,
    options.maxAtomicCharacters ?? 18_000,
  )
  const frontmatterEnd = options.preserveFrontmatter
    ? findFrontmatterEnd(source)
    : 0
  const blocks = scanMarkdownBlocks(source, frontmatterEnd).flatMap((block) =>
    splitOversizedBlock(block, maxAtomicCharacters),
  )
  const packed: MarkdownBlock[] = []
  let current: MarkdownBlock | null = null
  for (const block of blocks) {
    const beginsHeading = /^#{1,6}\s/m.test(block.content.trimStart())
    if (
      current &&
      (current.content.length + block.content.length > targetCharacters ||
        (beginsHeading && current.content.trim().length > 0))
    ) {
      packed.push(current)
      current = null
    }
    current = current
      ? {
          from: current.from,
          to: block.to,
          content: current.content + block.content,
        }
      : { ...block }
  }
  if (current) packed.push(current)

  const units: DocumentEditUnit[] = []
  if (frontmatterEnd > 0) {
    const content = source.slice(0, frontmatterEnd)
    units.push(makeUnit(units.length, 0, frontmatterEnd, content, [], true))
  }

  const headingPath: string[] = []
  for (const block of packed) {
    for (const line of block.content.split(/\r?\n/)) {
      const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
      if (!heading) continue
      const depth = heading[1].length
      headingPath.splice(depth - 1)
      headingPath[depth - 1] = heading[2]
    }
    units.push(
      makeUnit(
        units.length,
        block.from,
        block.to,
        block.content,
        headingPath.filter(Boolean),
        false,
      ),
    )
  }
  return units
}

function findFrontmatterEnd(source: string): number {
  if (!source.startsWith('---\n') && !source.startsWith('---\r\n')) return 0
  const match = /\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/g
  match.lastIndex = source.indexOf('\n') + 1
  const closing = match.exec(source)
  return closing ? closing.index + closing[0].length : 0
}

function scanMarkdownBlocks(source: string, start: number): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = []
  let blockStart = start
  let offset = start
  let inFence = false
  let fenceMarker = ''
  const lines = source.slice(start).match(/.*(?:\r?\n|$)/g) ?? []

  const push = (to: number) => {
    if (to <= blockStart) return
    blocks.push({
      from: blockStart,
      to,
      content: source.slice(blockStart, to),
    })
    blockStart = to
  }

  for (const line of lines) {
    if (!line) continue
    const lineStart = offset
    const lineEnd = offset + line.length
    const trimmed = line.trimStart()
    const fence = /^(```+|~~~+)/.exec(trimmed)
    const heading = /^#{1,6}\s/.test(trimmed)
    if (!inFence && heading && lineStart > blockStart) push(lineStart)
    if (fence) {
      if (!inFence) {
        inFence = true
        fenceMarker = fence[1][0]
      } else if (fence[1].startsWith(fenceMarker)) {
        inFence = false
        fenceMarker = ''
      }
    }
    offset = lineEnd
    if (!inFence && line.trim().length === 0) push(lineEnd)
  }
  push(source.length)
  return blocks
}

function splitOversizedBlock(
  block: MarkdownBlock,
  maximum: number,
): MarkdownBlock[] {
  if (block.content.length <= maximum) return [block]
  if (/(?:^|\n)[ \t]*(?:```|~~~)/.test(block.content)) return [block]
  const result: MarkdownBlock[] = []
  let cursor = 0
  while (cursor < block.content.length) {
    let end = Math.min(block.content.length, cursor + maximum)
    if (end < block.content.length) {
      const newline = block.content.lastIndexOf('\n', end)
      if (newline > cursor + Math.floor(maximum / 2)) end = newline + 1
    }
    result.push({
      from: block.from + cursor,
      to: block.from + end,
      content: block.content.slice(cursor, end),
    })
    cursor = end
  }
  return result
}

function makeUnit(
  index: number,
  from: number,
  to: number,
  content: string,
  headingPath: string[],
  protectedUnit: boolean,
): DocumentEditUnit {
  const checksum = stableTextHash(content)
  return {
    id: `${index.toString().padStart(4, '0')}-${checksum}`,
    index,
    from,
    to,
    headingPath: [...headingPath],
    checksum,
    protected: protectedUnit,
    status: protectedUnit ? 'succeeded' : 'pending',
    attempt: 0,
    reviewChoice: protectedUnit ? 'source' : 'edited',
  }
}

export function stableTextHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
