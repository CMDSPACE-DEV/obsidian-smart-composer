import { App, TFile, htmlToMarkdown, requestUrl } from 'obsidian'

import { editorStateToPlainText } from '../../components/chat-view/chat-input/utils/editor-state-to-plain-text'
import { QueryProgressState } from '../../components/chat-view/QueryProgress'
import { PROVIDER_TYPES_INFO } from '../../constants'
import {
  LLMAPIKeyInvalidException,
  LLMAPIKeyNotSetException,
  LLMBaseUrlNotSetException,
} from '../../core/llm/exception'
import { processQueryWithExhaustiveFolderRead } from '../../core/rag/exhaustiveFolderRead'
import { processQueryWithPlanRerank } from '../../core/rag/planRerank'
import { RAGEngine } from '../../core/rag/ragEngine'
import { SelectEmbedding } from '../../database/schema'
import { SmartComposerSettings } from '../../settings/schema/setting.types'
import {
  ChatAssistantMessage,
  ChatMessage,
  ChatToolMessage,
  ChatUserMessage,
  RetrievalMetadata,
} from '../../types/chat'
import { ContentPart, RequestMessage } from '../../types/llm/request'
import {
  MentionableBlock,
  MentionableFile,
  MentionableFolder,
  MentionableImage,
  MentionableUrl,
  MentionableVault,
} from '../../types/mentionable'
import { PromptLevel } from '../../types/prompt-level.types'
import { ToolCallResponseStatus } from '../../types/tool-call.types'
import { tokenCount } from '../llm/token'
import {
  getNestedFiles,
  readMultipleTFiles,
  readTFileContent,
} from '../obsidian'

import { YoutubeTranscript, isYoutubeUrl } from './youtube-transcript'

type RetrievalResponse = {
  filePrompt: string
  similaritySearchResults: (Omit<SelectEmbedding, 'embedding'> & {
    similarity: number
  })[]
  retrievalMetadata: RetrievalMetadata
}

export class PromptGenerator {
  private getRagEngine: () => Promise<RAGEngine>
  private app: App
  private settings: SmartComposerSettings
  private setSettings?: (
    newSettings: SmartComposerSettings,
  ) => void | Promise<void>
  private MAX_CONTEXT_MESSAGES = 20

  constructor(
    getRagEngine: () => Promise<RAGEngine>,
    app: App,
    settings: SmartComposerSettings,
    setSettings?: (newSettings: SmartComposerSettings) => void | Promise<void>,
  ) {
    this.getRagEngine = getRagEngine
    this.app = app
    this.settings = settings
    this.setSettings = setSettings
  }

  public async generateRequestMessages({
    messages,
  }: {
    messages: ChatMessage[]
  }): Promise<RequestMessage[]> {
    if (messages.length === 0) {
      throw new Error('No messages provided')
    }

    // Ensure all user messages have prompt content
    // This is a fallback for cases where compilation was missed earlier in the process
    const compiledMessages = await Promise.all(
      messages.map(async (message) => {
        if (message.role === 'user' && !message.promptContent) {
          const { promptContent, similaritySearchResults, retrievalMetadata } =
            await this.compileUserMessagePrompt({
              message,
            })
          return {
            ...message,
            promptContent,
            similaritySearchResults,
            retrievalMetadata,
          }
        }
        return message
      }),
    )

    // find last user message
    let lastUserMessage: ChatUserMessage | undefined = undefined
    for (let i = compiledMessages.length - 1; i >= 0; --i) {
      if (compiledMessages[i].role === 'user') {
        lastUserMessage = compiledMessages[i] as ChatUserMessage
        break
      }
    }
    if (!lastUserMessage) {
      throw new Error('No user messages found')
    }
    const shouldUseRAG = lastUserMessage.similaritySearchResults !== undefined

    const systemMessage = this.getSystemMessage(shouldUseRAG)

    const customInstructionMessage = this.getCustomInstructionMessage()

    const currentFile = lastUserMessage.mentionables.find(
      (m) => m.type === 'current-file',
    )?.file
    const currentFileMessage =
      currentFile && this.settings.chatOptions.includeCurrentFileContent
        ? await this.getCurrentFileMessage(currentFile)
        : undefined

    const requestMessages: RequestMessage[] = [
      systemMessage,
      ...(customInstructionMessage ? [customInstructionMessage] : []),
      ...(currentFileMessage ? [currentFileMessage] : []),
      ...this.getChatHistoryMessages({ messages: compiledMessages }),
      ...(shouldUseRAG && this.getModelPromptLevel() == PromptLevel.Default
        ? [this.getRagInstructionMessage()]
        : []),
    ]

    return requestMessages
  }

