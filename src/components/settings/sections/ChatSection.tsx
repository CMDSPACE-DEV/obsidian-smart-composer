import { RECOMMENDED_MODELS_FOR_CHAT } from '../../../constants'
import { useSettings } from '../../../contexts/settings-context'
import { ObsidianDropdown } from '../../common/ObsidianDropdown'
import { ObsidianSetting } from '../../common/ObsidianSetting'
import { ObsidianTextArea } from '../../common/ObsidianTextArea'
import { ObsidianTextInput } from '../../common/ObsidianTextInput'
import { ObsidianToggle } from '../../common/ObsidianToggle'

export function ChatSection({
  mode = 'all',
}: {
  mode?: 'all' | 'models' | 'writing'
}) {
  const { settings, setSettings } = useSettings()
  const showModels = mode !== 'writing'
  const showWriting = mode !== 'models'

  return (
    <div className="smtcmp-settings-section">
      <div className="smtcmp-settings-header">
        {mode === 'models' ? 'Default models' : 'Writing and generation'}
      </div>

      {showModels && (
        <ObsidianSetting
          name="Chat model"
          desc="Choose the model you want to use for chat."
        >
          <ObsidianDropdown
            value={settings.chatModelId}
            options={Object.fromEntries(
              settings.chatModels
                .filter(({ enable }) => enable ?? true)
                .map((chatModel) => [
                  chatModel.id,
                  `${chatModel.id}${RECOMMENDED_MODELS_FOR_CHAT.includes(chatModel.id) ? ' (Recommended)' : ''}`,
                ]),
            )}
            onChange={async (value) => {
              await setSettings({
                ...settings,
                chatModelId: value,
              })
            }}
          />
        </ObsidianSetting>
      )}

      {showWriting && (
        <>
          <ObsidianSetting
            name="Inline edit surrounding context"
            desc="Maximum characters read outside the selection. The selected text is always included; this does not increase generated output length."
          >
            <ObsidianTextInput
              value={settings.inlineEdit.contextCharacters.toString()}
              onChange={async (value) => {
                const parsed = Number.parseInt(value, 10)
                if (!Number.isFinite(parsed) || parsed < 500) return
                await setSettings({
                  ...settings,
                  inlineEdit: {
                    ...settings.inlineEdit,
                    contextCharacters: parsed,
                  },
                })
              }}
            />
          </ObsidianSetting>

          <ObsidianSetting
            name="Large inline edits"
            desc="Choose when large selections are promoted to resumable document edit jobs."
          >
            <ObsidianDropdown
              value={settings.documentEditing.largeEditRouting}
              options={{
                'auto-confirm': 'Auto detect and confirm (Recommended)',
                'always-job': 'Always use a document job',
                'single-response': 'Always generate one response',
              }}
              onChange={async (value) => {
                await setSettings({
                  ...settings,
                  documentEditing: {
                    ...settings.documentEditing,
                    largeEditRouting: value as
                      | 'auto-confirm'
                      | 'always-job'
                      | 'single-response',
                  },
                })
              }}
            />
          </ObsidianSetting>

          <ObsidianSetting
            name="Document draft folder"
            desc="Vault-relative folder for completed large replacement drafts."
          >
            <ObsidianTextInput
              value={settings.documentEditing.destinationFolder}
              onChange={async (value) => {
                await setSettings({
                  ...settings,
                  documentEditing: {
                    ...settings.documentEditing,
                    destinationFolder: value,
                  },
                })
              }}
            />
          </ObsidianSetting>

          <ObsidianSetting
            name="Preserve document frontmatter"
            desc="Keep YAML frontmatter unchanged in document edit jobs."
          >
            <ObsidianToggle
              value={settings.documentEditing.preserveFrontmatter}
              onChange={async (value) => {
                await setSettings({
                  ...settings,
                  documentEditing: {
                    ...settings.documentEditing,
                    preserveFrontmatter: value,
                  },
                })
              }}
            />
          </ObsidianSetting>

          <ObsidianSetting
            name="Document edit concurrency"
            desc="Maximum document jobs allowed to process one checkpointed section at the same time. One is safest for Plan accounts."
          >
            <ObsidianDropdown
              value={settings.documentEditing.concurrency.toString()}
              options={{
                '1': '1 (Recommended)',
                '2': '2 parallel jobs (Higher rate-limit usage)',
              }}
              onChange={async (value) => {
                await setSettings({
                  ...settings,
                  documentEditing: {
                    ...settings.documentEditing,
                    concurrency: value === '2' ? 2 : 1,
                  },
                })
              }}
            />
          </ObsidianSetting>

          <ObsidianSetting
            name="Document chunk retries"
            desc="Automatic retries for a failed or output-limited document section."
          >
            <ObsidianTextInput
              value={settings.documentEditing.retryLimit.toString()}
              onChange={async (value) => {
                const parsed = Number.parseInt(value, 10)
                if (!Number.isFinite(parsed) || parsed < 0 || parsed > 5) return
                await setSettings({
                  ...settings,
                  documentEditing: {
                    ...settings.documentEditing,
                    retryLimit: parsed,
                  },
                })
              }}
            />
          </ObsidianSetting>

          <ObsidianSetting
            name="Image output folder"
            desc="Vault-relative folder used for every generated image before R2 upload or note insertion. The task card shows the exact saved path."
          >
            <ObsidianTextInput
              value={settings.imageGeneration.outputFolder}
              onChange={async (value) => {
                await setSettings({
                  ...settings,
                  imageGeneration: {
                    ...settings.imageGeneration,
                    outputFolder: value,
                  },
                })
              }}
            />
          </ObsidianSetting>

          <ObsidianSetting
            name="Image quality"
            desc="Plan image generation quality. Higher quality can take longer."
          >
            <ObsidianDropdown
              value={settings.imageGeneration.quality}
              options={{
                low: 'Low',
                medium: 'Medium',
                high: 'High',
              }}
              onChange={async (value) => {
                await setSettings({
                  ...settings,
                  imageGeneration: {
                    ...settings.imageGeneration,
                    quality: value as 'low' | 'medium' | 'high',
                  },
                })
              }}
            />
          </ObsidianSetting>
        </>
      )}

      {showModels && (
        <ObsidianSetting
          name="Inline edit model"
          desc="Inherit the active chat model or choose a faster model for inline edits."
        >
          <ObsidianDropdown
            value={settings.inlineEdit.modelId ?? ''}
            options={{
              '': 'Inherit active chat model (Recommended)',
              ...Object.fromEntries(
                settings.chatModels
                  .filter(({ enable }) => enable ?? true)
                  .map((chatModel) => [chatModel.id, chatModel.id]),
              ),
            }}
            onChange={async (value) => {
              await setSettings({
                ...settings,
                inlineEdit: {
                  ...settings.inlineEdit,
                  modelId: value || null,
                },
              })
            }}
          />
        </ObsidianSetting>
      )}

      {showWriting && (
        <>
          <ObsidianSetting
            name="System prompt"
            desc="This prompt will be added to the beginning of every chat."
            className="smtcmp-settings-textarea-header"
          />

          <ObsidianSetting className="smtcmp-settings-textarea">
            <ObsidianTextArea
              value={settings.systemPrompt}
              onChange={async (value: string) => {
                await setSettings({
                  ...settings,
                  systemPrompt: value,
                })
              }}
            />
          </ObsidianSetting>

          <ObsidianSetting
            name="Include current file"
            desc="Automatically include the content of your current file in chats."
          >
            <ObsidianToggle
              value={settings.chatOptions.includeCurrentFileContent}
              onChange={async (value) => {
                await setSettings({
                  ...settings,
                  chatOptions: {
                    ...settings.chatOptions,
                    includeCurrentFileContent: value,
                  },
                })
              }}
            />
          </ObsidianSetting>

          <ObsidianSetting
            name="Enable tools"
            desc="Allow the AI to use MCP tools."
          >
            <ObsidianToggle
              value={settings.chatOptions.enableTools}
              onChange={async (value) => {
                await setSettings({
                  ...settings,
                  chatOptions: {
                    ...settings.chatOptions,
                    enableTools: value,
                  },
                })
              }}
            />
          </ObsidianSetting>

          <ObsidianSetting
            name="Maximum automatic tool rounds"
            desc="Maximum consecutive tool rounds before Full auto forces a final answer. Higher values can increase Plan usage and external API calls."
          >
            <ObsidianTextInput
              value={settings.chatOptions.maxAutoIterations.toString()}
              onChange={async (value) => {
                const parsedValue = parseInt(value)
                if (isNaN(parsedValue) || parsedValue < 1 || parsedValue > 50) {
                  return
                }
                await setSettings({
                  ...settings,
                  chatOptions: {
                    ...settings.chatOptions,
                    maxAutoIterations: parsedValue,
                  },
                })
              }}
            />
          </ObsidianSetting>
        </>
      )}
    </div>
  )
}
