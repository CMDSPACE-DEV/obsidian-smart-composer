import { App, Platform, base64ToArrayBuffer, normalizePath } from 'obsidian'
import { v4 as uuidv4 } from 'uuid'

import { SmartComposerSettings } from '../../settings/schema/setting.types'
import {
  ArtifactRecord,
  BackgroundTaskAdapter,
  BackgroundTaskRecord,
  BackgroundTaskRunContext,
  BackgroundTaskRunResult,
} from '../../types/background-task'
import { getChatModelClient } from '../llm/manager'
import { OpenAICodexProvider } from '../llm/openaiCodexProvider'
import { BackgroundTaskManager } from '../tasks/BackgroundTaskManager'

export class PlanImageTaskAdapter implements BackgroundTaskAdapter {
  readonly kind = 'image-generation' as const

  constructor(
    private readonly app: App,
    private readonly taskManager: BackgroundTaskManager,
    private readonly getSettings: () => SmartComposerSettings,
    private readonly setSettings: (
      settings: SmartComposerSettings,
    ) => void | Promise<void>,
  ) {}

  async run(
    task: BackgroundTaskRecord,
    context: BackgroundTaskRunContext,
  ): Promise<BackgroundTaskRunResult> {
    if (!Platform.isDesktop) {
      throw new Error(
        'Plan image generation currently requires Obsidian desktop.',
      )
    }
    const prompt =
      typeof task.input.prompt === 'string' ? task.input.prompt.trim() : ''
    if (!prompt) throw new Error('Image prompt is empty.')

    const settings = this.getSettings()
    const requestedModelId =
      typeof task.input.modelId === 'string'
        ? task.input.modelId
        : settings.imageGeneration.modelId
    const { providerClient, model } = getChatModelClient({
      modelId: requestedModelId,
      settings,
      setSettings: this.setSettings,
    })
    if (
      !(providerClient instanceof OpenAICodexProvider) ||
      model.providerType !== 'openai-plan'
    ) {
      throw new Error('Native image generation requires a GPT Plan model.')
    }

    await context.updateProgress({
      phase: 'preparing',
      message: 'Preparing Plan image request',
    })
    const generated = await providerClient.generateImage(model, prompt, {
      quality: settings.imageGeneration.quality,
      signal: context.signal,
      onProgress: (phase, partialImageIndex) => {
        void context.updateProgress({
          phase,
          current: partialImageIndex,
          message:
            phase === 'receiving'
              ? 'Receiving image preview'
              : 'Generating image',
        })
      },
    })

    await context.updateProgress({
      phase: 'saving',
      message: 'Saving recoverable local image',
    })
    const bytes = base64ToArrayBuffer(generated.base64)
    const dimensions = readPngDimensions(bytes)
    const folder = normalizePath(settings.imageGeneration.outputFolder)
    await ensureFolder(this.app, folder)
    const filename = `${Date.now()}-${
      sanitizeFilename(prompt.slice(0, 48)) || 'generated-image'
    }.png`
    const path = await getAvailablePath(this.app, folder, filename)
    await this.app.vault.createBinary(path, bytes)

    const artifact: ArtifactRecord = {
      schemaVersion: 1,
      id: uuidv4(),
      taskId: task.id,
      kind: 'image',
      createdAt: Date.now(),
      localPath: path,
      mimeType: generated.mimeType,
      byteSize: bytes.byteLength,
      width: dimensions?.width,
      height: dimensions?.height,
      checksum: await sha256(bytes),
    }
    await this.taskManager.saveArtifact(artifact)
    return {
      status: 'awaiting-destination',
      artifactIds: [artifact.id],
    }
  }
}

export function readPngDimensions(
  buffer: ArrayBuffer,
): { width: number; height: number } | null {
  if (buffer.byteLength < 24) return null
  const bytes = new Uint8Array(buffer, 0, 24)
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (signature.some((value, index) => bytes[index] !== value)) return null
  const view = new DataView(buffer)
  return {
    width: view.getUint32(16, false),
    height: view.getUint32(20, false),
  }
}

async function ensureFolder(app: App, path: string): Promise<void> {
  if (!path || app.vault.getAbstractFileByPath(path)) return
  const parts = path.split('/')
  let current = ''
  for (const part of parts) {
    current = current ? `${current}/${part}` : part
    if (!app.vault.getAbstractFileByPath(current)) {
      await app.vault.createFolder(current)
    }
  }
}

async function getAvailablePath(
  app: App,
  folder: string,
  filename: string,
): Promise<string> {
  const dot = filename.lastIndexOf('.')
  const stem = dot >= 0 ? filename.slice(0, dot) : filename
  const extension = dot >= 0 ? filename.slice(dot) : ''
  for (let index = 0; index < Number.MAX_SAFE_INTEGER; index += 1) {
    const suffix = index === 0 ? '' : `-${index}`
    const candidate = normalizePath(`${folder}/${stem}${suffix}${extension}`)
    if (!app.vault.getAbstractFileByPath(candidate)) return candidate
  }
  throw new Error('Unable to allocate a unique image filename.')
}

function sanitizeFilename(value: string): string {
  return value
    .replace(/[\\/:*?"<>|#^[\]]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

async function sha256(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
