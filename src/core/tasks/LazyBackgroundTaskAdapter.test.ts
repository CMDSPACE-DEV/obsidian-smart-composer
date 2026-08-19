import type {
  BackgroundTaskAdapter,
  BackgroundTaskRecord,
  BackgroundTaskRunContext,
} from '../../types/background-task'

import { LazyBackgroundTaskAdapter } from './LazyBackgroundTaskAdapter'

const task = {
  id: 'task-1',
  kind: 'image-generation',
} as BackgroundTaskRecord
const context = {} as BackgroundTaskRunContext

describe('LazyBackgroundTaskAdapter', () => {
  it('loads and reuses its concrete adapter on first run', async () => {
    const run = jest.fn().mockResolvedValue({ status: 'succeeded' })
    const load = jest.fn().mockResolvedValue({
      kind: 'image-generation',
      run,
    } satisfies BackgroundTaskAdapter)
    const adapter = new LazyBackgroundTaskAdapter('image-generation', load)

    await adapter.run(task, context)
    await adapter.run(task, context)

    expect(load).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('allows a failed module load to be retried', async () => {
    const concrete = {
      kind: 'image-generation',
      run: jest.fn().mockResolvedValue({ status: 'succeeded' }),
    } satisfies BackgroundTaskAdapter
    const load = jest
      .fn<Promise<BackgroundTaskAdapter>, []>()
      .mockRejectedValueOnce(new Error('load failed'))
      .mockResolvedValueOnce(concrete)
    const adapter = new LazyBackgroundTaskAdapter('image-generation', load)

    await expect(adapter.run(task, context)).rejects.toThrow('load failed')
    await expect(adapter.run(task, context)).resolves.toEqual({
      status: 'succeeded',
    })
    expect(load).toHaveBeenCalledTimes(2)
  })
})
