/**
 * Lexical 0.17 relies on document-level focus and selection APIs. Mounting its
 * contenteditable inside a ShadowRoot prevents keyboard and clipboard input in
 * Obsidian's Chromium runtime, so the chat uses a strongly scoped light-DOM
 * shell instead.
 */
export function prepareChatMountSurface(host: HTMLElement): HTMLDivElement {
  if (host.shadowRoot) {
    const passthroughSlot = host.ownerDocument.createElement('slot')
    host.shadowRoot.replaceChildren(passthroughSlot)
  }

  const mountElement = host.ownerDocument.createElement('div')
  mountElement.className = 'smtcmp-shell'
  host.replaceChildren(mountElement)
  return mountElement
}
