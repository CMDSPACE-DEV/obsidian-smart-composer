import {
  InitialConfigType,
  InitialEditorStateType,
  LexicalComposer,
} from '@lexical/react/LexicalComposer'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { EditorRefPlugin } from '@lexical/react/LexicalEditorRefPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { LexicalEditor, SerializedEditorState } from 'lexical'
import { RefObject, useCallback, useEffect } from 'react'

import { useApp } from '../../../contexts/app-context'
import { useSettings } from '../../../contexts/settings-context'
import {
  RESEARCH_PACKS,
  getResearchSource,
} from '../../../core/research/ResearchSourceRegistry'
import { MentionableImage } from '../../../types/mentionable'
import type { ResearchSourceId } from '../../../types/research.types'
import {
  fuzzySearch,
  fuzzySearchWithConnections,
} from '../../../utils/fuzzy-search'

import DragDropPaste from './plugins/image/DragDropPastePlugin'
import ImagePastePlugin from './plugins/image/ImagePastePlugin'
import AutoLinkMentionPlugin from './plugins/mention/AutoLinkMentionPlugin'
import { MentionNode } from './plugins/mention/MentionNode'
import MentionPlugin from './plugins/mention/MentionPlugin'
import NoFormatPlugin from './plugins/no-format/NoFormatPlugin'
import OnEnterPlugin from './plugins/on-enter/OnEnterPlugin'
import OnMutationPlugin, {
  NodeMutations,
} from './plugins/on-mutation/OnMutationPlugin'
import CreateTemplatePopoverPlugin from './plugins/template/CreateTemplatePopoverPlugin'
import TemplatePlugin from './plugins/template/TemplatePlugin'

export type LexicalContentEditableProps = {
  editorRef: RefObject<LexicalEditor>
  contentEditableRef: RefObject<HTMLDivElement>
  onChange?: (content: SerializedEditorState) => void
  onEnter?: (evt: KeyboardEvent) => void
  onFocus?: () => void
  onMentionNodeMutation?: (mutations: NodeMutations<MentionNode>) => void
  onCreateImageMentionables?: (mentionables: MentionableImage[]) => void
  initialEditorState?: InitialEditorStateType
  autoFocus?: boolean
  includeMcpConnections?: boolean
  plugins?: {
    onEnter?: {
      onVaultChat: () => void
    }
    templatePopover?: {
      anchorElement: HTMLElement | null
    }
  }
}

export default function LexicalContentEditable({
  editorRef,
  contentEditableRef,
  onChange,
  onEnter,
  onFocus,
  onMentionNodeMutation,
  onCreateImageMentionables,
  initialEditorState,
  autoFocus = false,
  includeMcpConnections = false,
  plugins,
}: LexicalContentEditableProps) {
  const app = useApp()
  const { settings } = useSettings()

  const initialConfig: InitialConfigType = {
    namespace: 'LexicalContentEditable',
    theme: {
      root: 'smtcmp-lexical-content-editable-root',
      paragraph: 'smtcmp-lexical-content-editable-paragraph',
    },
    nodes: [MentionNode],
    editorState: initialEditorState,
    onError: (error) => {
      console.error(error)
    },
  }

  const searchResultByQuery = useCallback(
    (query: string) =>
      includeMcpConnections
        ? fuzzySearchWithConnections(
            app,
            query,
            settings.mcp.connections
              .filter((connection) => connection.enabled)
              .map((connection) => ({
                type: 'connection' as const,
                connectionId: connection.id,
                name: connection.name,
              })),
            [
              ...(Object.keys(settings.research.sources) as ResearchSourceId[])
                .filter(
                  (sourceId) => settings.research.sources[sourceId]?.enabled,
                )
                .map((sourceId) => ({
                  type: 'research-source' as const,
                  sourceId,
                  name: getResearchSource(sourceId).name,
                })),
              ...RESEARCH_PACKS.filter((pack) =>
                pack.sourceIds.some(
                  (sourceId) => settings.research.sources[sourceId]?.enabled,
                ),
              ).map((pack) => ({
                type: 'research-pack' as const,
                packId: pack.id,
                name: pack.name,
              })),
            ],
          )
        : fuzzySearch(app, query),
    [
      app,
      includeMcpConnections,
      settings.mcp.connections,
      settings.research.sources,
    ],
  )

  /*
   * Using requestAnimationFrame for autoFocus instead of using editor.focus()
   * due to known issues with editor.focus() when initialConfig.editorState is set
   * See: https://github.com/facebook/lexical/issues/4460
   */
  useEffect(() => {
    if (autoFocus) {
      requestAnimationFrame(() => {
        contentEditableRef.current?.focus()
      })
    }
  }, [autoFocus, contentEditableRef])

  return (
    <LexicalComposer initialConfig={initialConfig}>
      {/* 
            There was two approach to make mentionable node copy and pasteable.
            1. use RichTextPlugin and reset text format when paste
              - so I implemented NoFormatPlugin to reset text format when paste
            2. use PlainTextPlugin and override paste command
              - PlainTextPlugin only pastes text, so we need to implement custom paste handler.
              - https://github.com/facebook/lexical/discussions/5112
           */}
      <RichTextPlugin
        contentEditable={
          <ContentEditable
            className="obsidian-default-textarea"
            style={{
              background: 'transparent',
            }}
            onFocus={onFocus}
            ref={contentEditableRef}
          />
        }
        ErrorBoundary={LexicalErrorBoundary}
      />
      <HistoryPlugin />
      <MentionPlugin searchResultByQuery={searchResultByQuery} />
      <OnChangePlugin
        onChange={(editorState) => {
          onChange?.(editorState.toJSON())
        }}
      />
      {onEnter && (
        <OnEnterPlugin
          onEnter={onEnter}
          onVaultChat={plugins?.onEnter?.onVaultChat}
        />
      )}
      <OnMutationPlugin
        nodeClass={MentionNode}
        onMutation={(mutations) => {
          onMentionNodeMutation?.(mutations)
        }}
      />
      <EditorRefPlugin editorRef={editorRef} />
      <NoFormatPlugin />
      <AutoLinkMentionPlugin />
      <ImagePastePlugin onCreateImageMentionables={onCreateImageMentionables} />
      <DragDropPaste onCreateImageMentionables={onCreateImageMentionables} />
      <TemplatePlugin />
      {plugins?.templatePopover && (
        <CreateTemplatePopoverPlugin
          app={app}
          anchorElement={plugins.templatePopover.anchorElement}
          contentEditableElement={contentEditableRef.current}
        />
      )}
    </LexicalComposer>
  )
}
