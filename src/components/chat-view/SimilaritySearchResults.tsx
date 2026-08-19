import { ChevronDown, ChevronRight } from 'lucide-react'
import path from 'path-browserify'
import { useState } from 'react'

import { useApp } from '../../contexts/app-context'
import { SelectEmbedding } from '../../database/schema'
import { RetrievalMetadata } from '../../types/chat'
import { openMarkdownFile } from '../../utils/obsidian'

function SimiliartySearchItem({
  chunk,
}: {
  chunk: Omit<SelectEmbedding, 'embedding'> & {
    similarity: number
  }
}) {
  const app = useApp()

  const handleClick = () => {
    openMarkdownFile(app, chunk.path, chunk.metadata.startLine)
  }
  return (
    <div onClick={handleClick} className="smtcmp-similarity-search-item">
      <div className="smtcmp-similarity-search-item__similarity">
        {chunk.similarity.toFixed(3)}
      </div>
      <div className="smtcmp-similarity-search-item__path">
        {path.basename(chunk.path)}
      </div>
      <div className="smtcmp-similarity-search-item__line-numbers">
        {`${chunk.metadata.startLine} - ${chunk.metadata.endLine}`}
      </div>
    </div>
  )
}

export default function SimilaritySearchResults({
  similaritySearchResults,
  retrievalMetadata,
}: {
  similaritySearchResults: (Omit<SelectEmbedding, 'embedding'> & {
    similarity: number
  })[]
  retrievalMetadata?: RetrievalMetadata
}) {
  const [isOpen, setIsOpen] = useState(false)
  const modeLabel = retrievalMetadata
    ? getRetrievalModeLabel(retrievalMetadata)
    : null

  return (
    <div className="smtcmp-similarity-search-results">
      <div
        onClick={() => {
          setIsOpen(!isOpen)
        }}
        className="smtcmp-similarity-search-results__trigger"
      >
        {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <div>
          Show Referenced Documents ({similaritySearchResults.length})
          {modeLabel ? ` - ${modeLabel}` : ''}
        </div>
      </div>
      {isOpen && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {retrievalMetadata && (
            <RetrievalMetadataSummary metadata={retrievalMetadata} />
          )}
          {similaritySearchResults.map((chunk) => (
            <SimiliartySearchItem key={chunk.id} chunk={chunk} />
          ))}
        </div>
      )}
    </div>
  )
}

function RetrievalMetadataSummary({
  metadata,
}: {
  metadata: RetrievalMetadata
}) {
  return (
    <div className="smtcmp-similarity-search-results__metadata">
      <span>{getRetrievalModeLabel(metadata)}</span>
      <span>{metadata.scopeType}</span>
      <span>{metadata.totalFilesRead} files</span>
      <span>{metadata.totalChunksBuilt} chunks</span>
      <span>{metadata.candidateChunks} candidates</span>
      <span>{metadata.selectedChunks} selected</span>
      {metadata.fallbackUsed && (
        <span className="smtcmp-retrieval-warning">local fallback</span>
      )}
      {metadata.warnings?.map((warning) => (
        <span className="smtcmp-retrieval-warning" key={warning}>
          {warning}
        </span>
      ))}
    </div>
  )
}

function getRetrievalModeLabel(metadata: RetrievalMetadata): string {
  switch (metadata.retrievalMode) {
    case 'embedding':
      return 'Embedding snippets'
    case 'plan-rerank':
      return 'Plan-selected snippets'
    case 'exhaustive-direct':
      return 'Entire folder included'
    case 'exhaustive-batch':
      return 'Entire folder summarized'
  }
}