  private getChatHistoryMessages({
    messages,
  }: {
    messages: ChatMessage[]
  }): RequestMessage[] {
    // Get the last MAX_CONTEXT_MESSAGES messages and parse them into request messages
    const requestMessages: RequestMessage[] = messages
      .slice(-this.MAX_CONTEXT_MESSAGES)
      .flatMap((message): RequestMessage[] => {
        if (message.role === 'user') {
          // We assume that all user messages have been compiled
          return [
            {
              role: 'user',
              content: message.promptContent ?? '',
            },
          ]
        } else if (message.role === 'assistant') {
          return this.parseAssistantMessage({ message })
        } else {
          // message.role === 'tool'
          return this.parseToolMessage({ message })
        }
      })

    return repairToolCallSets(requestMessages)
  }

  private parseAssistantMessage({
    message,
  }: {
    message: ChatAssistantMessage
  }): RequestMessage[] {
    let citationContent: string | null = null
    if (message.annotations && message.annotations.length > 0) {
      citationContent = `Citations:
${message.annotations
  .map((annotation, index) => {
    if (annotation.type === 'url_citation') {
      const { url, title } = annotation.url_citation
      return `[${index + 1}] ${title ? `${title}: ` : ''}${url}`
    }
  })
  .join('\n')}`
    }

    return [
      {
        role: 'assistant',
        content: [
          message.content,
          ...(citationContent ? [citationContent] : []),
        ].join('\n'),
        tool_calls: message.toolCallRequests,
        providerMetadata: message.providerMetadata,
      },
    ]
  }

  private parseToolMessage({
    message,
  }: {
    message: ChatToolMessage
  }): RequestMessage[] {
    return message.toolCalls.map((toolCall) => {
      switch (toolCall.response.status) {
        case ToolCallResponseStatus.PendingApproval:
        case ToolCallResponseStatus.Running:
        case ToolCallResponseStatus.Rejected:
        case ToolCallResponseStatus.Aborted:
          return {
            role: 'tool',
            tool_call: toolCall.request,
            content: `Tool call ${toolCall.request.id} is ${toolCall.response.status}`,
          }
        case ToolCallResponseStatus.Success:
          return {
            role: 'tool',
            tool_call: toolCall.request,
            content: toolCall.response.data.text,
          }
        case ToolCallResponseStatus.Error:
          return {
            role: 'tool',
            tool_call: toolCall.request,
            content: `Error: ${toolCall.response.error}`,
          }
      }
    })
  }

