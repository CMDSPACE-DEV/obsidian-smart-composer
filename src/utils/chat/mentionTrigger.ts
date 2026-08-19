export type MentionTrigger = {
  from: number
  to: number
  query: string
}

export function findMentionTrigger(
  value: string,
  cursor: number,
): MentionTrigger | null {
  const safeCursor = Math.max(0, Math.min(cursor, value.length))
  const lineStart = value.lastIndexOf('\n', safeCursor - 1) + 1
  const at = value.lastIndexOf('@', safeCursor - 1)
  if (at < lineStart) return null

  const previous = at > 0 ? value[at - 1] : ''
  if (previous && !/[\s([{"'`]/.test(previous)) return null

  const query = value.slice(at + 1, safeCursor)
  if (query.includes('@') || query.length > 120) return null

  return {
    from: at,
    to: safeCursor,
    query: query.trimStart(),
  }
}

export function removeMentionTrigger(
  value: string,
  trigger: MentionTrigger,
): { value: string; cursor: number } {
  const before = value.slice(0, trigger.from)
  const rawAfter = value.slice(trigger.to)
  const after =
    /\s$/.test(before) && /^\s/.test(rawAfter)
      ? rawAfter.replace(/^\s+/, '')
      : rawAfter
  const needsSpace =
    before.length > 0 &&
    after.length > 0 &&
    !/\s$/.test(before) &&
    !/^\s/.test(after)
  const next = `${before}${needsSpace ? ' ' : ''}${after}`
  return {
    value: next,
    cursor: before.length + (needsSpace ? 1 : 0),
  }
}
