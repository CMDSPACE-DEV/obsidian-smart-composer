export class SettingsSaveQueue<T> {
  private tail: Promise<void> = Promise.resolve()
  private lastPersistedValue: T

  constructor(initialPersistedValue: T) {
    this.lastPersistedValue = initialPersistedValue
  }

  get persistedValue(): T {
    return this.lastPersistedValue
  }

  enqueue(value: T, save: (value: T) => Promise<void>): Promise<void> {
    const operation = this.tail.then(() => save(value))
    this.tail = operation.then(
      () => {
        this.lastPersistedValue = value
      },
      () => undefined,
    )
    return operation
  }
}
