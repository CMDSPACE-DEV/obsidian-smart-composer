import * as Tooltip from '@radix-ui/react-tooltip'
import clsx from 'clsx'
import type { LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes } from 'react'

import { useDialogContainer } from '../../contexts/dialog-container-context'

export type ChatIconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children'
> & {
  icon: LucideIcon
  label: string
  tooltip?: string
  shortcut?: string
  active?: boolean
  iconSize?: number
  variant?: 'default' | 'primary'
}

export function ChatIconButton({
  icon: Icon,
  label,
  tooltip = label,
  shortcut,
  active,
  iconSize = 16,
  variant = 'default',
  className,
  type = 'button',
  ...buttonProps
}: ChatIconButtonProps) {
  const dialogContainer = useDialogContainer()

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          {...buttonProps}
          type={type}
          className={clsx(
            'smtcmp-chat-icon-button',
            variant === 'primary' && 'smtcmp-chat-icon-button--primary',
            className,
          )}
          aria-label={label}
          aria-pressed={active === undefined ? undefined : active}
          data-active={active === undefined ? undefined : String(active)}
        >
          <Icon size={iconSize} aria-hidden="true" />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal container={dialogContainer}>
        <Tooltip.Content
          className="smtcmp-tooltip-content smtcmp-chat-control-tooltip"
          sideOffset={7}
        >
          <span>{tooltip}</span>
          {shortcut && (
            <kbd className="smtcmp-chat-control-tooltip__shortcut">
              {shortcut}
            </kbd>
          )}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
