import { App, setIcon } from 'obsidian'

import {
  findMentionTrigger,
  removeMentionTrigger,
} from '../../utils/chat/mentionTrigger'
import { fuzzySearch } from '../../utils/fuzzy-search'

export type InlineVaultReference =
  | {
      type: 'file'
      path: string
    }
  | {
      type: 'folder'
      path: string
    }

export type InlineReferencePicker = {
  handleKeyDown: (event: KeyboardEvent) => boolean
  close: () => void
}

export function mountInlineReferencePicker({
  app,
  doc,
  input,
  region,
  initialReferences,
  onChange,
}: {
  app: App
  doc: Document
  input: HTMLTextAreaElement
  region: HTMLElement
  initialReferences: readonly InlineVaultReference[]
  onChange: (references: InlineVaultReference[]) => void
}): InlineReferencePicker {
  let references = [...initialReferences]
  let results: InlineVaultReference[] = []
  let selectedIndex = 0
  let menuOpen = false
  let composing = false

  const chips = doc.createElement('div')
  chips.className = 'reference-chips'
  chips.setAttribute('aria-label', 'Inline edit references')
  const list = doc.createElement('div')
  list.className = 'reference-list'
  list.id = `smtcmp-inline-references-${Math.random().toString(36).slice(2)}`
  list.setAttribute('role', 'listbox')
  list.hidden = true
  region.append(chips, list)

  const keyFor = (reference: InlineVaultReference) =>
    `${reference.type}:${reference.path}`

  const renderChips = () => {
    chips.replaceChildren()
    chips.hidden = references.length === 0
    for (const reference of references) {
      const chip = doc.createElement('span')
      chip.className = 'reference-chip'
      chip.title = reference.path
      const icon = doc.createElement('span')
      icon.className = 'reference-icon'
      setIcon(icon, reference.type === 'file' ? 'file-text' : 'folder')
      const label = doc.createElement('span')
      label.className = 'reference-chip-label'
      label.textContent = getPathName(reference.path)
      const remove = doc.createElement('button')
      remove.type = 'button'
      remove.className = 'reference-remove'
      remove.setAttribute('aria-label', `Remove ${reference.path}`)
      setIcon(remove, 'x')
      remove.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        references = references.filter(
          (candidate) => keyFor(candidate) !== keyFor(reference),
        )
        renderChips()
        onChange([...references])
        input.focus({ preventScroll: true })
      })
      chip.append(icon, label, remove)
      chips.append(chip)
    }
  }

  const close = () => {
    menuOpen = false
    results = []
    selectedIndex = 0
    list.hidden = true
    list.replaceChildren()
    input.removeAttribute('aria-activedescendant')
    input.setAttribute('aria-expanded', 'false')
  }

  const select = (reference: InlineVaultReference) => {
    if (!references.some((item) => keyFor(item) === keyFor(reference))) {
      references = [...references, reference]
      renderChips()
      onChange([...references])
    }
    const trigger = findMentionTrigger(input.value, input.selectionStart)
    if (trigger) {
      const next = removeMentionTrigger(input.value, trigger)
      input.value = next.value
      input.setSelectionRange(next.cursor, next.cursor)
      const EventConstructor = doc.defaultView?.Event ?? Event
      input.dispatchEvent(new EventConstructor('input', { bubbles: true }))
    }
    close()
    input.focus({ preventScroll: true })
  }

  const renderList = () => {
    list.replaceChildren()
    list.hidden = !menuOpen
    input.setAttribute('aria-expanded', menuOpen ? 'true' : 'false')
    if (!menuOpen) return

    results.forEach((reference, index) => {
      const option = doc.createElement('button')
      option.type = 'button'
      option.className = 'reference-option'
      option.id = `${list.id}-${index}`
      option.dataset.active = index === selectedIndex ? 'true' : 'false'
      option.setAttribute('role', 'option')
      option.setAttribute(
        'aria-selected',
        index === selectedIndex ? 'true' : 'false',
      )
      const icon = doc.createElement('span')
      icon.className = 'reference-icon'
      setIcon(icon, reference.type === 'file' ? 'file-text' : 'folder')
      const copy = doc.createElement('span')
      copy.className = 'reference-option-copy'
      const name = doc.createElement('strong')
      name.textContent = getPathName(reference.path)
      const path = doc.createElement('small')
      path.textContent = reference.path
      copy.append(name, path)
      option.append(icon, copy)
      option.addEventListener('mousedown', (event) => event.preventDefault())
      option.addEventListener('click', () => select(reference))
      option.addEventListener('mouseenter', () => {
        selectedIndex = index
        renderList()
      })
      list.append(option)
    })
    input.setAttribute('aria-activedescendant', `${list.id}-${selectedIndex}`)
  }

  const updateResults = () => {
    if (composing) return
    const trigger = findMentionTrigger(input.value, input.selectionStart)
    if (!trigger) {
      close()
      return
    }
    results = fuzzySearch(app, trigger.query)
      .filter(
        (
          mentionable,
        ): mentionable is Extract<
          typeof mentionable,
          { type: 'file' | 'folder' }
        > => mentionable.type === 'file' || mentionable.type === 'folder',
      )
      .map((mentionable) =>
        mentionable.type === 'file'
          ? {
              type: 'file' as const,
              path: mentionable.file.path,
            }
          : {
              type: 'folder' as const,
              path: mentionable.folder.path,
            },
      )
      .filter(
        (reference) =>
          !references.some((item) => keyFor(item) === keyFor(reference)),
      )
    selectedIndex = Math.min(selectedIndex, Math.max(results.length - 1, 0))
    menuOpen = results.length > 0
    renderList()
  }

  input.setAttribute('aria-controls', list.id)
  input.setAttribute('aria-autocomplete', 'list')
  input.setAttribute('aria-expanded', 'false')
  input.addEventListener('input', updateResults)
  input.addEventListener('click', updateResults)
  input.addEventListener('compositionstart', () => {
    composing = true
    close()
  })
  input.addEventListener('compositionend', () => {
    composing = false
    updateResults()
  })

  renderChips()

  return {
    close,
    handleKeyDown(event) {
      if (
        event.key === 'Backspace' &&
        !menuOpen &&
        input.selectionStart === 0 &&
        input.selectionEnd === 0 &&
        references.length > 0
      ) {
        references = references.slice(0, -1)
        renderChips()
        onChange([...references])
        event.preventDefault()
        return true
      }
      if (!menuOpen || event.isComposing || composing) return false
      if (event.key === 'ArrowDown') {
        selectedIndex = (selectedIndex + 1) % results.length
        renderList()
      } else if (event.key === 'ArrowUp') {
        selectedIndex = (selectedIndex - 1 + results.length) % results.length
        renderList()
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        select(results[selectedIndex])
      } else if (event.key === 'Escape') {
        close()
      } else {
        return false
      }
      event.preventDefault()
      return true
    },
  }
}

function getPathName(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts.at(-1) ?? path
}