  public async compileUserMessagePrompt({
    message,
    useVaultSearch,
    onQueryProgressChange,
  }: {
    message: ChatUserMessage
    useVaultSearch?: boolean
    onQueryProgressChange?: (queryProgress: QueryProgressState) => void
  }): Promise<{
    promptContent: ChatUserMessage['promptContent']
    shouldUseRAG: boolean
    similaritySearchResults?: (Omit<SelectEmbedding, 'embedding'> & {
      similarity: number
    })[]
    retrievalMetadata?: RetrievalMetadata
  }> {
    try {
      if (!message.content) {
        return {
          promptContent: '',
          shouldUseRAG: false,
        }
      }
      const query = editorStateToPlainText(message.content)
      let similaritySearchResults = undefined
      let retrievalMetadata = undefined

      useVaultSearch =
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        useVaultSearch ||
        message.mentionables.some(
          (m): m is MentionableVault => m.type === 'vault',
        )

      onQueryProgressChange?.({
        type: 'reading-mentionables',
      })
      const files = message.mentionables
        .filter((m): m is MentionableFile => m.type === 'file')
        .map((m) => m.file)
      const folders = message.mentionables
        .filter((m): m is MentionableFolder => m.type === 'folder')
        .map((m) => m.folder)
      const nestedFiles = folders.flatMap((folder) =>
        getNestedFiles(folder, this.app.vault),
      )
      const allFiles = [...files, ...nestedFiles]
      const fileContents = await readMultipleTFiles(allFiles, this.app.vault)
      const scopeType = this.getScopeType({
        useVaultSearch,
        files,
        folders,
      })
      const shouldUseExhaustiveRead = this.shouldUseExhaustiveRead({
        query,
        useVaultSearch,
        files,
        folders,
      })

      // Count tokens incrementally to avoid long processing times on large content sets
      const exceedsTokenThreshold = async () => {
        let accTokenCount = 0
        for (const content of fileContents) {
          const count = await tokenCount(content)
          accTokenCount += count
          if (accTokenCount > this.settings.ragOptions.thresholdTokens) {
            return true
          }
        }
        return false
      }
      const shouldUseRAG =
        shouldUseExhaustiveRead ||
        useVaultSearch ||
        (await exceedsTokenThreshold())

      let filePrompt: string
      if (shouldUseRAG) {
        const retrievalResponse = await this.processRagQuery({
          query,
          useVaultSearch,
          files: allFiles,
          scopeType,
          shouldUseExhaustiveRead,
          scope: {
            files: files.map((f) => f.path),
            folders: folders.map((f) => f.path),
          },
          onQueryProgressChange,
        })
        filePrompt = retrievalResponse.filePrompt
        similaritySearchResults = retrievalResponse.similaritySearchResults
        retrievalMetadata = retrievalResponse.retrievalMetadata
      } else {
        filePrompt = allFiles
          .map((file, index) => {
            return `\`\`\`${file.path}\n${fileContents[index]}\n\`\`\`\n`
          })
          .join('')
      }

      const blocks = message.mentionables.filter(
        (m): m is MentionableBlock => m.type === 'block',
      )
      const blockPrompt = blocks
        .map(({ file, content }) => {
          return `\`\`\`${file.path}\n${content}\n\`\`\`\n`
        })
        .join('')

      const urls = message.mentionables.filter(
        (m): m is MentionableUrl => m.type === 'url',
      )

      const urlPrompt =
        urls.length > 0
          ? `## Potentially Relevant Websearch Results
${(
  await Promise.all(
    urls.map(
      async ({ url }) => `\`\`\`
Website URL: ${url}
Website Content:
${await this.getWebsiteContent(url)}
\`\`\``,
    ),
  )
).join('\n')}
`
          : ''

      const imageDataUrls = message.mentionables
        .filter((m): m is MentionableImage => m.type === 'image')
        .map(({ data }) => data)

      // Reset query progress
      onQueryProgressChange?.({
        type: 'idle',
      })

      return {
        promptContent: [
          ...imageDataUrls.map(
            (data): ContentPart => ({
              type: 'image_url',
              image_url: {
                url: data,
              },
            }),
          ),
          {
            type: 'text',
            text: `${filePrompt}${blockPrompt}${urlPrompt}\n\n${query}\n\n`,
          },
        ],
        shouldUseRAG,
        similaritySearchResults: similaritySearchResults,
        retrievalMetadata,
      }
    } catch (error) {
      console.error('Failed to compile user message', error)
      onQueryProgressChange?.({
        type: 'idle',
      })
      throw error
    }
  }

  private async processRagQuery({
    query,
    useVaultSearch,
    files,
    scopeType,
    shouldUseExhaustiveRead,
    scope,
    onQueryProgressChange,
  }: {
    query: string
    useVaultSearch?: boolean
    files: TFile[]
    scopeType: RetrievalMetadata['scopeType']
    shouldUseExhaustiveRead: boolean
    scope: {
      files: string[]
      folders: string[]
    }
    onQueryProgressChange?: (queryProgress: QueryProgressState) => void
  }): Promise<RetrievalResponse> {
    const retrievalMode = this.settings.ragOptions.retrievalMode

    if (shouldUseExhaustiveRead) {
      const exhaustiveResponse = await processQueryWithExhaustiveFolderRead({
        app: this.app,
        settings: this.settings,
        setSettings: this.setSettings,
        query,
        files: useVaultSearch ? undefined : files,
        scopeType,
        onQueryProgressChange,
      })
      return {
        filePrompt: exhaustiveResponse.promptText,
        similaritySearchResults: exhaustiveResponse.similaritySearchResults,
        retrievalMetadata: exhaustiveResponse.retrievalMetadata,
      }
    }

    if (
      retrievalMode === 'plan-rerank' ||
      (retrievalMode === 'auto' && !this.canUseEmbeddingRetrieval())
    ) {
      return this.processPlanRerankQuery({
        query,
        useVaultSearch,
        files,
        scopeType,
        onQueryProgressChange,
      })
    }

    try {
      const similaritySearchResults = useVaultSearch
        ? await (
            await this.getRagEngine()
          ).processQuery({
            query,
            onQueryProgressChange: onQueryProgressChange,
          })
        : await (
            await this.getRagEngine()
          ).processQuery({
            query,
            scope,
            onQueryProgressChange: onQueryProgressChange,
          })
      return {
        filePrompt: this.buildSelectedSnippetPrompt({
          modeLabel: 'embedding database selected snippets',
          similaritySearchResults,
        }),
        similaritySearchResults,
        retrievalMetadata: {
          retrievalMode: 'embedding',
          scopeType,
          totalFilesRead: useVaultSearch
            ? this.app.vault.getMarkdownFiles().length
            : files.length,
          totalChunksBuilt: similaritySearchResults.length,
          candidateChunks: similaritySearchResults.length,
          selectedChunks: similaritySearchResults.length,
          exhaustive: false,
        },
      }
    } catch (error) {
      if (retrievalMode === 'auto' && this.isEmbeddingUnavailableError(error)) {
        return this.processPlanRerankQuery({
          query,
          useVaultSearch,
          files,
          scopeType,
          onQueryProgressChange,
        })
      }
      throw error
    }
  }

  private async processPlanRerankQuery({
    query,
    useVaultSearch,
    files,
    scopeType,
    onQueryProgressChange,
  }: {
    query: string
    useVaultSearch?: boolean
    files: TFile[]
    scopeType: RetrievalMetadata['scopeType']
    onQueryProgressChange?: (queryProgress: QueryProgressState) => void
  }): Promise<RetrievalResponse> {
    const { results, retrievalMetadata } = await processQueryWithPlanRerank({
      app: this.app,
      settings: this.settings,
      setSettings: this.setSettings,
      query,
      files: useVaultSearch ? undefined : files,
      scopeType,
      onQueryProgressChange,
    })
    return {
      filePrompt: this.buildSelectedSnippetPrompt({
        modeLabel: 'plan-rerank selected snippets',
        similaritySearchResults: results,
      }),
      similaritySearchResults: results,
      retrievalMetadata,
    }
  }

  private buildSelectedSnippetPrompt({
    modeLabel,
    similaritySearchResults,
  }: {
    modeLabel: string
    similaritySearchResults: (Omit<SelectEmbedding, 'embedding'> & {
      similarity: number
    })[]
  }) {
    return `## Context Handling Metadata
