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
import { EVALUATION_THRESHOLD, MAX_ITERATIONS } from '@config/constants'
import type { GenerationStep } from '@ui/generation'

interface GenerationResult {
  pptxUrl: string
  reportId: string
  iteration: number
  prompt?: string
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
const MAX_POLL_TIME_GENERATION = 3 * 60 * 1000 // 3 minutes max for generation
const MAX_POLL_TIME_EVALUATION = 5 * 60 * 1000 // 5 minutes max for evaluation (Claude PPTX Skill is slow)

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
   * Poll for generation job completion
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

  const generate = useCallback(async (): Promise<GenerationResult | null> => {
    // Start with fetching state
    setFetching(true)
    setCurrentStep('fetching')
    setError(null)

    try {
      // Determine which endpoint to use based on engine
      const functionName = engine === 'claude-pptx' ? 'generate-claude-pptx' : 'generate-gamma'
      const engineType = engine === 'claude-pptx' ? 'claude-pptx' : 'gamma'

      const response = await invokeFunction<{
        success: boolean
        jobId?: string
        error?: string
      }>(functionName, sessionId)

      if (!response.success || !response.jobId) {
        throw new Error(response.error || 'Failed to create generation job')
      }

      console.log(`${engineType} generation job created: ${response.jobId}`)

      // Trigger job processing from the client (fire-and-forget)
      triggerJobProcessing(response.jobId, engineType)

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
      // Clear any pending poll timeout
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current)
        pollTimeoutRef.current = null
      }
    }
  }, [sessionId, engine, pollGenerationJobStatus])

  /**
   * Evaluate a report using async job-based evaluation with Claude PPTX Skill.
   * Creates a job, triggers processing, and polls for completion.
   */
  const evaluate = useCallback(
    async (reportId: string): Promise<EvaluateResponse | null> => {
      setEvaluating(true)
      setCurrentStep('evaluating')
      setError(null)

      try {
        // Create evaluation job
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
        // Clear any pending poll timeout
        if (pollTimeoutRef.current) {
          clearTimeout(pollTimeoutRef.current)
          pollTimeoutRef.current = null
        }
      }
    },
    [sessionId, pollEvaluationJobStatus]
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
    let currentResult = await generate()
    if (!currentResult) return null

    // Result is already set in generate(), so pptxUrl is available for download
    // while evaluation runs

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
      // Result is already set in generate()
    }

    await evaluate(currentResult.reportId)
    return currentResult
  }, [generate, evaluate])

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
