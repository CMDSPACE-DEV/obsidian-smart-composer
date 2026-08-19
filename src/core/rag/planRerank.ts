import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter'
import { minimatch } from 'minimatch'
import { App, TFile } from 'obsidian'

import { QueryProgressState } from '../../components/chat-view/QueryProgress'
import { SelectEmbedding, VectorMetaData } from '../../database/schema'
import { SmartComposerSettings } from '../../settings/schema/setting.types'
import { RetrievalMetadata } from '../../types/chat'

import {
  describePlanRequestError,
  getInternalRagModel,
  shouldSurfacePlanRequestError,
} from './internalModel'

type PlanRerankResult = Omit<SelectEmbedding, 'embedding'> & {
  similarity: number
}

type ChunkCandidate = {
  index: number
  path: string
  mtime: number
  content: string
  metadata: VectorMetaData
  localScore: number
}

type PlanRerankOptions = {
  app: App
  settings: SmartComposerSettings
  setSettings?: (newSettings: SmartComposerSettings) => void | Promise<void>
  modelId?: string
  query: string
  files?: TFile[]
  scopeType: 'files' | 'folders' | 'vault'
  signal?: AbortSignal
  onQueryProgressChange?: (queryProgress: QueryProgressState) => void
}

type PlanRerankResponse = {
  results: PlanRerankResult[]
  retrievalMetadata: RetrievalMetadata
}