Context mode: ${modeLabel}
Context scope: only the selected snippets below were provided to the final answer model.

## Potentially Relevant Snippets from the current vault
${similaritySearchResults
  .map(({ path, content, metadata }) => {
    const newContent =
      this.getModelPromptLevel() == PromptLevel.Default
        ? this.addLineNumbersToContent({
            content,
            startLine: metadata.startLine,
          })
        : content
    return `\`\`\`${path}\n${newContent}\n\`\`\`\n`
  })
  .join('')}\n`
  }

  private getScopeType({
    useVaultSearch,
    files: _files,
    folders,
  }: {
    useVaultSearch?: boolean
    files: MentionableFile['file'][]
    folders: MentionableFolder['folder'][]
  }): RetrievalMetadata['scopeType'] {
    if (useVaultSearch) {
      return 'vault'
    }
    if (folders.length > 0) {
      return 'folders'
    }
    return 'files'
  }

  private shouldUseExhaustiveRead({
    query,
    useVaultSearch,
    files,
    folders,
  }: {
    query: string
    useVaultSearch?: boolean
    files: MentionableFile['file'][]
    folders: MentionableFolder['folder'][]
  }): boolean {
    if (!useVaultSearch && files.length === 0 && folders.length === 0) {
      return false
    }

    switch (this.settings.ragOptions.folderReadMode) {
      case 'exhaustive':
        return true
      case 'focused':
        return false
      case 'auto':
        return isExhaustiveReadIntent(query)
    }
  }

  private canUseEmbeddingRetrieval(): boolean {
    const embeddingModel = this.settings.embeddingModels.find(
      (model) => model.id === this.settings.embeddingModelId,
    )
    if (!embeddingModel) {
      return false
    }

    const provider = this.settings.providers.find(
      (item) => item.id === embeddingModel.providerId,
    )
    if (!provider) {
      return false
    }

    const providerInfo = PROVIDER_TYPES_INFO[provider.type]
    if (!providerInfo.supportEmbedding) {
      return false
    }
    if (providerInfo.requireApiKey && !provider.apiKey) {
      return false
    }
    if (providerInfo.requireBaseUrl && !provider.baseUrl) {
      return false
    }
    return true
  }

  private isEmbeddingUnavailableError(error: unknown): boolean {
    if (
      error instanceof LLMAPIKeyNotSetException ||
      error instanceof LLMAPIKeyInvalidException ||
      error instanceof LLMBaseUrlNotSetException
    ) {
      return true
    }

    return (
      error instanceof Error &&
      error.message.includes('does not support embeddings')
    )
  }

  private getSystemMessage(shouldUseRAG: boolean): RequestMessage {
    const modelPromptLevel = this.getModelPromptLevel()
    const systemPrompt = `You are an intelligent assistant to help answer any questions that the user has${modelPromptLevel == PromptLevel.Default ? `, particularly about editing and organizing markdown files in Obsidian` : ''}.

