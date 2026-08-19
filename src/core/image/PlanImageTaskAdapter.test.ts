import { readPngDimensions } from './PlanImageTaskAdapter'

describe('readPngDimensions', () => {
  it('reads dimensions from a PNG IHDR header', () => {
    const bytes = new Uint8Array(24)
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
    const view = new DataView(bytes.buffer)
    view.setUint32(16, 1920, false)
    view.setUint32(20, 1080, false)

    expect(readPngDimensions(bytes.buffer)).toEqual({
      width: 1920,
      height: 1080,
    })
  })

  it('rejects a non-PNG payload', () => {
    expect(readPngDimensions(new ArrayBuffer(24))).toBeNull()
  })
})
