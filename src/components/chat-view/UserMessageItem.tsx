import { SerializedEditorState } from 'lexical'
import { Paperclip, Pencil, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { ChatUserMessage } from '../../types/chat'
import { Mentionable } from '../../types/mentionable'
import { getMentionableName } from '../../utils/chat/mentionable'

import ChatUserInput, { ChatUserInputRef } from './chat-input/ChatUserInput'
import { editorStateToPlainText } from './chat-input/utils/editor-state-to-plain-text'
import SimilaritySearchResults from './SimilaritySearchResults'

export type UserMessageItemProps = {
  message: ChatUserMessage
  chatUserInputRef: (ref: ChatUserInputRef | null) => void
  onSubmit: (
    content: SerializedEditorState,
    useVaultSearch: boolean,
    mentionables: Mentionable[],
  ) => void
  onFocus: () => void
}

function summarizeMentionables(mentionables: Mentionable[]): string {
  const names = mentionables
    .filter(
      (mentionable) =>
        mentionable.type !== 'current-file' || mentionable.file !== null,
    )
    .map(getMentionableName)

  if (names.length <= 2) return names.join(' · ')
  return `${names.slice(0, 2).join(' · ')} +${names.length - 2}`
}

export default function UserMessageItem({
  message,
  chatUserInputRef,
  onSubmit,
  onFocus,
}: UserMessageItemProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [draftContent, setDraftContent] = useState(message.content)
  const [draftMentionables, setDraftMentionables] = useState(
    message.mentionables,
  )

  useEffect(() => {
    if (isEditing) return
    setDraftContent(message.content)
    setDraftMentionables(message.mentionables)
  }, [isEditing, message.content, message.mentionables])

  const plainText = useMemo(
    () => (message.content ? editorStateToPlainText(message.content) : ''),
    [message.content],
  )
  const mentionSummary = useMemo(
    () => summarizeMentionables(message.mentionables),
    [message.mentionables],
  )

  const cancelEditing = () => {
    setDraftContent(message.content)
    setDraftMentionables(message.mentionables)
    setIsEditing(false)
  }

  return (
    <div className="smtcmp-chat-messages-user">
      {isEditing ? (
        <div className="smtcmp-user-message-editor">
          <button
            type="button"
            className="smtcmp-user-message-editor__cancel clickable-icon"
            aria-label="Cancel editing message"
            title="Cancel editing"
            onClick={cancelEditing}
          >
            <X size={14} />
          </button>
          <ChatUserInput
            ref={chatUserInputRef}
            initialSerializedEditorState={draftContent}
            onChange={setDraftContent}
            onSubmit={(content, useVaultSearch = false) => {
              setIsEditing(false)
              onSubmit(content, useVaultSearch, draftMentionables)
            }}
            onFocus={onFocus}
            mentionables={draftMentionables}
            setMentionables={setDraftMentionables}
            autoFocus
            purpose="message-edit"
          />
        </div>
      ) : (
        <div className="smtcmp-user-message-bubble">
          {mentionSummary && (
            <div
              className="smtcmp-user-message-bubble__mentions"
              title={message.mentionables.map(getMentionableName).join('\n')}
            >
              <Paperclip size={12} />
              <span>{mentionSummary}</span>
            </div>
          )}
          <div className="smtcmp-user-message-bubble__text">{plainText}</div>
          <button
            type="button"
            className="smtcmp-user-message-bubble__edit"
            aria-label="Edit message"
            title="Edit message"
            onClick={() => setIsEditing(true)}
          >
            <Pencil size={13} />
          </button>
        </div>
      )}
      {message.similaritySearchResults && (
        <SimilaritySearchResults
          similaritySearchResults={message.similaritySearchResults}
          retrievalMetadata={message.retrievalMetadata}
        />
      )}
    </div>
  )
}
