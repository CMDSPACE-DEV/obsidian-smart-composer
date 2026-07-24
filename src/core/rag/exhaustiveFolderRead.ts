import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter'
import { minimatch } from 'minimatch'
import { App, TFile } from 'obsidian'

import { QueryProgressState } from '../../components/chat-view/QueryProgress'
import { SelectEmbedding, VectorMetaData } from '../../database/schema'
import { SmartComposerSettings } from '../../settings/schema/setting.types'
import { RetrievalMetadata } from '../../types/chat'
import { tokenCount } from '../../utils/llm/token'

import {
  describePlanRequestError,
  getInternalRagModel,
  shouldSurfacePlanRequestError,
} from './internalModel'

type ExhaustiveReadResult = Omit<SelectEmbedding, 'embedding'> & {
  similarity: number
}

type FileContent = {
  file: TFile
  content: string
  tokenCount: number
}

type ChunkCandidate = {
  index: number
  path: string
  mtime: number
  content: string
  metadata: VectorMetaData
  localScore: number
}

type ExhaustiveFolderReadResponse = {
  promptText: string
  similaritySearchResults: ExhaustiveReadResult[]
  retrievalMetadata: RetrievalMetadata
}

type ExhaustiveFolderReadOptions = {
  app: App
  settings: SmartComposerSettings
  setSettings?: (newSettings: SmartComposerSettings) => void | Promise<void>
  query: string
  files?: TFile[]
  scopeType: 'files' | 'folders' | 'vault'
  onQueryProgressChange?: (queryProgress: QueryProgressState) => void
}

const BATCH_CHAR_LIMIT = 12000
const BATCH_SUMMARY_MAX_TOKENS = 1200

export async function processQueryWithExhaustiveFolderRead({
  app,
  settings,
  setSettings,
  query,
  files,
  scopeType,
  onQueryProgressChange,
}: ExhaustiveFolderReadOptions): Promise<ExhaustiveFolderReadResponse> {
  const targetFiles = getTargetFiles(app, settings, files)
  const fileContents = await readFileContents(app, targetFiles)
  const totalTokens = fileContents.reduce(
    (sum, file) => sum + file.tokenCount,
    0,
  )

  if (totalTokens <= settings.ragOptions.exhaustiveDirectTokenLimit) {
    const similaritySearchResults = toFileResults(fileContents)
    return {
      promptText: buildDirectPrompt(query, fileContents),
      similaritySearchResults,
      retrievalMetadata: {
        retrievalMode: 'exhaustive-direct',
        scopeType,
        totalFilesRead: fileContents.length,
        totalChunksBuilt: fileContents.length,
        candidateChunks: fileContents.length,
        selectedChunks: similaritySearchResults.length,
        exhaustive: true,
      },
    }
  }

  const chunks = await buildChunkCandidates(settings, fileContents, query)
  const batches = chunkByCharacterBudget(chunks, BATCH_CHAR_LIMIT)

  onQueryProgressChange?.({
    type: 'plan-reranking',
  })

  const batchResults = await Promise.all(
    batches.map((batch, index) =>
      summarizeBatchWithPlan({
        settings,
        setSettings,
        query,
        batch,
        batchIndex: index,
        totalBatches: batches.length,
      }),
    ),
  )
  const batchSummaries = batchResults.map((result) => result.summary)
  const warnings = batchResults
    .map((result) => result.warning)
    .filter((warning): warning is string => !!warning)
  const representativeChunks = chunks.slice(0, settings.ragOptions.limit)
  const similaritySearchResults = toChunkResults(representativeChunks)

  return {
    promptText: buildBatchPrompt(query, batchSummaries, representativeChunks),
    similaritySearchResults,
    retrievalMetadata: {
      retrievalMode: 'exhaustive-batch',
      scopeType,
      totalFilesRead: fileContents.length,
      totalChunksBuilt: chunks.length,
      candidateChunks: chunks.length,
      selectedChunks: similaritySearchResults.length,
      exhaustive: true,
      fallbackUsed: warnings.length > 0,
      ...(warnings.length > 0
        ? { warnings: Array.from(new Set(warnings)) }
        : {}),
    },
  }
}

