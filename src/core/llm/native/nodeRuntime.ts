export function requireNode<T>(id: string): T {
  // Keep desktop Node APIs deferred so the plugin can still load on mobile.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(id) as T
}
