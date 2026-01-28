import { useState, useCallback, useRef } from 'react'
import type { Engine } from '@appTypes/index'
import type { EvaluateResponse } from '@appTypes/api'
import { invokeFunction } from '@lib/supabase'
import {
  checkJobStatus,
  triggerJobProcessing,
  createEvalJob,
  triggerEvalJobProcessing,
} from '@services/session.service'
import {
  createHtmlGenerationJob,
  checkHtmlJobStatus,
} from '@services/python-backend.service'
import { EVALUATION_THRESHOLD, MAX_ITERATIONS } from '@config/constants'
import type { GenerationStep } from '@ui/generation'

interface GenerationResult {
  pptxUrl: string
  reportId: string
  iteration: number
  prompt?: string
  // For HTML generation
  htmlUrl?: string
  pdfUrl?: string
}

interface UseGenerateReturn {
  generating: boolean
  evaluating: boolean
  fetching: boolean
  currentStep: GenerationStep
  error: string | null
  result: GenerationResult | null
  evaluation: EvaluateResponse | null
  evaluationCount: number
  generate: () => Promise<GenerationResult | null>
  evaluate: (reportId: string) => Promise<EvaluateResponse | null>
  reEvaluate: () => Promise<EvaluateResponse | null>
  generateWithEvaluation: () => Promise<GenerationResult | null>
}

const MAX_EVALUATIONS = 2

// Polling configuration
const POLL_INTERVAL = 3000 // 3 seconds
const MAX_POLL_TIME_GENERATION = 5 * 60 * 1000 // 5 minutes max for generation (HTML takes longer)
const MAX_POLL_TIME_EVALUATION = 5 * 60 * 1000 // 5 minutes max for evaluation