function getTargetFiles(
  app: App,
  settings: SmartComposerSettings,
  scopedFiles?: TFile[],
): TFile[] {
  const files = scopedFiles ?? app.vault.getMarkdownFiles()
  const uniqueFiles = Array.from(
    new Map(files.map((file) => [file.path, file])).values(),
  )

  return uniqueFiles.filter((file) => {
    if (file.extension !== 'md') {
      return false
    }
    if (
      settings.ragOptions.excludePatterns.some((pattern) =>
        minimatch(file.path, pattern),
      )
    ) {
      return false
    }
    if (settings.ragOptions.includePatterns.length === 0) {
      return true
    }
    return settings.ragOptions.includePatterns.some((pattern) =>
      minimatch(file.path, pattern),
    )
  })
}

async function readFileContents(
  app: App,
  files: TFile[],
): Promise<FileContent[]> {
  return await Promise.all(
    files.map(async (file) => {
      const content = (await app.vault.cachedRead(file))
        .split(String.fromCharCode(0))
        .join('')
      return {
        file,
        content,
        tokenCount: await tokenCount(content),
      }
    }),
  ).then((items) => items.filter((item) => item.content.trim().length > 0))
}

async function buildChunkCandidates(
  settings: SmartComposerSettings,
  fileContents: FileContent[],
  query: string,
): Promise<ChunkCandidate[]> {
  const textSplitter = RecursiveCharacterTextSplitter.fromLanguage('markdown', {
    chunkSize: settings.ragOptions.chunkSize,
  })
  const queryTerms = tokenize(query)
  const chunks = (
    await Promise.all(
      fileContents.map(async ({ file, content }) => {
        const documents = await textSplitter.createDocuments([content])
        return documents.map((document): ChunkCandidate => {
          const metadata = document.metadata.loc?.lines
          const startLine =
            typeof metadata?.from === 'number' ? metadata.from : 1
          const endLine =
            typeof metadata?.to === 'number' ? metadata.to : startLine
          return {
            index: 0,
            path: file.path,
            mtime: file.stat.mtime,
            content: document.pageContent,
            metadata: {
              startLine,
              endLine,
            },
            localScore: scoreChunk(file.path, document.pageContent, queryTerms),
          }
        })
      }),
    )
  ).flat()

  return chunks
    .sort((a, b) => {
      if (b.localScore !== a.localScore) {
        return b.localScore - a.localScore
      }
      if (b.mtime !== a.mtime) {
        return b.mtime - a.mtime
      }
      return a.path.localeCompare(b.path)
    })
    .map((chunk, index) => ({ ...chunk, index }))
}

function chunkByCharacterBudget(
  chunks: ChunkCandidate[],
  charLimit: number,
): ChunkCandidate[][] {
  const batches: ChunkCandidate[][] = []
  let currentBatch: ChunkCandidate[] = []
  let currentLength = 0

  for (const chunk of chunks) {
    const nextLength = chunk.content.length + chunk.path.length + 80
    if (currentBatch.length > 0 && currentLength + nextLength > charLimit) {
      batches.push(currentBatch)
      currentBatch = []
      currentLength = 0
    }
    currentBatch.push(chunk)
    currentLength += nextLength
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch)
  }
  return batches
}

async function summarizeBatchWithPlan({
  settings,
  setSettings,
  query,
  batch,
  batchIndex,
  totalBatches,
}: {
  settings: SmartComposerSettings
  setSettings?: (newSettings: SmartComposerSettings) => void | Promise<void>
  query: string
  batch: ChunkCandidate[]
  batchIndex: number
  totalBatches: number
}): Promise<{ summary: string; warning?: string }> {
  const { getChatModelClient } = await import('../llm/manager')
  const { providerClient, model } = getChatModelClient({
    modelId: settings.chatModelId,
    settings,
    setSettings: setSettings ?? (() => undefined),
  })
  const summaryModel = getInternalRagModel(model)

  try {
    const response = await providerClient.generateResponse(summaryModel, {
      model: model.model,
      messages: [
        {
          role: 'system',
          content:
            'You are reading every provided markdown chunk as part of an exhaustive folder review. Create a concise query-focused summary. Mention file names and line ranges for important evidence. Do not claim you read files outside this batch.',
        },
        {
          role: 'user',
          content: `Query:
${query}

Batch ${batchIndex + 1} of ${totalBatches}.

Chunks:
${batch.map(formatChunkForBatch).join('\n\n')}`,
        },
      ],
      temperature: 0,
      max_tokens: BATCH_SUMMARY_MAX_TOKENS,
    })
    return { summary: response.choices[0]?.message.content ?? '' }
  } catch (error) {
    if (shouldSurfacePlanRequestError(error)) {
      throw error
    }
    console.warn('Exhaustive folder batch summary failed:', error)
    return {
      summary: `Batch ${batchIndex + 1} summary fallback:
${batch
  .map(
    (chunk) =>
      `- ${chunk.path} (${chunk.metadata.startLine}-${chunk.metadata.endLine}): ${chunk.content.slice(0, 300)}`,
  )
  .join('\n')}`,
      warning: describePlanRequestError(error),
    }
  }
}

