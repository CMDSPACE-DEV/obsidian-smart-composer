import { App } from 'obsidian'

import { RECOMMENDED_MODELS_FOR_EMBEDDING } from '../../../constants'
import { useSettings } from '../../../contexts/settings-context'
import SmartComposerPlugin from '../../../main'
import { findFilesMatchingPatterns } from '../../../utils/glob-utils'
import { ObsidianButton } from '../../common/ObsidianButton'
import { ObsidianDropdown } from '../../common/ObsidianDropdown'
import { ObsidianSetting } from '../../common/ObsidianSetting'
import { ObsidianTextArea } from '../../common/ObsidianTextArea'
import { ObsidianTextInput } from '../../common/ObsidianTextInput'
import { EmbeddingDbManageModal } from '../modals/EmbeddingDbManageModal'
import { ExcludedFilesModal } from '../modals/ExcludedFilesModal'
import { IncludedFilesModal } from '../modals/IncludedFilesModal'

type RAGSectionProps = {
  app: App
  plugin: SmartComposerPlugin
}

export function RAGSection({ app, plugin }: RAGSectionProps) {
  const { settings, setSettings } = useSettings()

  return (
    <div className="smtcmp-settings-section">
      <div className="smtcmp-settings-header">RAG</div>

      <ObsidianSetting
        name="Retrieval mode"
        desc="Choose how Smart Composer selects context for large folder or vault mentions."
      >
        <ObsidianDropdown
          value={settings.ragOptions.retrievalMode}
          options={{
            auto: 'Auto',
            embedding: 'Embedding database',
            'plan-rerank': 'Plan rerank, no embedding API key',
          }}
          onChange={async (value) => {
            await setSettings({
              ...settings,
              ragOptions: {
                ...settings.ragOptions,
                retrievalMode: value as 'auto' | 'embedding' | 'plan-rerank',
              },
            })
          }}
        />
      </ObsidianSetting>

      <ObsidianSetting
        name="Folder mention scope"
        desc="Choose whether folder and vault mentions should use focused snippets or exhaustive reading."
      >
        <ObsidianDropdown
          value={settings.ragOptions.folderReadMode}
          options={{
            auto: 'Auto by intent',
            focused: 'Focused snippets',
            exhaustive: 'Exhaustive folder read',
          }}
          onChange={async (value) => {
            await setSettings({
              ...settings,
              ragOptions: {
                ...settings.ragOptions,
                folderReadMode: value as 'auto' | 'focused' | 'exhaustive',
              },
            })
          }}
        />
      </ObsidianSetting>

      <ObsidianSetting
        name="Embedding model"
        desc="Choose the model you want to use for embeddings"
      >
        <ObsidianDropdown
          value={settings.embeddingModelId}
          options={Object.fromEntries(
            settings.embeddingModels.map((embeddingModel) => [
              embeddingModel.id,
              `${embeddingModel.id}${RECOMMENDED_MODELS_FOR_EMBEDDING.includes(embeddingModel.id) ? ' (Recommended)' : ''}`,
            ]),
          )}
          onChange={async (value) => {
            await setSettings({
              ...settings,
              embeddingModelId: value,
            })
          }}
        />
      </ObsidianSetting>

      <ObsidianSetting
        name="Include patterns"
        desc="Specify glob patterns to include files in indexing (one per line). Example: use 'notes/**' for all files in the notes folder. Leave empty to include all files. Requires 'Rebuild entire vault index' after changes."
      >
        <ObsidianButton
          text="Test patterns"
          onClick={async () => {
            const patterns = settings.ragOptions.includePatterns
            const includedFiles = await findFilesMatchingPatterns(
              patterns,
              plugin.app.vault,
            )
            new IncludedFilesModal(app, includedFiles, patterns).open()
          }}
        />
      </ObsidianSetting>

      <ObsidianSetting className="smtcmp-settings-textarea">
        <ObsidianTextArea
          value={settings.ragOptions.includePatterns.join('\n')}
          onChange={async (value: string) => {
            const patterns = value
              .split('\n')
              .map((p: string) => p.trim())
              .filter((p: string) => p.length > 0)
            await setSettings({
              ...settings,
              ragOptions: {
                ...settings.ragOptions,
                includePatterns: patterns,
              },
            })
          }}
        />
      </ObsidianSetting>

      <ObsidianSetting
        name="Exclude patterns"
        desc="Specify glob patterns to exclude files from indexing (one per line). Example: use 'notes/**' for all files in the notes folder. Leave empty to exclude nothing. Requires 'Rebuild entire vault index' after changes."
      >
        <ObsidianButton
          text="Test patterns"
          onClick={async () => {
            const patterns = settings.ragOptions.excludePatterns
            const excludedFiles = await findFilesMatchingPatterns(
              patterns,
              plugin.app.vault,
            )
            new ExcludedFilesModal(app, excludedFiles).open()
          }}
        />
      </ObsidianSetting>

      <ObsidianSetting className="smtcmp-settings-textarea">
        <ObsidianTextArea
          value={settings.ragOptions.excludePatterns.join('\n')}
          onChange={async (value) => {
            const patterns = value
              .split('\n')
              .map((p) => p.trim())
              .filter((p) => p.length > 0)
            await setSettings({
              ...settings,
              ragOptions: {
                ...settings.ragOptions,
                excludePatterns: patterns,
              },
            })
          }}
        />
      </ObsidianSetting>

      <ObsidianSetting
        name="Chunk size"
        desc="Set the chunk size for text splitting. After changing this, please re-index the vault using the 'Rebuild entire vault index' command."
      >
        <ObsidianTextInput
          value={String(settings.ragOptions.chunkSize)}
          placeholder="1000"
          onChange={async (value) => {
            const chunkSize = parseInt(value, 10)
            if (!isNaN(chunkSize)) {
              await setSettings({
                ...settings,
                ragOptions: {
                  ...settings.ragOptions,
                  chunkSize,
                },
              })
            }
          }}
        />
      </ObsidianSetting>

      <ObsidianSetting
        name="Threshold tokens"
        desc="Maximum number of tokens before switching to RAG. If the total tokens from mentioned files exceed this, RAG will be used instead of including all file contents."
      >
        <ObsidianTextInput
          value={String(settings.ragOptions.thresholdTokens)}
          placeholder="8192"
          onChange={async (value) => {
            const thresholdTokens = parseInt(value, 10)
            if (!isNaN(thresholdTokens)) {
              await setSettings({
                ...settings,
                ragOptions: {
                  ...settings.ragOptions,
                  thresholdTokens,
                },
              })
            }
          }}
        />
      </ObsidianSetting>

      <ObsidianSetting
        name="Minimum similarity"
        desc="Minimum similarity score for RAG results. Higher values return more relevant but potentially fewer results."
      >
        <ObsidianTextInput
          value={String(settings.ragOptions.minSimilarity)}
          placeholder="0.0"
          onChange={async (value) => {
            // Allow decimal point and numbers only
            if (!/^[0-9.]*$/.test(value)) return

            // Ignore typing decimal point to prevent interference with the input
            if (value === '.' || value.endsWith('.')) return

            const minSimilarity = parseFloat(value)
            if (!isNaN(minSimilarity)) {
              await setSettings({
                ...settings,
                ragOptions: {
                  ...settings.ragOptions,
                  minSimilarity,
                },
              })
            }
          }}
        />
      </ObsidianSetting>

      <ObsidianSetting
        name="Limit"
        desc="Maximum number of RAG results to include in the prompt. Higher values provide more context but increase token usage."
      >
        <ObsidianTextInput
          value={String(settings.ragOptions.limit)}
          placeholder="10"
          onChange={async (value) => {
            const limit = parseInt(value, 10)
            if (!isNaN(limit)) {
              await setSettings({
                ...settings,
                ragOptions: {
                  ...settings.ragOptions,
                  limit,
                },
              })
            }
          }}
        />
      </ObsidianSetting>

      <ObsidianSetting
        name="Exhaustive direct token limit"
        desc="Maximum total tokens to include directly when exhaustive folder reading is used. Larger folders are summarized in batches."
      >
        <ObsidianTextInput
          value={String(settings.ragOptions.exhaustiveDirectTokenLimit)}
          placeholder="60000"
          onChange={async (value) => {
            const exhaustiveDirectTokenLimit = parseInt(value, 10)
            if (!isNaN(exhaustiveDirectTokenLimit)) {
              await setSettings({
                ...settings,
                ragOptions: {
                  ...settings.ragOptions,
                  exhaustiveDirectTokenLimit,
                },
              })
            }
          }}
        />
      </ObsidianSetting>

      <ObsidianSetting
        name="Plan rerank candidate limit"
        desc="Maximum number of locally ranked chunks sent to your selected chat model when plan rerank is used."
      >
        <ObsidianTextInput
          value={String(settings.ragOptions.planRerankCandidateLimit)}
          placeholder="40"
          onChange={async (value) => {
            const planRerankCandidateLimit = parseInt(value, 10)
            if (!isNaN(planRerankCandidateLimit)) {
              await setSettings({
                ...settings,
                ragOptions: {
                  ...settings.ragOptions,
                  planRerankCandidateLimit,
                },
              })
            }
          }}
        />
      </ObsidianSetting>

      <ObsidianSetting name="Manage Embedding Database">
        <ObsidianButton
          text="Manage"
          onClick={async () => {
            new EmbeddingDbManageModal(app, plugin).open()
          }}
        />
      </ObsidianSetting>
    </div>
  )
}
