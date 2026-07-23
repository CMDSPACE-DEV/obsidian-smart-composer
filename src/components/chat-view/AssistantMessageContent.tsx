import React, { useMemo } from 'react'

import { ChatAssistantMessage } from '../../types/chat'
import {
  ParsedTagContent,
  parseTagContents,
} from '../../utils/chat/parse-tag-content'

import AssistantMessageReasoning from './AssistantMessageReasoning'
import MarkdownCodeComponent from './MarkdownCodeComponent'
import MarkdownReferenceBlock from './MarkdownReferenceBlock'
import { StableObsidianMarkdown } from './ObsidianMarkdown'

export default function AssistantMessageContent({
  content,
  isStreaming = false,
}: {
  content: ChatAssistantMessage['content']
  isStreaming?: boolean
}) {
  return (
    <AssistantTextRenderer isStreaming={isStreaming}>
      {content}
    </AssistantTextRenderer>
  )
}

const AssistantTextRenderer = React.memo(function AssistantTextRenderer({
  children,
  isStreaming,
}: {
  children: string
  isStreaming: boolean
}) {
  const blocks: ParsedTagContent[] = useMemo(
    () => parseTagContents(children),
    [children],
  )

  return (
    <>
      {blocks.map((block, index) =>
        block.type === 'string' ? (
          <div key={index}>
            <StableObsidianMarkdown
              content={block.content}
              scale="sm"
              active={isStreaming && index === blocks.length - 1}
            />
          </div>
        ) : block.type === 'think' ? (
          <AssistantMessageReasoning key={index} reasoning={block.content} />
        ) : block.startLine && block.endLine && block.filename ? (
          <MarkdownReferenceBlock
            key={index}
            filename={block.filename}
            startLine={block.startLine}
            endLine={block.endLine}
          />
        ) : (
          <MarkdownCodeComponent
            key={index}
            language={block.language}
            filename={block.filename}
          >
            {block.content}
          </MarkdownCodeComponent>
        ),
      )}
    </>
  )
})
