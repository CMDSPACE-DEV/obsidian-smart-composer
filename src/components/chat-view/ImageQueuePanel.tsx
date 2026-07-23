import { ChevronDown, Images } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'

import { usePlugin } from '../../contexts/plugin-context'
import { BackgroundTaskRecord } from '../../types/background-task'
import {
  selectVisibleImageTasks,
  summarizeImageQueue,
} from '../../utils/chat/imageQueue'

import { BackgroundTaskCards } from './BackgroundTaskCards'

export function ImageQueuePanel({
  conversationId,
  onLocateOrigin,
}: {
  conversationId: string
  onLocateOrigin: (messageId: string) => void
}) {
  const plugin = usePlugin()
  const manager = plugin.backgroundTaskManager
  const [allTasks, setAllTasks] = useState<BackgroundTaskRecord[]>([])
  const [expanded, setExpanded] = useState(false)
  const bodyId = useId()

  useEffect(() => {
    setExpanded(false)
  }, [conversationId])

  useEffect(() => {
    if (!manager) return
    return manager.subscribe(setAllTasks)
  }, [manager])

  const tasks = useMemo(
    () => selectVisibleImageTasks(allTasks, conversationId),
    [allTasks, conversationId],
  )
  const summary = useMemo(() => summarizeImageQueue(tasks), [tasks])

  if (!manager || tasks.length === 0) return null

  const statusParts = [
    summary.running > 0 ? `${summary.running} generating` : null,
    summary.queued > 0 ? `${summary.queued} queued` : null,
    summary.ready > 0 ? `${summary.ready} ready` : null,
    summary.failed > 0 ? `${summary.failed} needs attention` : null,
    summary.running + summary.queued + summary.ready + summary.failed === 0
      ? summary.completed > 0
        ? `${summary.completed} completed`
        : `${summary.total} tasks`
      : null,
  ].filter((part): part is string => !!part)

  return (
    <aside
      className="smtcmp-image-queue-panel"
      data-active={summary.running + summary.queued > 0}
      data-expanded={expanded}
      aria-label="Image generation queue"
    >
      <button
        className="smtcmp-image-queue-panel__toggle"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-controls={bodyId}
      >
        <Images size={14} />
        <strong>Image queue</strong>
        <span className="smtcmp-image-queue-panel__summary" aria-live="polite">
          {statusParts.join(' · ')}
        </span>
        <span className="smtcmp-image-queue-panel__count">{summary.total}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {expanded && (
        <div className="smtcmp-image-queue-panel__body" id={bodyId}>
          <BackgroundTaskCards
            conversationId={conversationId}
            taskScope="image-queue"
            onLocateOrigin={(messageId) => {
              setExpanded(false)
              requestAnimationFrame(() => onLocateOrigin(messageId))
            }}
          />
        </div>
      )}
    </aside>
  )
}
