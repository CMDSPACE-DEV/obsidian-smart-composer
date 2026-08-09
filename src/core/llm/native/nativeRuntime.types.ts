import {
  ToolCallRequest,
  ToolCallResponse,
} from '../../../types/tool-call.types'

export type NativeRuntimeProvider = 'claude' | 'gemini'

export type NativeRuntimeStatus =
  | 'checking'
  | 'not-installed'
  | 'login-required'
  | 'billing-blocked'
  | 'quota-unverified'
  | 'ready'
  | 'error'

export type NativeRuntimeInstallMethod =
  | 'custom'
  | 'native'
  | 'winget'
  | 'homebrew'
  | 'legacy'
  | 'path'
  | 'unknown'

export type RuntimeExecutableCandidate = {
  path: string
  canonicalPath: string
  method: NativeRuntimeInstallMethod
  evidence: string[]
  /** Package-manager methods remain path-only until the manager confirms them. */
  managerVerified?: boolean
}

export type RuntimeDiscovery = {
  provider: NativeRuntimeProvider
  selectedPath?: string
  selectedMethod: NativeRuntimeInstallMethod
  candidates: RuntimeExecutableCandidate[]
  ambiguous: boolean
}

export type RuntimeAuthDecision = {
  status:
    | 'subscription'
    | 'login-required'
    | 'billing-blocked'
    | 'quota-unverified'
  allowed: boolean
  reason: string
  /** Non-secret classifications only. Never include credential values. */
  evidence: string[]
}

export type NativeRuntimeInstallationState =
  | 'not-checked'
  | 'not-installed'
  | 'installed'
  | 'error'

export type NativeRuntimeAuthenticationState =
  | 'not-checked'
  | 'login-required'
  | 'subscription'
  | 'billing-blocked'
  | 'quota-unverified'

export type NativeRuntimeCatalogState = 'not-checked' | 'ready' | 'error'

export type NativeRuntimeUpdateState =
  | 'not-checked'
  | 'native'
  | 'winget'
  | 'homebrew'
  | 'background'
  | 'ambiguous'
  | 'unknown'

export type NativeRuntimeModel = {
  id: string
  label: string
  description?: string
}

export type NativeRuntimeSnapshot = {
  provider: NativeRuntimeProvider
  status: NativeRuntimeStatus
  phase: 'idle' | 'checking' | 'settled'
  installation: NativeRuntimeInstallationState
  authentication: NativeRuntimeAuthenticationState
  catalog: NativeRuntimeCatalogState
  update: NativeRuntimeUpdateState
  executablePath?: string
  version?: string
  models: NativeRuntimeModel[]
  discovery?: RuntimeDiscovery
  authDecision?: RuntimeAuthDecision
  error?: string
  warning?: string
  lastCheckedAt?: number
}

/** @deprecated Runtime state is process-local; use NativeRuntimeSnapshot. */
export type NativeRuntimeDiagnostics = NativeRuntimeSnapshot

export type NativeToolExecutor = (
  request: ToolCallRequest,
) => Promise<ToolCallResponse>
