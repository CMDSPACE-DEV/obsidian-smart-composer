import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { BrainCircuit, Check, ChevronDown, ChevronUp } from 'lucide-react'
import { Notice } from 'obsidian'
import { useId, useState } from 'react'

import { useSettings } from '../../../contexts/settings-context'

import {
  getQuickReasoningControl,
  updateQuickReasoningEffort,
} from './reasoning-effort'

export function ReasoningEffortSelect() {
  const { settings, setSettings } = useSettings()
  const [isOpen, setIsOpen] = useState(false)
  const menuLabelId = useId()
  const selectedModel = settings.chatModels.find(
    (model) => model.id === settings.chatModelId,
  )
  const control = getQuickReasoningControl(selectedModel)

  if (!selectedModel || !control) {
    return null
  }

  const handleValueChange = (value: string) => {
    const updatedModel = updateQuickReasoningEffort(selectedModel, value)
    void (async () => {
      try {
        await setSettings({
          ...settings,
          chatModels: settings.chatModels.map((model) =>
            model.id === selectedModel.id ? updatedModel : model,
          ),
        })
      } catch (error) {
        console.error('Failed to save reasoning effort', error)
        new Notice(
          'Failed to save reasoning effort. The last saved setting is being kept.',
        )
      }
    })()
  }

  const accessibleLabel = `${control.label}: ${control.value}. Click to change.`

  return (
    <DropdownMenu.Root open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenu.Trigger
        className="smtcmp-chat-input-effort-select"
        aria-label={accessibleLabel}
        title={accessibleLabel}
      >
        <BrainCircuit size={12} aria-hidden="true" />
        <span className="smtcmp-chat-input-effort-select__value">
          {control.value}
        </span>
        <span className="smtcmp-chat-input-effort-select__chevron">
          {isOpen ? (
            <ChevronUp size={10} aria-hidden="true" />
          ) : (
            <ChevronDown size={10} aria-hidden="true" />
          )}
        </span>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="smtcmp-popover smtcmp-chat-input-effort-popover"
          sideOffset={5}
          align="start"
        >
          <DropdownMenu.Label
            id={menuLabelId}
            className="smtcmp-chat-input-effort-popover__heading"
          >
            {control.label}
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            value={control.value}
            onValueChange={handleValueChange}
            aria-labelledby={menuLabelId}
          >
            {control.options.map((option) => (
              <DropdownMenu.RadioItem
                key={option.value}
                value={option.value}
                className="smtcmp-chat-input-effort-popover__item"
              >
                <span className="smtcmp-chat-input-effort-popover__check">
                  <DropdownMenu.ItemIndicator>
                    <Check size={13} aria-hidden="true" />
                  </DropdownMenu.ItemIndicator>
                </span>
                <span className="smtcmp-chat-input-effort-popover__copy">
                  <span className="smtcmp-chat-input-effort-popover__label">
                    {option.label}
                  </span>
                  <span className="smtcmp-chat-input-effort-popover__description">
                    {option.description}
                  </span>
                </span>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
