import { useState, useEffect, useCallback } from 'react'
import type { SessionState, Engine, Step } from '@appTypes/index'
import type { SessionResponse } from '@appTypes/api'
import { getStoredSession, setStoredSession, createNewSession } from '@lib/storage'
import { invokeFunction } from '@lib/supabase'

export function useSession() {
  const [session, setSession] = useState<SessionState>(getStoredSession)
  const [currentStep, setCurrentStep] = useState<Step>('select_engine')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setStoredSession(session)
  }, [session])

  const setEngine = useCallback((engine: Engine) => {
    setSession((prev) => ({ ...prev, engine }))
  }, [])

  const setLastTemplateId = useCallback((templateId: string) => {
    setSession((prev) => ({ ...prev, lastTemplateId: templateId }))
  }, [])

  const setLastMappingId = useCallback((mappingId: string) => {
    setSession((prev) => ({ ...prev, lastMappingId: mappingId }))
  }, [])

  const setHasFetchedData = useCallback((hasFetchedData: boolean) => {
    setSession((prev) => ({ ...prev, hasFetchedData }))
  }, [])

  const resetSession = useCallback(() => {
    const newSession = createNewSession()
    setSession(newSession)
    setCurrentStep('select_engine')
    return newSession
  }, [])

  const fetchSessionState = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await invokeFunction<SessionResponse>(
        'get-session',
        session.sessionId
      )
      if (response.session) {
        setCurrentStep(response.session.current_step as Step)
      }
      return response
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to fetch session'
      setError(message)
      return null
    } finally {
      setLoading(false)
    }
  }, [session.sessionId])

  const goToStep = useCallback((step: Step) => {
    setCurrentStep(step)
  }, [])

  return {
    ...session,
    currentStep,
    loading,
    error,
    setEngine,
    setLastTemplateId,
    setLastMappingId,
    setHasFetchedData,
    resetSession,
    fetchSessionState,
    goToStep,
  }
}
