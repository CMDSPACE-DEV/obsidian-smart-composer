import { SelectEmbedding } from '../../database/schema'

import { OrbitalLoader } from './OrbitalLoader'

export type QueryProgressState =
  | {
      type: 'reading-mentionables'
    }
  | {
      type: 'indexing'
      indexProgress: IndexProgress
    }
  | {
      type: 'querying'
    }
  | {
      type: 'plan-reranking'
    }
  | {
      type: 'querying-done'
      queryResult: (Omit<SelectEmbedding, 'embedding'> & {
        similarity: number
      })[]
    }
  | {
      type: 'idle'
    }

export type IndexProgress = {
  completedChunks: number
  totalChunks: number
  totalFiles: number
  waitingForRateLimit?: boolean
}

// TODO: Update style
export default function QueryProgress({
  state,
}: {
  state: QueryProgressState
}) {
  switch (state.type) {
    case 'idle':
      return null
    case 'reading-mentionables':
      return (
        <div className="smtcmp-query-progress">
          <OrbitalLoader label="Reading mentioned files" />
        </div>
      )
    case 'indexing':
      return (
        <div className="smtcmp-query-progress">
          <OrbitalLoader
            label={`Indexing ${state.indexProgress.totalFiles} file`}
          />
          <p className="smtcmp-query-progress-detail">{`${state.indexProgress.completedChunks}/${state.indexProgress.totalChunks} chunks indexed`}</p>
          {state.indexProgress.waitingForRateLimit && (
            <p className="smtcmp-query-progress-detail">
              Waiting for rate limit to reset...
            </p>
          )}
        </div>
      )
    case 'querying':
      return (
        <div className="smtcmp-query-progress">
          <OrbitalLoader label="Querying the vault" />
        </div>
      )
    case 'plan-reranking':
      return (
        <div className="smtcmp-query-progress">
          <OrbitalLoader label="Selecting relevant chunks" />
        </div>
      )
    case 'querying-done':
      return (
        <div className="smtcmp-query-progress">
          <OrbitalLoader label="Reading related files" />
          {state.queryResult.map((result) => (
            <div key={result.path}>
              <p>{result.path}</p>
              <p>{result.similarity}</p>
            </div>
          ))}
        </div>
      )
  }
}
