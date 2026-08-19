import {
  App,
  BasesConfigFile,
  normalizePath,
  parseYaml,
  stringifyYaml,
} from 'obsidian'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'

import type SmartComposerPlugin from '../../main'
import {
  ArtifactRecord,
  BackgroundTaskAdapter,
  BackgroundTaskRecord,
  BackgroundTaskRunContext,
  BackgroundTaskRunResult,
} from '../../types/background-task'

const canvasNodeSchema = z.object({
  type: z.enum(['text', 'file', 'group']),
  text: z.string().optional(),
  file: z.string().optional(),
  label: z.string().optional(),
  x: z.number(),
  y: z.number(),
  width: z.number().positive().max(2000),
  height: z.number().positive().max(2000),
})
const draftSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('canvas'),
    path: z.string(),
    nodes: z.array(canvasNodeSchema).max(200),
    edges: z
      .array(
        z.object({
          from: z.number().int().nonnegative(),
          to: z.number().int().nonnegative(),
          label: z.string().optional(),
        }),
      )
      .max(400),
  }),
  z.object({
    kind: z.literal('base'),
    path: z.string(),
    config: z.record(z.unknown()),
  }),
  z.object({
    kind: z.literal('excalidraw'),
    path: z.string(),
    elements: z
      .array(
        z.object({
          type: z.enum(['rectangle', 'ellipse', 'diamond', 'text', 'arrow']),
          x: z.number(),
          y: z.number(),
          width: z.number().positive().max(2000),
          height: z.number().positive().max(2000),
          text: z.string().optional(),
          from: z.number().int().nonnegative().optional(),
          to: z.number().int().nonnegative().optional(),
        }),
      )
      .max(200),
  }),
])

export type ArtifactDraft = z.infer<typeof draftSchema>

export class ArtifactTaskAdapter implements BackgroundTaskAdapter {
  readonly kind = 'artifact-draft' as const

  constructor(private readonly plugin: SmartComposerPlugin) {}

  async run(
    task: BackgroundTaskRecord,
    context: BackgroundTaskRunContext,
  ): Promise<BackgroundTaskRunResult> {
    const storedDraft = task.input.draft
    if (storedDraft && task.input.approved === true) {
      const draft = draftSchema.parse(storedDraft)
      await context.updateProgress({
        phase: 'writing',
        message: `Writing ${draft.kind}`,
      })
      const artifact = await writeDraft(
        this.plugin.app,
        task.id,
        draft,
        typeof task.input.targetFingerprint === 'string'
          ? task.input.targetFingerprint
          : undefined,
      )
      await this.plugin.backgroundTaskManager?.saveArtifact(artifact)
      return { status: 'succeeded', artifactIds: [artifact.id] }
    }

    const prompt =
      typeof task.input.prompt === 'string' ? task.input.prompt : ''
    const requestedKind =
      task.input.artifactKind === 'canvas' ||
      task.input.artifactKind === 'base' ||
      task.input.artifactKind === 'excalidraw'
        ? task.input.artifactKind
        : 'canvas'
    const settings = this.plugin.settings
    const { getChatModelClient } = await import('../llm/manager')
    const { providerClient, model } = getChatModelClient({
      modelId: settings.chatModelId,
      settings,
      setSettings: (next) => this.plugin.setSettings(next),
    })
    await context.updateProgress({
      phase: 'drafting',
      message: `Drafting ${requestedKind} preview`,
    })
    const response = await providerClient.generateResponse(
      model,
      {
        model: model.model,
        messages: [
          {
            role: 'system',
            content: ARTIFACT_SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: JSON.stringify({ kind: requestedKind, request: prompt }),
          },
        ],
      },
      { signal: context.signal },
    )
    const content = response.choices[0]?.message.content ?? ''
    const draft = draftSchema.parse(
      JSON.parse(
        content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''),
      ),
    )
    validatePath(draft)
    validateDraft(draft)
    const targetFingerprint = await fingerprintVaultPath(
      this.plugin.app,
      draft.path,
    )
    return {
      status: 'awaiting-approval',
      input: { ...task.input, draft, targetFingerprint },
    }
  }
}

