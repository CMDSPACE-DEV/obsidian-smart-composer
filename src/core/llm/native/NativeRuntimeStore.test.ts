import type { NativeRuntimeSnapshot } from './nativeRuntime.types'
import { NativeRuntimeStore } from './NativeRuntimeStore'

describe('NativeRuntimeStore', () => {
  it('shares one snapshot with subscribers without persisting machine health', () => {
    const store = new NativeRuntimeStore()
    const listener = jest.fn()
    const unsubscribe = store.subscribe('claude', listener)
    const generation = store.beginDiagnosis('claude')
    const ready = snapshot('ready', '2.1.220')

    store.settleDiagnosis('claude', generation, ready)

    expect(store.getSnapshot('claude')).toBe(ready)
    expect(listener).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ phase: 'checking', status: 'checking' }),
    )
    expect(listener).toHaveBeenNthCalledWith(2, ready)
    unsubscribe()
  })

  it('rejects an older diagnosis result and returns the latest snapshot', () => {
    const store = new NativeRuntimeStore()
    const firstGeneration = store.beginDiagnosis('claude')
    const secondGeneration = store.beginDiagnosis('claude')
    const latest = snapshot('ready', 'new')

    store.settleDiagnosis('claude', secondGeneration, latest)
    const staleResult = store.settleDiagnosis(
      'claude',
      firstGeneration,
      snapshot('error', 'old'),
    )

    expect(staleResult).toBe(latest)
    expect(store.getSnapshot('claude')).toBe(latest)
  })
})

function snapshot(
  status: NativeRuntimeSnapshot['status'],
  version: string,
): NativeRuntimeSnapshot {
  return {
    provider: 'claude',
    status,
    phase: 'settled',
    installation: 'installed',
    authentication: status === 'ready' ? 'subscription' : 'not-checked',
    catalog: status === 'ready' ? 'ready' : 'error',
    update: 'native',
    models: [],
    version,
  }
}