function formatChunkForBatch(chunk: ChunkCandidate): string {
  return `[${chunk.index}] ${chunk.path} (${chunk.metadata.startLine}-${chunk.metadata.endLine})
${chunk.content}`
}

function buildDirectPrompt(query: string, fileContents: FileContent[]): string {
  return `## Context Handling Metadata
Context mode: exhaustive folder read
Context scope: every mentioned markdown file was included directly because it fit within the configured token limit.
User query: ${query}

## Exhaustive Folder Contents
${fileContents
  .map(({ file, content }) => `\`\`\`${file.path}\n${content}\n\`\`\``)
  .join('\n\n')}`
}

function buildBatchPrompt(
  query: string,
  batchSummaries: string[],
  representativeChunks: ChunkCandidate[],
): string {
  return `## Context Handling Metadata
Context mode: exhaustive folder read via batch summaries
Context scope: every mentioned markdown chunk was processed in a batch summary before this final answer.
User query: ${query}

## Exhaustive Batch Summaries
${batchSummaries
  .map((summary, index) => `### Batch ${index + 1}\n${summary}`)
  .join('\n\n')}

## Representative Source Snippets
${representativeChunks.map(formatChunkForFinalPrompt).join('\n\n')}`
}

function formatChunkForFinalPrompt(chunk: ChunkCandidate): string {
  return `\`\`\`${chunk.path}
${addLineNumbersToContent(chunk.content, chunk.metadata.startLine)}
\`\`\``
}

function toFileResults(fileContents: FileContent[]): ExhaustiveReadResult[] {
  return fileContents.map(({ file, content }, index) => ({
    id: index + 1,
    path: file.path,
    mtime: file.stat.mtime,
    content,
    model: 'exhaustive-direct',
    dimension: 0,
    metadata: {
      startLine: 1,
      endLine: Math.max(1, content.split('\n').length),
    },
    similarity: Math.max(0, 1 - index / Math.max(fileContents.length, 1)),
  }))
}

function toChunkResults(chunks: ChunkCandidate[]): ExhaustiveReadResult[] {
  return chunks.map((chunk, index) => ({
    id: index + 1,
    path: chunk.path,
    mtime: chunk.mtime,
    content: chunk.content,
    model: 'exhaustive-batch',
    dimension: 0,
    metadata: chunk.metadata,
    similarity: Math.max(0, 1 - index / Math.max(chunks.length, 1)),
  }))
}

function addLineNumbersToContent(content: string, startLine: number): string {
  return content
    .split('\n')
    .map((line, index) => `${startLine + index}|${line}`)
    .join('\n')
}

function tokenize(text: string): string[] {
  return Array.from(
    new Set(text.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? []),
  )
    .filter((term) => term.length > 1)
    .slice(0, 24)
}

function scoreChunk(path: string, content: string, terms: string[]): number {
  if (terms.length === 0) {
    return 0
  }

  const lowerPath = path.toLowerCase()
  const lowerContent = content.toLowerCase()
  return terms.reduce((score, term) => {
    return (
      score +
      countOccurrences(lowerPath, term) * 4 +
      countOccurrences(lowerContent, term)
    )
  }, 0)
}

function countOccurrences(text: string, term: string): number {
  let count = 0
  let index = text.indexOf(term)
  while (index !== -1) {
    count += 1
    index = text.indexOf(term, index + term.length)
  }
  return count
}