async function writeDraft(
  app: App,
  taskId: string,
  draft: ArtifactDraft,
  expectedFingerprint?: string,
): Promise<ArtifactRecord> {
  validatePath(draft)
  validateDraft(draft)
  const path = normalizePath(draft.path)
  await ensureParent(app, path)
  const existing = app.vault.getFileByPath(path)
  const snapshot = existing ? await app.vault.read(existing) : null
  const currentFingerprint = await fingerprintVaultPath(app, path)
  if (
    expectedFingerprint !== undefined &&
    expectedFingerprint !== currentFingerprint
  ) {
    throw new Error(
      'The target changed after preview. Review the artifact again before writing.',
    )
  }
  try {
    if (draft.kind === 'excalidraw') {
      const handled = await writeWithExcalidrawAutomate(
        app,
        path,
        draft,
        existing !== null,
      )
      if (handled) {
        return createArtifactRecord(taskId, draft.kind, path)
      }
      if (existing) {
        throw new Error(
          'Updating an existing drawing requires the matching open Excalidraw view and ExcalidrawAutomate runtime.',
        )
      }
    }
    const content =
      draft.kind === 'canvas'
        ? buildCanvas(draft)
        : draft.kind === 'base'
          ? buildBase(draft, snapshot)
          : buildExcalidraw(draft)
    if (existing) await app.vault.modify(existing, content)
    else await app.vault.create(path, content)
  } catch (error) {
    const current = app.vault.getFileByPath(path)
    if (snapshot !== null && current) await app.vault.modify(current, snapshot)
    else if (snapshot === null && current) await app.vault.delete(current)
    throw error
  }
  return createArtifactRecord(taskId, draft.kind, path)
}

function createArtifactRecord(
  taskId: string,
  kind: ArtifactRecord['kind'],
  path: string,
): ArtifactRecord {
  return {
    schemaVersion: 1,
    id: uuidv4(),
    taskId,
    kind,
    createdAt: Date.now(),
    localPath: path,
    mimeType:
      kind === 'canvas'
        ? 'application/json'
        : kind === 'base'
          ? 'application/yaml'
          : 'text/markdown',
  }
}

function buildCanvas(draft: Extract<ArtifactDraft, { kind: 'canvas' }>) {
  const nodes = draft.nodes.map((node, index) => ({
    id: `node-${index}`,
    type: node.type,
    ...(node.text ? { text: node.text } : {}),
    ...(node.file ? { file: node.file } : {}),
    ...(node.label ? { label: node.label } : {}),
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
  }))
  const edges = draft.edges.map((edge, index) => ({
    id: `edge-${index}`,
    fromNode: `node-${edge.from}`,
    toNode: `node-${edge.to}`,
    ...(edge.label ? { label: edge.label } : {}),
  }))
  return JSON.stringify({ nodes, edges }, null, 2)
}

function buildBase(
  draft: Extract<ArtifactDraft, { kind: 'base' }>,
  snapshot: string | null,
) {
  const parsed = snapshot ? parseYaml(snapshot) : null
  const previous =
    parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {}
  const merged = {
    ...previous,
    ...(draft.config as BasesConfigFile),
  } satisfies BasesConfigFile
  return stringifyYaml(merged)
}

function buildExcalidraw(
  draft: Extract<ArtifactDraft, { kind: 'excalidraw' }>,
) {
  const now = Date.now()
  const elements = draft.elements.map((element, index) => ({
    id: `element-${index}`,
    type: element.type,
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    angle: 0,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'hachure',
    strokeWidth: 1,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: index + 1,
    version: 1,
    versionNonce: index + 100,
    isDeleted: false,
    boundElements: null,
    updated: now,
    link: null,
    locked: false,
    ...(element.text ? { text: element.text, originalText: element.text } : {}),
  }))
  const textElements = draft.elements
    .map((element, index) =>
      element.text ? `${element.text} ^element-${index}` : null,
    )
    .filter(Boolean)
    .join('\n\n')
  const scene = JSON.stringify(
    {
      type: 'excalidraw',
      version: 2,
      source: 'smart-composer-achmage',
      elements,
      appState: { viewBackgroundColor: '#ffffff' },
      files: {},
    },
    null,
    2,
  )
  return [
    '---',
    'excalidraw-plugin: parsed',
    'tags: [excalidraw]',
    '---',
    '# Excalidraw Data',
    '## Text Elements',
    textElements,
    '%%',
    '## Drawing',
    '```json',
    scene,
    '```',
    '%%',
  ].join('\n')
}