1. Please keep your response as concise as possible. Avoid being verbose.

2. Do not lie or make up facts.

3. Format your response in markdown.

${
  modelPromptLevel == PromptLevel.Default
    ? `4. Respond in the same language as the user's message.

5. When writing out new markdown blocks, also wrap them with <smtcmp_block> tags. For example:
<smtcmp_block language="markdown">
{{ content }}
</smtcmp_block>

6. When providing markdown blocks for an existing file, add the filename and language attributes to the <smtcmp_block> tags. Restate the relevant section or heading, so the user knows which part of the file you are editing. For example:
<smtcmp_block filename="path/to/file.md" language="markdown">
## Section Title
...
{{ content }}
...
</smtcmp_block>

7. When the user is asking for edits to their markdown, please provide a simplified version of the markdown block emphasizing only the changes. Use comments to show where unchanged content has been skipped. Wrap the markdown block with <smtcmp_block> tags. Add filename and language attributes to the <smtcmp_block> tags. For example:
<smtcmp_block filename="path/to/file.md" language="markdown">
<!-- ... existing content ... -->
{{ edit_1 }}
<!-- ... existing content ... -->
{{ edit_2 }}
<!-- ... existing content ... -->
</smtcmp_block>
The user has full access to the file, so they prefer seeing only the changes in the markdown. Often this will mean that the start/end of the file will be skipped, but that's okay! Rewrite the entire file only if specifically requested. Always provide a brief explanation of the updates, except when the user specifically asks for just the content.
`
    : ''
}`

    const systemPromptRAG = `You are an intelligent assistant to help answer any questions that the user has${modelPromptLevel == PromptLevel.Default ? `, particularly about editing and organizing markdown files in Obsidian` : ''}. You will be given your conversation history with them and potentially relevant blocks of markdown content from the current vault.
      
1. Do not lie or make up facts.

2. Format your response in markdown.

${
  modelPromptLevel == PromptLevel.Default
    ? `3. Respond in the same language as the user's message.

4. When referencing markdown blocks in your answer, keep the following guidelines in mind:

  a. Never include line numbers in the output markdown.

  b. Wrap the markdown block with <smtcmp_block> tags. Include language attribute. For example:
  <smtcmp_block language="markdown">
  {{ content }}
  </smtcmp_block>

  c. When providing markdown blocks for an existing file, also include the filename attribute to the <smtcmp_block> tags. For example:
  <smtcmp_block filename="path/to/file.md" language="markdown">
  {{ content }}
  </smtcmp_block>

  d. When referencing a markdown block the user gives you, only add the startLine and endLine attributes to the <smtcmp_block> tags. Write related content outside of the <smtcmp_block> tags. The content inside the <smtcmp_block> tags will be ignored and replaced with the actual content of the markdown block. For example:
  <smtcmp_block filename="path/to/file.md" language="markdown" startLine="2" endLine="30"></smtcmp_block>`
    : ''
}`

    return {
      role: 'system',
      content: shouldUseRAG ? systemPromptRAG : systemPrompt,
    }
  }

  private getCustomInstructionMessage(): RequestMessage | null {
    const customInstruction = this.settings.systemPrompt.trim()
    if (!customInstruction) {
      return null
    }
    return {
      role: 'user',
      content: `Here are additional instructions to follow in your responses when relevant. There's no need to explicitly acknowledge them:
