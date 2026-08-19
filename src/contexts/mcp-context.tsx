import { PropsWithChildren, createContext, useContext, useMemo } from 'react'

import type { McpManager } from '../core/mcp/mcpManager'
import type { ResearchManager } from '../core/research/ResearchManager'

export type McpContextType = {
  getMcpManager: () => Promise<McpManager>
  getResearchManager: () => Promise<ResearchManager>
}

const McpContext = createContext<McpContextType | null>(null)

export function McpProvider({
  getMcpManager,
  getResearchManager,
  children,
}: PropsWithChildren<{
  getMcpManager: () => Promise<McpManager>
  getResearchManager: () => Promise<ResearchManager>
}>) {
  const value = useMemo(() => {
    return { getMcpManager, getResearchManager }
  }, [getMcpManager, getResearchManager])

  return <McpContext.Provider value={value}>{children}</McpContext.Provider>
}

export function useMcp() {
  const context = useContext(McpContext)
  if (!context) {
    throw new Error('useMcp must be used within a McpProvider')
  }
  return context
}
