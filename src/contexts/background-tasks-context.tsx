import {
  PropsWithChildren,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

import type { BackgroundTaskManager } from '../core/tasks/BackgroundTaskManager'
import type {
  ArtifactRecord,
  BackgroundTaskRecord,
} from '../types/background-task'

type BackgroundTasksContextValue = {
  manager: BackgroundTaskManager | null
  tasks: BackgroundTaskRecord[]
  artifacts: Record<string, ArtifactRecord>
}

const BackgroundTasksContext =
  createContext<BackgroundTasksContextValue | null>(null)

export function BackgroundTasksProvider({
  children,
  manager,
}: PropsWithChildren<{ manager: BackgroundTaskManager | null }>) {
  const [tasks, setTasks] = useState<BackgroundTaskRecord[]>([])
  const [artifacts, setArtifacts] = useState<Record<string, ArtifactRecord>>({})

  useEffect(() => {
    let active = true
    let generation = 0

    if (!manager) {
      setTasks([])
      setArtifacts({})
      return
    }

    const unsubscribe = manager.subscribe((nextTasks) => {
      setTasks(nextTasks)
      const artifactIds = Array.from(
        new Set(nextTasks.flatMap((task) => task.artifactIds)),
      )
      const currentGeneration = ++generation

      void Promise.all(artifactIds.map((id) => manager.readArtifact(id))).then(
        (records) => {
          if (!active || currentGeneration !== generation) return
          setArtifacts(
            Object.fromEntries(
              records
                .filter((record): record is ArtifactRecord => !!record)
                .map((record) => [record.id, record]),
            ),
          )
        },
      )
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [manager])

  const value = useMemo(
    () => ({ manager, tasks, artifacts }),
    [artifacts, manager, tasks],
  )

  return (
    <BackgroundTasksContext.Provider value={value}>
      {children}
    </BackgroundTasksContext.Provider>
  )
}

export function useBackgroundTasks(): BackgroundTasksContextValue {
  const value = useContext(BackgroundTasksContext)
  if (!value) {
    throw new Error(
      'useBackgroundTasks must be used within BackgroundTasksProvider',
    )
  }
  return value
}
