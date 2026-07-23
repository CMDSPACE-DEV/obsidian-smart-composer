import { App, normalizePath } from 'obsidian'

import {
  ArtifactRecord,
  BackgroundTaskRecord,
} from '../../types/background-task'

const ROOT_DIR = '.smtcmp_json_db'
const TASK_DIR = `${ROOT_DIR}/tasks`
const ARTIFACT_DIR = `${ROOT_DIR}/artifacts`

export class TaskRepository {
  constructor(private readonly app: App) {}

  async initialize(): Promise<void> {
    await this.ensureDirectory(ROOT_DIR)
    await this.ensureDirectory(TASK_DIR)
    await this.ensureDirectory(ARTIFACT_DIR)
  }

  async listTasks(): Promise<BackgroundTaskRecord[]> {
    await this.initialize()
    const { files } = await this.app.vault.adapter.list(TASK_DIR)
    const tasks = await Promise.all(
      files
        .filter((file) => file.endsWith('.json'))
        .map(async (file) => {
          try {
            return JSON.parse(
              await this.app.vault.adapter.read(file),
            ) as BackgroundTaskRecord
          } catch {
            return null
          }
        }),
    )
    return tasks
      .filter((task): task is BackgroundTaskRecord => !!task)
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  async saveTask(task: BackgroundTaskRecord): Promise<void> {
    await this.initialize()
    await this.app.vault.adapter.write(
      normalizePath(`${TASK_DIR}/v1_${task.id}.json`),
      JSON.stringify(task, null, 2),
    )
  }

  async saveArtifact(artifact: ArtifactRecord): Promise<void> {
    await this.initialize()
    await this.app.vault.adapter.write(
      normalizePath(`${ARTIFACT_DIR}/v1_${artifact.id}.json`),
      JSON.stringify(artifact, null, 2),
    )
  }

  async readArtifact(id: string): Promise<ArtifactRecord | null> {
    const path = normalizePath(`${ARTIFACT_DIR}/v1_${id}.json`)
    if (!(await this.app.vault.adapter.exists(path))) return null
    return JSON.parse(await this.app.vault.adapter.read(path)) as ArtifactRecord
  }

  private async ensureDirectory(path: string): Promise<void> {
    const normalized = normalizePath(path)
    if (!(await this.app.vault.adapter.exists(normalized))) {
      await this.app.vault.adapter.mkdir(normalized)
    }
  }
}
