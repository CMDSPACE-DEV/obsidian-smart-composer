import { SettingsSaveQueue } from './settingsSaveQueue'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('SettingsSaveQueue', () => {
  it('persists rapid updates in the order they were enqueued', async () => {
    const queue = new SettingsSaveQueue('initial')
    const firstSave = deferred()
    const events: string[] = []

    const firstOperation = queue.enqueue('first', async (value) => {
      events.push('first:start')
      await firstSave.promise
      events.push(`${value}:end`)
    })
    const secondOperation = queue.enqueue('second', async (value) => {
      events.push(value)
    })

    await Promise.resolve()
    expect(events).toEqual(['first:start'])

    firstSave.resolve()
    await Promise.all([firstOperation, secondOperation])
    expect(events).toEqual(['first:start', 'first:end', 'second'])
    expect(queue.persistedValue).toBe('second')
  })

  it('continues with the next save after reporting a failed save', async () => {
    const queue = new SettingsSaveQueue('initial')
    const failure = new Error('disk unavailable')
    let secondSaveRan = false

    const firstOperation = queue.enqueue('first', async () => {
      throw failure
    })
    const secondOperation = queue.enqueue('second', async () => {
      secondSaveRan = true
    })

    await expect(firstOperation).rejects.toBe(failure)
    await expect(secondOperation).resolves.toBeUndefined()
    expect(secondSaveRan).toBe(true)
    expect(queue.persistedValue).toBe('second')
  })

  it.each([
    {
      name: 'success then failure',
      outcomes: [true, false],
      expected: 'first',
    },
    {
      name: 'failure then success',
      outcomes: [false, true],
      expected: 'second',
    },
    {
      name: 'failure then failure',
      outcomes: [false, false],
      expected: 'initial',
    },
  ])(
    'tracks the last durable state after $name',
    async ({ outcomes, expected }) => {
      const queue = new SettingsSaveQueue('initial')

      for (const [index, succeeds] of outcomes.entries()) {
        const value = index === 0 ? 'first' : 'second'
        try {
          await queue.enqueue(value, async () => {
            if (!succeeds) {
              throw new Error(`failed: ${value}`)
            }
          })
        } catch {
          // The caller handles the failure while the queue retains durable state.
        }
      }

      expect(queue.persistedValue).toBe(expected)
    },
  )
})
