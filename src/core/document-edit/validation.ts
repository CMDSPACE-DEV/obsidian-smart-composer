import type { DocumentEditJobManifest } from './types'

export type DocumentAssemblyValidation = {
  valid: boolean
  warnings: string[]
  errors: string[]
}

export function validateDocumentAssembly(
  manifest: DocumentEditJobManifest,
  assembled: string,
): DocumentAssemblyValidation {
  const errors: string[] = []
  const warnings: string[] = []
  const ids = new Set<string>()
  for (const unit of manifest.units) {
    if (ids.has(unit.id)) errors.push(`Duplicate unit ID: ${unit.id}`)
    ids.add(unit.id)
    if (unit.status !== 'succeeded') {
      errors.push(`Unit ${unit.index + 1} is not complete.`)
    }
    if (!unit.protected && unit.reviewChoice !== 'source' && !unit.outputPath) {
      errors.push(`Unit ${unit.index + 1} has no output checkpoint.`)
    }
  }
  if (countFenceMarkers(assembled, '```') % 2 !== 0) {
    errors.push('The assembled draft has an unbalanced backtick fence.')
  }
  if (countFenceMarkers(assembled, '~~~') % 2 !== 0) {
    errors.push('The assembled draft has an unbalanced tilde fence.')
  }
  const sourceHeadings = manifest.units.flatMap((unit) => unit.headingPath)
  const outputHeadings =
    assembled.match(/^#{1,6}\s+.+$/gm)?.map((heading) => heading.trim()) ?? []
  if (sourceHeadings.length > 0 && outputHeadings.length === 0) {
    warnings.push('The source had headings but the draft has none.')
  }
  return { valid: errors.length === 0, warnings, errors }
}

function countFenceMarkers(value: string, marker: string): number {
  return value
    .split(/\r?\n/)
    .filter((line) => line.trimStart().startsWith(marker)).length
}
