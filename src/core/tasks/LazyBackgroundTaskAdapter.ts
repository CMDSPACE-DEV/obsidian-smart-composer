import type {
  BackgroundTaskAdapter,
  BackgroundTaskKind,
  BackgroundTaskRecord,
  BackgroundTaskRunContext,
  BackgroundTaskRunResult,
} from '../../types/background-task'

export class LazyBackgroundTaskAdapter implements BackgroundTaskAdapter {
  private adapterPromise: Promise<BackgroundTaskAdapter> | null = null

  constructor(
    readonly kind: BackgroundTaskKind,
    private readonly load: () => Promise<BackgroundTaskAdapter>,
  ) {}

  async run(
    task: BackgroundTaskRecord,
    context: BackgroundTaskRunContext,
  ): Promise<BackgroundTaskRunResult> {
    const adapter = await this.getAdapter()
    return adapter.run(task, context)
  }

  private getAdapter(): Promise<BackgroundTaskAdapter> {
    if (!this.adapterPromise) {
      this.adapterPromise = this.load()
        .then((adapter) => {
          if (adapter.kind !== this.kind) {
            throw new Error(
              `Loaded ${adapter.kind} adapter for ${this.kind} tasks.`,
            )
          }
          return adapter
        })
        .catch((error) => {
          this.adapterPromise = null
          throw error
        })
    }
    return this.adapterPromise
  }
}
