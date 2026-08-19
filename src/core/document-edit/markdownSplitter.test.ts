import { splitMarkdownForDocumentEdit } from './markdownSplitter'

describe('splitMarkdownForDocumentEdit', () => {
  it('covers the source exactly once and protects frontmatter', () => {
    const source = [
      '---',
      'title: Imported document',
      'hwp-source-format: hwpx',
      '---',
      '',
      '# First',
      '',
      'Paragraph one.',
      '',
      '# Second',
      '',
      'Paragraph two.',
      '',
    ].join('\n')
    const units = splitMarkdownForDocumentEdit(source, {
      preserveFrontmatter: true,
      targetCharacters: 2_000,
    })

    expect(units.map((unit) => source.slice(unit.from, unit.to)).join('')).toBe(
      source,
    )
    expect(units[0]).toMatchObject({
      from: 0,
      protected: true,
      status: 'succeeded',
      reviewChoice: 'source',
    })
    expect(units.slice(1).every((unit) => !unit.protected)).toBe(true)
  })

  it('keeps a fenced block atomic even when it exceeds the fallback size', () => {
    const fenced = `\`\`\`text\n${'content line\n'.repeat(500)}\`\`\`\n\n`
    const source = `# Code\n\n${fenced}# Next\n\nDone.\n`
    const units = splitMarkdownForDocumentEdit(source, {
      preserveFrontmatter: false,
      targetCharacters: 2_000,
      maxAtomicCharacters: 2_000,
    })
    const fenceUnits = units.filter((unit) =>
      source.slice(unit.from, unit.to).includes('```text'),
    )

    expect(fenceUnits).toHaveLength(1)
    expect(source.slice(fenceUnits[0].from, fenceUnits[0].to)).toContain(
      '```\n\n',
    )
    expect(units.map((unit) => source.slice(unit.from, unit.to)).join('')).toBe(
      source,
    )
  })

  it('falls back to newline boundaries for one oversized paragraph', () => {
    const source = Array.from(
      { length: 600 },
      (_, index) => `line ${index} with enough repeated content`,
    ).join('\n')
    const units = splitMarkdownForDocumentEdit(source, {
      preserveFrontmatter: false,
      targetCharacters: 2_000,
      maxAtomicCharacters: 2_000,
    })

    expect(units.length).toBeGreaterThan(1)
    expect(units.map((unit) => source.slice(unit.from, unit.to)).join('')).toBe(
      source,
    )
  })
})
