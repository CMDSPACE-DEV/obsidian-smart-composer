import { App, FileSystemAdapter } from 'obsidian'

type CmdsUploadResult = {
  success: boolean
  publicUrl?: string
  error?: string
}

type CmdsCloudProvider = {
  upload(
    filePath: string,
    filename: string,
    mimeType: string,
  ): Promise<CmdsUploadResult>
}

type CmdsEagleRuntime = {
  manifest?: { version?: string }
  getActiveCloudProvider?: () => CmdsCloudProvider | null
}

type AppWithPlugins = App & {
  plugins?: {
    plugins?: Record<string, unknown>
  }
}

export async function uploadWithCmdsEagle(
  app: App,
  vaultPath: string,
  mimeType: string,
): Promise<string> {
  const runtime = (app as AppWithPlugins).plugins?.plugins?.['cmds-eagle'] as
    | CmdsEagleRuntime
    | undefined
  if (!runtime?.manifest?.version?.startsWith('1.7.')) {
    throw new Error('CMDS Eagle 1.7.x is not installed or enabled.')
  }
  const provider = runtime.getActiveCloudProvider?.()
  if (!provider || typeof provider.upload !== 'function') {
    throw new Error('CMDS Eagle has no active cloud provider.')
  }
  if (!(app.vault.adapter instanceof FileSystemAdapter)) {
    throw new Error('CMDS Eagle upload is available on desktop vaults only.')
  }
  const filename = vaultPath.split('/').at(-1) ?? 'generated-image.png'
  const result = await provider.upload(
    app.vault.adapter.getFullPath(vaultPath),
    filename,
    mimeType,
  )
  if (!result.success || !result.publicUrl) {
    throw new Error(result.error ?? 'CMDS Eagle upload failed.')
  }
  return result.publicUrl
}
