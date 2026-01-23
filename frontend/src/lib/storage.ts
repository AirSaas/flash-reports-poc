import { STORAGE_KEYS } from '@config/constants'
import type { SessionState, Engine } from '@appTypes/index'

const DEFAULT_SESSION_STATE: SessionState = {
  sessionId: crypto.randomUUID(),
  engine: null,
  lastTemplateId: null,
  lastMappingId: null,
  lastFetchedDataId: null,
  hasFetchedData: false,
  projectsConfig: null,
}

export function getStoredSession(): SessionState {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.SESSION)
    if (stored) {
      return JSON.parse(stored)
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
  // Preserve projectsConfig, lastTemplateId, lastMappingId and lastFetchedDataId when creating new session
  const existingSession = getStoredSession()
  const newSession: SessionState = {
    sessionId: crypto.randomUUID(),
    engine: null,
    lastTemplateId: existingSession.lastTemplateId, // Keep existing template reference
    lastMappingId: existingSession.lastMappingId, // Keep existing mapping reference
    lastFetchedDataId: existingSession.lastFetchedDataId, // Keep existing fetched data reference
    hasFetchedData: false,
    projectsConfig: existingSession.projectsConfig, // Keep existing config
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
