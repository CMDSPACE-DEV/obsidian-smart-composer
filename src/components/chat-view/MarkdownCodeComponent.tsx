import { Check, CopyIcon, Eye } from 'lucide-react'
import { PropsWithChildren, useMemo, useState } from 'react'

import { useApp } from '../../contexts/app-context'
import { useDarkModeContext } from '../../contexts/dark-mode-context'
import { openMarkdownFile } from '../../utils/obsidian'

import { ObsidianMarkdown } from './ObsidianMarkdown'
import { MemoizedSyntaxHighlighterWrapper } from './SyntaxHighlighterWrapper'

export default function MarkdownCodeComponent({
  language,
  filename,
  children,
}: PropsWithChildren<{
  language?: string
  filename?: string
}>) {
  const app = useApp()
  const { isDarkMode } = useDarkModeContext()

  const [isPreviewMode, setIsPreviewMode] = useState(true)
  const [copied, setCopied] = useState(false)

  const wrapLines = useMemo(() => {
    return !language || ['markdown'].includes(language)
  }, [language])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(String(children))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy text: ', err)
    }
  }

  const handleOpenFile = () => {
    if (filename) {
      openMarkdownFile(app, filename)
    }
  }

  return (
    <div className="smtcmp-code-block">
      <div className="smtcmp-code-block-header">
        {filename && (
          <div
            className="smtcmp-code-block-header-filename"
            onClick={handleOpenFile}
          >
            {filename}
          </div>
        )}
        <div className="smtcmp-code-block-header-button-container">
          <button
            className="clickable-icon smtcmp-code-block-header-button"
            onClick={() => {
              setIsPreviewMode(!isPreviewMode)
            }}
          >
            <Eye size={12} />
            {isPreviewMode ? 'View Raw Text' : 'View Formatted'}
          </button>
          <button
            className="clickable-icon smtcmp-code-block-header-button"
            onClick={() => {
              handleCopy()
            }}
          >
            {copied ? (
              <>
                <Check size={10} />
                <span>Copied</span>
              </>
            ) : (
              <>
                <CopyIcon size={10} />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>
      {isPreviewMode ? (
        <div className="smtcmp-code-block-obsidian-markdown">
          <ObsidianMarkdown content={String(children)} scale="sm" />
        </div>
      ) : (
        <MemoizedSyntaxHighlighterWrapper
          isDarkMode={isDarkMode}
          language={language}
          hasFilename={!!filename}
          wrapLines={wrapLines}
        >
          {String(children)}
        </MemoizedSyntaxHighlighterWrapper>
      )}
      <div className="smtcmp-code-block-footer">
        <div className="smtcmp-code-block-header-button-container">
          <button
            className="clickable-icon smtcmp-code-block-header-button"
            onClick={() => {
              handleCopy()
            }}
          >
            {copied ? (
              <>
                <Check size={10} />
                <span>Copied</span>
              </>
            ) : (
              <>
                <CopyIcon size={10} />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