function validatePath(draft: ArtifactDraft): void {
  const required =
    draft.kind === 'canvas'
      ? '.canvas'
      : draft.kind === 'base'
        ? '.base'
        : '.excalidraw.md'
  if (
    draft.path.startsWith('/') ||
    draft.path.includes('..') ||
    !draft.path.endsWith(required)
  ) {
    throw new Error(`Invalid ${draft.kind} path: ${draft.path}`)
  }
}

function validateDraft(draft: ArtifactDraft): void {
  if (draft.kind === 'canvas') {
    for (const edge of draft.edges) {
      if (edge.from >= draft.nodes.length || edge.to >= draft.nodes.length) {
        throw new Error('Canvas edge references a node that does not exist.')
      }
    }
  }
  if (draft.kind === 'base') {
    validateBaseFilter(draft.config.filters)
  }
  if (draft.kind === 'excalidraw') {
    for (const element of draft.elements) {
      if (
        element.type === 'arrow' &&
        (element.from === undefined ||
          element.to === undefined ||
          element.from >= draft.elements.length ||
          element.to >= draft.elements.length)
      ) {
        throw new Error(
          'Excalidraw arrows must reference existing element indexes.',
        )
      }
    }
  }
}

function validateBaseFilter(filter: unknown): void {
  if (filter === undefined) return
  if (typeof filter === 'string') {
    const supported =
      /^\s*(?:file\.(?:inFolder|hasTag|hasProperty)\(.+\)|file\.property\(.+\)\s*(?:==|!=|<=|>=|<|>)\s*.+)\s*$/
    if (!supported.test(filter)) {
      throw new Error(
        'This Base filter is outside the supported folder, tag, or property comparison subset.',
      )
    }
    return
  }
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
    throw new Error('Invalid Base filter.')
  }
  const entries = Object.entries(filter)
  if (entries.length !== 1) throw new Error('Invalid Base boolean filter.')
  const [operator, children] = entries[0]
  if (!['and', 'or', 'not'].includes(operator) || !Array.isArray(children)) {
    throw new Error('Only and/or/not Base filter groups are supported.')
  }
  children.forEach(validateBaseFilter)
}

type ExcalidrawAutomateRuntime = {
  reset: () => void
  setView: (view: 'active' | 'first') => {
    file?: { path?: string }
  } | null
  addRect: (x: number, y: number, width: number, height: number) => string
  addEllipse: (x: number, y: number, width: number, height: number) => string
  addDiamond: (x: number, y: number, width: number, height: number) => string
  addText: (
    x: number,
    y: number,
    text: string,
    formatting?: Record<string, unknown>,
  ) => string
  connectObjects: (
    from: string,
    fromSide: 'right',
    to: string,
    toSide: 'left',
    formatting?: Record<string, unknown>,
  ) => void
  addToGroup?: (ids: string[]) => string
  addElementsToView: (
    repositionToCursor?: boolean,
    save?: boolean,
    newElementsOnTop?: boolean,
    shouldRestoreElements?: boolean,
  ) => Promise<boolean>
  create: (options: {
    filename: string
    foldername: string
    onNewPane: boolean
    frontmatterKeys: { 'excalidraw-plugin': 'parsed' }
  }) => Promise<string>
  verifyMinimumPluginVersion?: (version: string) => boolean
}

