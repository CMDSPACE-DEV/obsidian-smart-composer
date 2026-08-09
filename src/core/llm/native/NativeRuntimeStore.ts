import type {
  NativeRuntimeProvider,
  NativeRuntimeSnapshot,
} from './nativeRuntime.types'

type RuntimeListener = (snapshot: NativeRuntimeSnapshot) => void

const createInitialSnapshot = (
  provider: NativeRuntimeProvider,
): NativeRuntimeSnapshot => ({
  provider,
  status: 'checking',
  phase: 'idle',
  installation: 'not-checked',
  authentication: 'not-checked',
  catalog: 'not-checked',
  update: 'not-checked',
  models: [],
})

/**
 * Machine health deliberately lives only for the lifetime of this Obsidian
 * process. It must never be serialized into vault settings or synced to a
 * second device.
 */
export class NativeRuntimeStore {
  private readonly snapshots: Record<
    NativeRuntimeProvider,
    NativeRuntimeSnapshot
  > = {
    claude: createInitialSnapshot('claude'),
    gemini: createInitialSnapshot('gemini'),
  }

  private readonly listeners: Record<
    NativeRuntimeProvider,
    Set<RuntimeListener>
  > = {
    claude: new Set(),
    gemini: new Set(),
  }

  private readonly generations: Record<NativeRuntimeProvider, number> = {
    claude: 0,
    gemini: 0,
  }

  getSnapshot(provider: NativeRuntimeProvider): NativeRuntimeSnapshot {
    return this.snapshots[provider]
  }

  subscribe(
    provider: NativeRuntimeProvider,
    listener: RuntimeListener,
  ): () => void {
    this.listeners[provider].add(listener)
    return () => this.listeners[provider].delete(listener)
  }

  beginDiagnosis(provider: NativeRuntimeProvider): number {
    const generation = this.generations[provider] + 1
    this.generations[provider] = generation
    this.publish(provider, {
      provider,
      status: 'checking',
      phase: 'checking',
      installation: 'not-checked',
      authentication: 'not-checked',
      catalog: 'not-checked',
      update: 'not-checked',
      models: [],
    })
    return generation
  }

  settleDiagnosis(
    provider: NativeRuntimeProvider,
    generation: number,
    snapshot: NativeRuntimeSnapshot,
  ): NativeRuntimeSnapshot {
    if (generation !== this.generations[provider]) {
      return this.snapshots[provider]
    }
    this.publish(provider, snapshot)
    return snapshot
  }

  reset(provider?: NativeRuntimeProvider): void {
    const providers: NativeRuntimeProvider[] = provider
      ? [provider]
      : ['claude', 'gemini']
    for (const currentProvider of providers) {
      this.generations[currentProvider] += 1
      this.publish(currentProvider, createInitialSnapshot(currentProvider))
    }
  }

  private publish(
    provider: NativeRuntimeProvider,
    snapshot: NativeRuntimeSnapshot,
  ): void {
    this.snapshots[provider] = snapshot
    for (const listener of this.listeners[provider]) listener(snapshot)
  }
}

export const sharedNativeRuntimeStore = new NativeRuntimeStore()