export function useGenerate(sessionId: string, engine: Engine | null): UseGenerateReturn {
  const [generating, setGenerating] = useState(false)
  const [evaluating, setEvaluating] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [currentStep, setCurrentStep] = useState<GenerationStep>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<GenerationResult | null>(null)
  const [evaluation, setEvaluation] = useState<EvaluateResponse | null>(null)
  const [evaluationCount, setEvaluationCount] = useState(0)
  const pollTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  /**
   * Poll for generation job completion (Supabase)
   */
  const pollGenerationJobStatus = useCallback(
    async (jobId: string, startTime: number): Promise<GenerationResult | null> => {
      // Check if we've exceeded max poll time
      if (Date.now() - startTime > MAX_POLL_TIME_GENERATION) {
        throw new Error('Generation timed out. Please try again.')
      }

      const statusResult = await checkJobStatus(sessionId, jobId)

      if (!statusResult.success || !statusResult.job) {
        throw new Error(statusResult.error || 'Failed to check job status')
      }

      const job = statusResult.job

      switch (job.status) {
        case 'completed':
          if (!job.result) {
            throw new Error('Job completed but no result found')
          }
          return {
            pptxUrl: job.result.pptxUrl!,
            reportId: job.result.reportId!,
            iteration: job.result.iteration!,
            prompt: job.prompt,
          }

        case 'failed':
          throw new Error(job.error || 'Generation failed')

        case 'processing':
          setCurrentStep('generating')
          setFetching(false)
          setGenerating(true)
          // Continue polling
          await new Promise((resolve) => {
            pollTimeoutRef.current = setTimeout(resolve, POLL_INTERVAL)
          })
          return pollGenerationJobStatus(jobId, startTime)

        case 'pending':
        default:
          // Continue polling
          await new Promise((resolve) => {
            pollTimeoutRef.current = setTimeout(resolve, POLL_INTERVAL)
          })
          return pollGenerationJobStatus(jobId, startTime)
      }
    },
    [sessionId]
  )

  /**
   * Poll for HTML generation job completion (Python backend)
   */
  const pollHtmlJobStatus = useCallback(
    async (jobId: string, startTime: number): Promise<GenerationResult | null> => {
      // Check if we've exceeded max poll time
      if (Date.now() - startTime > MAX_POLL_TIME_GENERATION) {
        throw new Error('HTML generation timed out. Please try again.')
      }

      const statusResult = await checkHtmlJobStatus(sessionId, jobId)

      if (!statusResult.success || !statusResult.job) {
        throw new Error(statusResult.error || 'Failed to check HTML job status')
      }

      const job = statusResult.job

      switch (job.status) {
        case 'completed':
          if (!job.result) {
            throw new Error('Job completed but no result found')
          }
          return {
            pptxUrl: job.result.pdfUrl || job.result.htmlUrl || '', // Prefer PDF, fallback to HTML
            htmlUrl: job.result.htmlUrl,
            pdfUrl: job.result.pdfUrl,
            reportId: job.result.reportId!,
            iteration: 1,
          }

        case 'failed':
          throw new Error(job.error || 'HTML generation failed')

        case 'processing':
          setCurrentStep('generating')
          setFetching(false)
          setGenerating(true)
          // Continue polling
          await new Promise((resolve) => {
            pollTimeoutRef.current = setTimeout(resolve, POLL_INTERVAL)
          })
          return pollHtmlJobStatus(jobId, startTime)

        case 'pending':
        default:
          // Continue polling
          await new Promise((resolve) => {
            pollTimeoutRef.current = setTimeout(resolve, POLL_INTERVAL)
          })
          return pollHtmlJobStatus(jobId, startTime)
      }
    },
    [sessionId]
  )

  /**
   * Poll for evaluation job completion
   */
  const pollEvaluationJobStatus = useCallback(
    async (jobId: string, startTime: number): Promise<EvaluateResponse | null> => {
      // Check if we've exceeded max poll time
      if (Date.now() - startTime > MAX_POLL_TIME_EVALUATION) {
        throw new Error('Evaluation timed out. Please try again.')
      }

      const statusResult = await checkJobStatus(sessionId, jobId)

      if (!statusResult.success || !statusResult.job) {
        throw new Error(statusResult.error || 'Failed to check evaluation job status')
      }

      const job = statusResult.job

      switch (job.status) {
        case 'completed':
          if (!job.result || !job.result.evaluation) {
            throw new Error('Evaluation completed but no result found')
          }
          return {
            evaluation: job.result.evaluation,
            shouldRegenerate: job.result.shouldRegenerate || false,
          }

        case 'failed':
          throw new Error(job.error || 'Evaluation failed')

        case 'processing':
        case 'pending':
        default:
          // Continue polling
          await new Promise((resolve) => {
            pollTimeoutRef.current = setTimeout(resolve, POLL_INTERVAL)
          })
          return pollEvaluationJobStatus(jobId, startTime)
      }
    },
    [sessionId]
  )

  /**
   * Generate using Claude HTML (Python backend)
   */
  const generateHtml = useCallback(async (): Promise<GenerationResult | null> => {
    setFetching(true)
    setCurrentStep('fetching')
    setError(null)

    try {
      // Create HTML generation job on Python backend
      const response = await createHtmlGenerationJob(sessionId, true)

      if (!response.success || !response.jobId) {
        throw new Error(response.error || 'Failed to create HTML generation job')
      }

      console.log(`HTML generation job created: ${response.jobId}`)

      // Transition to generating state
      setFetching(false)
      setGenerating(true)
      setCurrentStep('generating')

      // Poll for completion
      const startTime = Date.now()
      const generationResult = await pollHtmlJobStatus(response.jobId, startTime)

      if (!generationResult) {
        throw new Error('HTML generation completed but no result returned')
      }

      setResult(generationResult)
      setGenerating(false)
      setCurrentStep('done') // Skip evaluation for HTML
      return generationResult
    } catch (e) {
      const message = e instanceof Error ? e.message : 'HTML generation failed'
      setError(message)
      setCurrentStep('error')
      return null
    } finally {
      setFetching(false)
      setGenerating(false)
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current)
        pollTimeoutRef.current = null
      }
    }
  }, [sessionId, pollHtmlJobStatus])

  /**
   * Generate using Gamma (Supabase edge function)
   */
  const generateGamma = useCallback(async (): Promise<GenerationResult | null> => {
    setFetching(true)
    setCurrentStep('fetching')
    setError(null)

    try {
      const response = await invokeFunction<{
        success: boolean
        jobId?: string
        error?: string
      }>('generate-gamma', sessionId)

      if (!response.success || !response.jobId) {
        throw new Error(response.error || 'Failed to create generation job')
      }

      console.log(`Gamma generation job created: ${response.jobId}`)

      // Trigger job processing from the client (fire-and-forget)
      triggerJobProcessing(response.jobId, 'gamma')

      // Transition to generating state
      setFetching(false)
      setGenerating(true)
      setCurrentStep('generating')

      // Poll for completion
      const startTime = Date.now()
      const generationResult = await pollGenerationJobStatus(response.jobId, startTime)

      if (!generationResult) {
        throw new Error('Generation completed but no result returned')
      }

      setResult(generationResult)
      setGenerating(false)
      return generationResult
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Generation failed'
      setError(message)
      setCurrentStep('error')
      return null
    } finally {
      setFetching(false)
      setGenerating(false)
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current)
        pollTimeoutRef.current = null
      }
    }
  }, [sessionId, pollGenerationJobStatus])

  /**
   * Main generate function - routes to appropriate backend based on engine
   */
  const generate = useCallback(async (): Promise<GenerationResult | null> => {
    if (engine === 'claude-html') {
      return generateHtml()
    }
    // Default to Gamma for all other engines
    return generateGamma()
  }, [engine, generateHtml, generateGamma])

  /**
   * Evaluate a report using async job-based evaluation with Claude PPTX Skill.
   * Note: Not applicable for HTML generation
   */
  const evaluate = useCallback(
    async (reportId: string): Promise<EvaluateResponse | null> => {
      // Skip evaluation for HTML engine
      if (engine === 'claude-html') {
        return null
      }

      setEvaluating(true)
      setCurrentStep('evaluating')
      setError(null)

      try {
        const createResult = await createEvalJob(sessionId, reportId)

        if (!createResult.success || !createResult.jobId) {
          throw new Error(createResult.error || 'Failed to create evaluation job')
        }

        console.log(`Evaluation job created: ${createResult.jobId}`)

        // Trigger job processing (fire-and-forget)
        triggerEvalJobProcessing(createResult.jobId)

        // Poll for completion
        const startTime = Date.now()
        const evalResult = await pollEvaluationJobStatus(createResult.jobId, startTime)

        if (!evalResult) {
          throw new Error('Evaluation completed but no result returned')
        }

        setEvaluation(evalResult)
        setEvaluationCount((prev) => prev + 1)
        setCurrentStep('done')
        return evalResult
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Evaluation failed'
        setError(message)
        setCurrentStep('error')
        return null
      } finally {
        setEvaluating(false)
        if (pollTimeoutRef.current) {
          clearTimeout(pollTimeoutRef.current)
          pollTimeoutRef.current = null
        }
      }
    },
    [sessionId, engine, pollEvaluationJobStatus]
  )

  const reEvaluate = useCallback(async (): Promise<EvaluateResponse | null> => {
    if (!result?.reportId) {
      setError('No report to re-evaluate')
      return null
    }

    if (evaluationCount >= MAX_EVALUATIONS) {
      setError('Maximum evaluations reached')
      return null
    }

    return evaluate(result.reportId)
  }, [result, evaluationCount, evaluate])

  const generateWithEvaluation = useCallback(async (): Promise<GenerationResult | null> => {
    // For HTML engine, skip evaluation
    if (engine === 'claude-html') {
      return generate()
    }

    let currentResult = await generate()
    if (!currentResult) return null

    let iteration = 1

    while (iteration < MAX_ITERATIONS) {
      const evalResult = await evaluate(currentResult.reportId)
      if (!evalResult) return currentResult

      if (
        evalResult.evaluation.score >= EVALUATION_THRESHOLD ||
        evalResult.evaluation.recommendation === 'pass'
      ) {
        return currentResult
      }

      iteration++
      const regenerated = await generate()
      if (!regenerated) return currentResult

      currentResult = { ...regenerated, iteration }
    }

    await evaluate(currentResult.reportId)
    return currentResult
  }, [engine, generate, evaluate])

  return {
    generating,
    evaluating,
    fetching,
    currentStep,
    error,
    result,
    evaluation,
    evaluationCount,
    generate,
    evaluate,
    reEvaluate,
    generateWithEvaluation,
  }
}