async function writeWithExcalidrawAutomate(
  app: App,
  path: string,
  draft: Extract<ArtifactDraft, { kind: 'excalidraw' }>,
  updatingExisting: boolean,
): Promise<boolean> {
  const ea = (
    window as Window & {
      ExcalidrawAutomate?: ExcalidrawAutomateRuntime
    }
  ).ExcalidrawAutomate
  if (!isCompatibleExcalidrawRuntime(ea)) return false

  ea.reset()
  const ids: (string | undefined)[] = []
  draft.elements.forEach((element, index) => {
    if (element.type === 'arrow') return
    let shapeId: string | undefined
    if (element.type === 'rectangle') {
      shapeId = ea.addRect(element.x, element.y, element.width, element.height)
    } else if (element.type === 'ellipse') {
      shapeId = ea.addEllipse(
        element.x,
        element.y,
        element.width,
        element.height,
      )
    } else if (element.type === 'diamond') {
      shapeId = ea.addDiamond(
        element.x,
        element.y,
        element.width,
        element.height,
      )
    }
    if (element.type === 'text') {
      shapeId = ea.addText(element.x, element.y, element.text ?? '', {
        width: element.width,
        height: element.height,
        textAlign: 'center',
      })
    } else if (shapeId && element.text) {
      const textId = ea.addText(element.x, element.y, element.text, {
        width: element.width,
        height: element.height,
        textAlign: 'center',
      })
      ea.addToGroup?.([shapeId, textId])
    }
    ids[index] = shapeId
  })
  draft.elements.forEach((element) => {
    if (element.type !== 'arrow') return
    const from = ids[element.from ?? -1]
    const to = ids[element.to ?? -1]
    if (!from || !to) {
      throw new Error('Excalidraw arrow references an unsupported element.')
    }
    ea.connectObjects(from, 'right', to, 'left', {
      numberOfPoints: 0,
      endArrowHead: 'arrow',
      padding: 8,
    })
  })

  if (updatingExisting) {
    const view = ea.setView('active')
    if (normalizePath(view?.file?.path ?? '') !== path) {
      throw new Error(
        'Open the approved Excalidraw file in the active pane before applying this update.',
      )
    }
    const added = await ea.addElementsToView(false, true, true, true)
    if (!added) throw new Error('Excalidraw refused the approved update.')
    return true
  }

  const parts = path.split('/')
  const filename = parts.pop()?.replace(/\.excalidraw\.md$/, '') ?? ''
  const foldername = parts.join('/')
  const createdPath = normalizePath(
    await ea.create({
      filename,
      foldername,
      onNewPane: false,
      frontmatterKeys: { 'excalidraw-plugin': 'parsed' },
    }),
  )
  if (createdPath !== path) {
    const unintended = app.vault.getFileByPath(createdPath)
    if (unintended) await app.vault.delete(unintended)
    throw new Error(
      `Excalidraw created an unexpected path (${createdPath}); the file was removed.`,
    )
  }
  return true
}

function isCompatibleExcalidrawRuntime(
  value: ExcalidrawAutomateRuntime | undefined,
): value is ExcalidrawAutomateRuntime {
  if (!value) return false
  const methods = [
    'reset',
    'setView',
    'addRect',
    'addEllipse',
    'addDiamond',
    'addText',
    'connectObjects',
    'addElementsToView',
    'create',
  ] as const
  if (methods.some((method) => typeof value[method] !== 'function')) {
    return false
  }
  return (
    typeof value.verifyMinimumPluginVersion === 'function' &&
    value.verifyMinimumPluginVersion('2.25.0')
  )
}

async function fingerprintVaultPath(app: App, path: string): Promise<string> {
  const file = app.vault.getFileByPath(normalizePath(path))
  if (!file) return 'missing'
  const content = await app.vault.read(file)
  const bytes = new TextEncoder().encode(content)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function ensureParent(app: App, path: string): Promise<void> {
  const parent = path.split('/').slice(0, -1).join('/')
  if (!parent) return
  let current = ''
  for (const part of parent.split('/')) {
    current = current ? `${current}/${part}` : part
    if (!app.vault.getAbstractFileByPath(current)) {
      await app.vault.createFolder(current)
    }
  }
}

const ARTIFACT_SYSTEM_PROMPT = `Return JSON only. Create one typed Obsidian artifact draft.
Canvas: {"kind":"canvas","path":"...canvas","nodes":[{"type":"text|file|group","text":"...","file":"...","label":"...","x":0,"y":0,"width":300,"height":180}],"edges":[{"from":0,"to":1,"label":"..."}]}.
Base: {"kind":"base","path":"...base","config":{valid Obsidian BasesConfigFile fields}}. Filters may use folder, tag, property existence/equality/comparison and and/or/not only.
Excalidraw: {"kind":"excalidraw","path":"...excalidraw.md","elements":[{"type":"rectangle|ellipse|diamond|text|arrow","x":0,"y":0,"width":220,"height":100,"text":"...","from":0,"to":1}]}.
Use at most 200 elements. Keep every path inside the vault.`
