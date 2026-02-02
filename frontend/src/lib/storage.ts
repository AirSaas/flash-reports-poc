import { STORAGE_KEYS } from '@config/constants'
import type { SessionState, Engine, SmartviewSelection } from '@appTypes/index'

const DEFAULT_SESSION_STATE: SessionState = {
  sessionId: crypto.randomUUID(),
  engine: null,
  lastTemplateId: null,
  lastMappingId: null,
  lastFetchedDataId: null,
  hasFetchedData: false,
  projectsConfig: null, // @deprecated - kept for backward compatibility
  smartviewSelection: null,
}

export function getStoredSession(): SessionState {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.SESSION)
    if (stored) {
      const parsed = JSON.parse(stored)
      // Ensure new fields exist for backward compatibility
      return {
        ...DEFAULT_SESSION_STATE,
        ...parsed,
        smartviewSelection: parsed.smartviewSelection || null,
      }
    }
  } catch (e) {
    console.error('Failed to parse stored session:', e)
  }
  return { ...DEFAULT_SESSION_STATE, sessionId: crypto.randomUUID() }
}

export function setStoredSession(session: SessionState): void {
  localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(session))
}

export function updateStoredEngine(engine: Engine): void {
  const session = getStoredSession()
  setStoredSession({ ...session, engine })
}

export function updateStoredTemplateId(templateId: string): void {
  const session = getStoredSession()
  setStoredSession({ ...session, lastTemplateId: templateId })
}

export function clearStoredSession(): void {
  localStorage.removeItem(STORAGE_KEYS.SESSION)
}

export function createNewSession(): SessionState {
  // Preserve smartviewSelection, lastTemplateId, lastMappingId and lastFetchedDataId when creating new session
  const existingSession = getStoredSession()
  const newSession: SessionState = {
    sessionId: crypto.randomUUID(),
    engine: null,
    lastTemplateId: existingSession.lastTemplateId, // Keep existing template reference
    lastMappingId: existingSession.lastMappingId, // Keep existing mapping reference
    lastFetchedDataId: existingSession.lastFetchedDataId, // Keep existing fetched data reference
    hasFetchedData: false,
    projectsConfig: null, // @deprecated - no longer preserve
    smartviewSelection: existingSession.smartviewSelection, // Keep existing smartview selection
  }
  setStoredSession(newSession)
  return newSession
}

export function updateStoredMappingId(mappingId: string): void {
  const session = getStoredSession()
  setStoredSession({ ...session, lastMappingId: mappingId })
}

export function updateStoredFetchedDataFlag(hasFetchedData: boolean): void {
  const session = getStoredSession()
  setStoredSession({ ...session, hasFetchedData })
}

export function updateStoredSmartviewSelection(selection: SmartviewSelection): void {
  const session = getStoredSession()
  setStoredSession({ ...session, smartviewSelection: selection })
}
