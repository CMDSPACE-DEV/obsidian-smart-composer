import { prepareChatMountSurface } from './chatMountSurface'

function createElementMock() {
  return {
    className: '',
  }
}

describe('prepareChatMountSurface', () => {
  test('mounts the editable chat in light DOM without attaching a shadow root', () => {
    const mountElement = createElementMock()
    const host = {
      ownerDocument: {
        createElement: jest.fn(() => mountElement),
      },
      replaceChildren: jest.fn(),
      attachShadow: jest.fn(),
      shadowRoot: null,
    }

    const result = prepareChatMountSurface(
      host as unknown as HTMLElement,
    ) as unknown as typeof mountElement

    expect(result).toBe(mountElement)
    expect(mountElement.className).toBe('smtcmp-shell')
    expect(host.replaceChildren).toHaveBeenCalledWith(mountElement)
    expect(host.attachShadow).not.toHaveBeenCalled()
  })

  test('turns a previous 2.0.0 shadow root into a transparent slot', () => {
    const passthroughSlot = createElementMock()
    const mountElement = createElementMock()
    const shadowRoot = {
      replaceChildren: jest.fn(),
    }
    const host = {
      ownerDocument: {
        createElement: jest
          .fn()
          .mockReturnValueOnce(passthroughSlot)
          .mockReturnValueOnce(mountElement),
      },
      replaceChildren: jest.fn(),
      shadowRoot,
    }

    prepareChatMountSurface(host as unknown as HTMLElement)

    expect(shadowRoot.replaceChildren).toHaveBeenCalledWith(passthroughSlot)
    expect(host.replaceChildren).toHaveBeenCalledWith(mountElement)
  })
})