export async function processQueryWithPlanRerank({
  app,
  settings,
  setSettings,
  modelId,
  query,
  files,
  scopeType,
  signal,
  onQueryProgressChange,
}: PlanRerankOptions): Promise<PlanRerankResponse> {
  throwIfAborted(signal)
  const targetFiles = getTargetFiles(app, settings, files)
  const chunks = await buildChunkCandidates(
    app,
    settings,
    targetFiles,
    query,
    signal,
  )
  throwIfAborted(signal)
  if (chunks.length === 0) {
    return {
      results: [],
      retrievalMetadata: {
        retrievalMode: 'plan-rerank',
        scopeType,
        totalFilesRead: targetFiles.length,
        totalChunksBuilt: 0,
        candidateChunks: 0,
        selectedChunks: 0,
        exhaustive: false,
      },
    }
  }

  const candidateLimit = Math.max(
    settings.ragOptions.limit,
    settings.ragOptions.planRerankCandidateLimit,
  )
  const candidates = chunks.slice(0, candidateLimit).map((chunk, index) => ({
    ...chunk,
    index,
  }))

  onQueryProgressChange?.({
    type: 'plan-reranking',
  })

  try {
    const selectedIndexes = await getPlanSelectedIndexes({
      settings,
      setSettings,
      modelId,
      query,
      candidates,
      limit: settings.ragOptions.limit,
      signal,
    })
    throwIfAborted(signal)
    const selectedCandidates = mergeSelectedWithLocalFallback(
      candidates,
      selectedIndexes,
      settings.ragOptions.limit,
    )
    const results = toRerankResults(selectedCandidates)
    onQueryProgressChange?.({
      type: 'querying-done',
      queryResult: results,
    })
    return {
      results,
      retrievalMetadata: {
        retrievalMode: 'plan-rerank',
        scopeType,
        totalFilesRead: targetFiles.length,
        totalChunksBuilt: chunks.length,
        candidateChunks: candidates.length,
        selectedChunks: results.length,
        exhaustive: false,
        fallbackUsed: false,
      },
    }
  } catch (error) {
    if (shouldSurfacePlanRequestError(error)) {
      throw error
    }
    console.warn('Plan rerank failed, using local candidate ranking:', error)
    const results = toRerankResults(
      candidates.slice(0, settings.ragOptions.limit),
    )
    onQueryProgressChange?.({
      type: 'querying-done',
      queryResult: results,
    })
    return {
      results,
      retrievalMetadata: {
        retrievalMode: 'plan-rerank',
        scopeType,
        totalFilesRead: targetFiles.length,
        totalChunksBuilt: chunks.length,
        candidateChunks: candidates.length,
        selectedChunks: results.length,
        exhaustive: false,
        fallbackUsed: true,
        warnings: [describePlanRequestError(error)],
      },
    }
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

async function buildChunkCandidates(
  app: App,
  settings: SmartComposerSettings,
  files: TFile[],
  query: string,
  signal?: AbortSignal,
): Promise<ChunkCandidate[]> {
  const textSplitter = RecursiveCharacterTextSplitter.fromLanguage('markdown', {
    chunkSize: settings.ragOptions.chunkSize,
  })
  const queryTerms = tokenize(query)
  const chunks = (
    await Promise.all(
      files.map(async (file) => {
        throwIfAborted(signal)
        const fileContent = await app.vault.cachedRead(file)
        throwIfAborted(signal)
        const sanitizedContent = fileContent
          .split(String.fromCharCode(0))
          .join('')
        if (!sanitizedContent.trim()) {
          return []
        }

        const documents = await textSplitter.createDocuments([sanitizedContent])
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

  return chunks.sort((a, b) => {
    if (b.localScore !== a.localScore) {
      return b.localScore - a.localScore
    }
    if (b.mtime !== a.mtime) {
      return b.mtime - a.mtime
    }
    return a.path.localeCompare(b.path)
  })
}

async function getPlanSelectedIndexes({
  settings,
  setSettings,
  modelId,
  query,
  candidates,
  limit,
  signal,
}: {
  settings: SmartComposerSettings
  setSettings?: (newSettings: SmartComposerSettings) => void | Promise<void>
  modelId?: string
  query: string
  candidates: ChunkCandidate[]
  limit: number
  signal?: AbortSignal
}): Promise<number[]> {
  throwIfAborted(signal)
  const { getChatModelClient } = await import('../../core/llm/manager')
  const { providerClient, model } = getChatModelClient({
    modelId: modelId ?? settings.chatModelId,
    settings,
    setSettings: setSettings ?? (() => undefined),
  })
  const rerankModel = getInternalRagModel(model)

  const request = {
    model: model.model,
    messages: [
      {
        role: 'system' as const,
        content:
          'Select the markdown snippets that best answer the user query. Return only compact JSON in the shape {"indices":[0,1,2]}. Use candidate indices exactly as given.',
      },
      {
        role: 'user' as const,
        content: `Query:
${query}

Return up to ${limit} candidate indices.

Candidates:
${candidates.map(formatCandidateForRerank).join('\n\n')}`,
      },
    ],
    temperature: 0,
    max_tokens: 512,
  }
  const response = signal
    ? await providerClient.generateResponse(rerankModel, request, { signal })
    : await providerClient.generateResponse(rerankModel, request)

  const content = response.choices[0]?.message.content ?? ''
  return parseSelectedIndexes(content, candidates.length, limit)
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError')
  }
}

function formatCandidateForRerank(candidate: ChunkCandidate): string {
  return `[${candidate.index}] ${candidate.path} (${candidate.metadata.startLine}-${candidate.metadata.endLine})
${candidate.content.slice(0, 1400)}`
}

function mergeSelectedWithLocalFallback(
  candidates: ChunkCandidate[],
  selectedIndexes: number[],
  limit: number,
): ChunkCandidate[] {
  const selected = selectedIndexes
    .map((index) => candidates[index])
    .filter((candidate): candidate is ChunkCandidate => !!candidate)

  const selectedPaths = new Set(
    selected.map(
      (candidate) =>
        `${candidate.path}:${candidate.metadata.startLine}:${candidate.metadata.endLine}`,
    ),
  )
  const fallback = candidates.filter(
    (candidate) =>
      !selectedPaths.has(
        `${candidate.path}:${candidate.metadata.startLine}:${candidate.metadata.endLine}`,
      ),
  )

  return [...selected, ...fallback].slice(0, limit)
}

function toRerankResults(candidates: ChunkCandidate[]): PlanRerankResult[] {
  return candidates.map((candidate, index) => ({
    id: index + 1,
    path: candidate.path,
    mtime: candidate.mtime,
    content: candidate.content,
    model: 'plan-rerank',
    dimension: 0,
    metadata: candidate.metadata,
    similarity: Math.max(0, 1 - index / Math.max(candidates.length, 1)),
  }))
}

function parseSelectedIndexes(
  content: string,
  candidateCount: number,
  limit: number,
): number[] {
  const parsed = parseJsonFromText(content)
  const rawIndexes = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.indices)
      ? parsed.indices
      : []

  const uniqueIndexes: number[] = []
  for (const value of rawIndexes) {
    const index =
      typeof value === 'number'
        ? value
        : isIndexObject(value)
          ? value.index
          : Number.NaN
    if (
      Number.isInteger(index) &&
      index >= 0 &&
      index < candidateCount &&
      !uniqueIndexes.includes(index)
    ) {
      uniqueIndexes.push(index)
    }
    if (uniqueIndexes.length >= limit) {
      break
    }
  }
  return uniqueIndexes
}

function isIndexObject(value: unknown): value is { index: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'index' in value &&
    typeof value.index === 'number'
  )
}

function parseJsonFromText(text: string): { indices?: unknown[] } | unknown[] {
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const jsonText = fencedMatch?.[1] ?? extractJsonLikeText(text)
  return JSON.parse(jsonText) as { indices?: unknown[] } | unknown[]
}

function extractJsonLikeText(text: string): string {
  const objectStart = text.indexOf('{')
  const objectEnd = text.lastIndexOf('}')
  if (objectStart !== -1 && objectEnd > objectStart) {
    return text.slice(objectStart, objectEnd + 1)
  }

  const arrayStart = text.indexOf('[')
  const arrayEnd = text.lastIndexOf(']')
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    return text.slice(arrayStart, arrayEnd + 1)
  }

  return text
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