<custom_instructions>
${customInstruction}
</custom_instructions>`,
    }
  }

  private async getCurrentFileMessage(
    currentFile: TFile,
  ): Promise<RequestMessage> {
    const fileContent = await readTFileContent(currentFile, this.app.vault)
    return {
      role: 'user',
      content: `# Inputs
## Current File
Here is the file I'm looking at.
\`\`\`${currentFile.path}
${fileContent}
\`\`\`\n\n`,
    }
  }

  private getRagInstructionMessage(): RequestMessage {
    return {
      role: 'user',
      content: `If you need to reference any of the markdown blocks I gave you, add the startLine and endLine attributes to the <smtcmp_block> tags without any content inside. For example:
<smtcmp_block filename="path/to/file.md" language="markdown" startLine="200" endLine="310"></smtcmp_block>

When writing out new markdown blocks, remember not to include "line_number|" at the beginning of each line.`,
    }
  }

  private addLineNumbersToContent({
    content,
    startLine,
  }: {
    content: string
    startLine: number
  }): string {
    const lines = content.split('\n')
    const linesWithNumbers = lines.map((line, index) => {
      return `${startLine + index}|${line}`
    })
    return linesWithNumbers.join('\n')
  }

  /**
   * TODO: Improve markdown conversion logic
   * - filter visually hidden elements
   * ...
   */
  private async getWebsiteContent(url: string): Promise<string> {
    if (isYoutubeUrl(url)) {
      try {
        // TODO: pass language based on user preferences
        const { title, transcript } =
          await YoutubeTranscript.fetchTranscriptAndMetadata(url)

        return `Title: ${title}
Video Transcript:
${transcript.map((t) => `${t.offset}: ${t.text}`).join('\n')}`
      } catch (error) {
        console.error('Error fetching YouTube transcript', error)
      }
    }

    const response = await requestUrl({ url })
    return htmlToMarkdown(response.text)
  }

  private getModelPromptLevel(): PromptLevel {
    const chatModel = this.settings.chatModels.find(
      (model) => model.id === this.settings.chatModelId,
    )
    return chatModel?.promptLevel ?? PromptLevel.Default
  }
}

export function repairToolCallSets(
  messages: RequestMessage[],
): RequestMessage[] {
  const results = new Map<string, Extract<RequestMessage, { role: 'tool' }>>()
  for (const message of messages) {
    if (message.role === 'tool' && !results.has(message.tool_call.id)) {
      results.set(message.tool_call.id, message)
    }
  }

  const seenCalls = new Set<string>()
  const repaired: RequestMessage[] = []
  for (const message of messages) {
    if (message.role === 'tool') {
      continue
    }
    if (message.role !== 'assistant' || !message.tool_calls?.length) {
      repaired.push(message)
      continue
    }

    const toolCalls = message.tool_calls.filter((toolCall) => {
      if (seenCalls.has(toolCall.id)) return false
      seenCalls.add(toolCall.id)
      return true
    })
    repaired.push({
      ...message,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    })
    for (const toolCall of toolCalls) {
      repaired.push(
        results.get(toolCall.id) ?? {
          role: 'tool',
          tool_call: toolCall,
          content: `Tool call ${toolCall.id} is aborted`,
        },
      )
    }
  }
  return repaired
}

function isExhaustiveReadIntent(query: string): boolean {
  const normalizedQuery = query.toLowerCase()
  return [
    /전부/,
    /전체/,
    /정독/,
    /모든\s*(노트|문서|파일)?/,
    /빠짐\s*없이/,
    /하나하나/,
    /다\s*(읽|훑|검토|정리)/,
    /\ball\b/,
    /\bevery\b/,
    /\bentire\b/,
    /\bwhole\b/,
    /read\s+(all|everything|the\s+entire)/,
  ].some((pattern) => pattern.test(normalizedQuery))
}
