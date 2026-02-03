import { useState, useEffect, useCallback, useRef } from 'react'
import {
  startTemplatePreparation,
  getTemplatePreparationStatus,
  type PreparationStatus,
} from '@services/template-preparation.service'

interface UseTemplatePreparationResult {
  /** Current preparation status */
  status: PreparationStatus | 'idle'
  /** Whether the HTML template is ready to use */
  isReady: boolean
  /** Whether preparation is currently in progress */
  isProcessing: boolean
  /** Error message if preparation failed */
  error: string | null
  /** URL to the generated HTML template (available when completed) */
  htmlTemplateUrl: string | null
  /** Start the template preparation process */
  startPreparation: () => Promise<void>
  /** Reset the preparation state */
  reset: () => void
}

const POLL_INTERVAL = 3000 // 3 seconds
const MAX_POLL_TIME = 5 * 60 * 1000 // 5 minutes max

/**
 * Hook to manage template preparation (PPTX → HTML conversion).
 *
 * Usage:
 * 1. Call startPreparation() after uploading/selecting a template
 * 2. The hook will poll for status updates automatically
 * 3. Check isReady to know when the HTML is available
 *
 * @param sessionId - The current session ID
 */
export function useTemplatePreparation(sessionId: string): UseTemplatePreparationResult {
  const [status, setStatus] = useState<PreparationStatus | 'idle'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [htmlTemplateUrl, setHtmlTemplateUrl] = useState<string | null>(null)

  const pollingRef = useRef<NodeJS.Timeout | null>(null)
  const pollStartTimeRef = useRef<number>(0)

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }, [])

  const pollStatus = useCallback(async () => {
    // Check for timeout
    if (Date.now() - pollStartTimeRef.current > MAX_POLL_TIME) {
      setStatus('failed')
      setError('Template preparation timed out')
      stopPolling()
      return
    }

    try {
      const result = await getTemplatePreparationStatus(sessionId)

      if (result.success) {
        setStatus(result.status)

        if (result.status === 'completed') {
          setHtmlTemplateUrl(result.htmlTemplateUrl || null)
          setError(null)
          stopPolling()
        } else if (result.status === 'failed') {
          setError(result.error || 'Template preparation failed')
          stopPolling()
        }
        // If still processing, continue polling
      } else {
        // API call failed but might be transient
        console.warn('Template preparation status check failed:', result.error)
      }
    } catch (err) {
      console.error('Error polling template status:', err)
    }
  }, [sessionId, stopPolling])

  const startPreparation = useCallback(async () => {
    // Reset state
    setError(null)
    setHtmlTemplateUrl(null)
    setStatus('pending')

    try {
      const result = await startTemplatePreparation(sessionId)

      if (result.success) {
        // Check if already completed
        if (result.message === 'Template already prepared') {
          // Fetch the current status to get the URL
          const statusResult = await getTemplatePreparationStatus(sessionId)
          if (statusResult.success && statusResult.status === 'completed') {
            setStatus('completed')
            setHtmlTemplateUrl(statusResult.htmlTemplateUrl || null)
            return
          }
        }

        // Start polling
        setStatus('processing')
        pollStartTimeRef.current = Date.now()
        pollingRef.current = setInterval(pollStatus, POLL_INTERVAL)

        // Also poll immediately
        await pollStatus()
      } else {
        setStatus('failed')
        setError(result.error || 'Failed to start template preparation')
      }
    } catch (err) {
      setStatus('failed')
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }, [sessionId, pollStatus])

  const reset = useCallback(() => {
    stopPolling()
    setStatus('idle')
    setError(null)
    setHtmlTemplateUrl(null)
  }, [stopPolling])

  // Cleanup on unmount or session change
  useEffect(() => {
    return () => {
      stopPolling()
    }
  }, [stopPolling, sessionId])

  // Check initial status when sessionId changes
  useEffect(() => {
    const checkInitialStatus = async () => {
      try {
        const result = await getTemplatePreparationStatus(sessionId)
        if (result.success) {
          setStatus(result.status)
          if (result.status === 'completed') {
            setHtmlTemplateUrl(result.htmlTemplateUrl || null)
          } else if (result.status === 'failed') {
            setError(result.error || null)
          } else if (result.status === 'processing') {
            // Resume polling if already processing
            pollStartTimeRef.current = Date.now()
            pollingRef.current = setInterval(pollStatus, POLL_INTERVAL)
          }
        }
      } catch (err) {
        // Ignore initial check errors
        console.warn('Initial template status check failed:', err)
      }
    }

    checkInitialStatus()

    return () => {
      stopPolling()
    }
  }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    status,
    isReady: status === 'completed',
    isProcessing: status === 'processing' || status === 'pending',
    error,
    htmlTemplateUrl,
    startPreparation,
    reset,
  }
}
