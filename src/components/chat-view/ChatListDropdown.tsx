import * as Popover from '@radix-ui/react-popover'
import * as Tooltip from '@radix-ui/react-tooltip'
import { History, Pencil, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useDialogContainer } from '../../contexts/dialog-container-context'
import { ChatConversationMetadata } from '../../database/json/chat/types'

function TitleInput({
  title,
  onSubmit,
}: {
  title: string
  onSubmit: (title: string) => Promise<void>
}) {
  const [value, setValue] = useState(title)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.select()
      inputRef.current.scrollLeft = 0
    }
  }, [])

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      className="smtcmp-chat-list-dropdown-item-title-input"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          onSubmit(value)
        }
      }}
      autoFocus
      maxLength={100}
    />
  )
}

function ChatListItem({
  title,
  isFocused,
  isEditing,
  onMouseEnter,
  onSelect,
  onDelete,
  onStartEdit,
  onFinishEdit,
}: {
  title: string
  isFocused: boolean
  isEditing: boolean
  onMouseEnter: () => void
  onSelect: () => Promise<void>
  onDelete: () => Promise<void>
  onStartEdit: () => void
  onFinishEdit: (title: string) => Promise<void>
}) {
  const itemRef = useRef<HTMLLIElement>(null)

  useEffect(() => {
    if (isFocused && itemRef.current) {
      itemRef.current.scrollIntoView({
        block: 'nearest',
      })
    }
  }, [isFocused])

  return (
    <li
      ref={itemRef}
      onClick={onSelect}
      onMouseEnter={onMouseEnter}
      className={isFocused ? 'selected' : ''}
    >
      {isEditing ? (
        <TitleInput title={title} onSubmit={onFinishEdit} />
      ) : (
        <div className="smtcmp-chat-list-dropdown-item-title">{title}</div>
      )}
      <div className="smtcmp-chat-list-dropdown-item-actions">
        <button
          onClick={(e) => {
            e.stopPropagation()
            onStartEdit()
          }}
          className="clickable-icon smtcmp-chat-list-dropdown-item-icon"
          aria-label="Rename conversation"
        >
          <Pencil />
        </button>
        <button
          onClick={async (e) => {
            e.stopPropagation()
            await onDelete()
          }}
          className="clickable-icon smtcmp-chat-list-dropdown-item-icon"
          aria-label="Delete conversation"
        >
          <Trash2 />
        </button>
      </div>
    </li>
  )
}

export function ChatListDropdown({
  chatList,
  currentConversationId,
  onSelect,
  onDelete,
  onUpdateTitle,
}: {
  chatList: ChatConversationMetadata[]
  currentConversationId: string
  onSelect: (conversationId: string) => Promise<void>
  onDelete: (conversationId: string) => Promise<void>
  onUpdateTitle: (conversationId: string, newTitle: string) => Promise<void>
}) {
  const dialogContainer = useDialogContainer()
  const [open, setOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState<number>(0)
  const [editingId, setEditingId] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      const currentIndex = chatList.findIndex(
        (chat) => chat.id === currentConversationId,
      )
      setFocusedIndex(currentIndex === -1 ? 0 : currentIndex)
      setEditingId(null)
    }
  }, [open, chatList, currentConversationId])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowUp') {
        setFocusedIndex(Math.max(0, focusedIndex - 1))
      } else if (e.key === 'ArrowDown') {
        setFocusedIndex(Math.min(chatList.length - 1, focusedIndex + 1))
      } else if (e.key === 'Enter' && chatList[focusedIndex]) {
        onSelect(chatList[focusedIndex].id)
        setOpen(false)
      }
    },
    [chatList, focusedIndex, setFocusedIndex, onSelect],
  )

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Popover.Trigger asChild>
            <button
              type="button"
              className="smtcmp-chat-icon-button smtcmp-chat-header__action"
              aria-label="Chat history"
              aria-expanded={open}
              data-active={String(open)}
            >
              <History size={16} aria-hidden="true" />
            </button>
          </Popover.Trigger>
        </Tooltip.Trigger>
        <Tooltip.Portal container={dialogContainer}>
          <Tooltip.Content
            className="smtcmp-tooltip-content smtcmp-chat-control-tooltip"
            sideOffset={7}
          >
            Chat history
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>

      <Popover.Portal container={dialogContainer}>
        <Popover.Content
          className="smtcmp-popover smtcmp-chat-list-dropdown-content"
          onKeyDown={handleKeyDown}
        >
          <ul>
            {chatList.length === 0 ? (
              <li className="smtcmp-chat-list-dropdown-empty">
                No conversations
              </li>
            ) : (
              chatList.map((chat, index) => (
                <ChatListItem
                  key={chat.id}
                  title={chat.title}
                  isFocused={focusedIndex === index}
                  isEditing={editingId === chat.id}
                  onMouseEnter={() => {
                    setFocusedIndex(index)
                  }}
                  onSelect={async () => {
                    await onSelect(chat.id)
                    setOpen(false)
                  }}
                  onDelete={async () => {
                    await onDelete(chat.id)
                  }}
                  onStartEdit={() => {
                    setEditingId(chat.id)
                  }}
                  onFinishEdit={async (title) => {
                    await onUpdateTitle(chat.id, title)
                    setEditingId(null)
                  }}
                />
              ))
            )}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
