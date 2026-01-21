import { useState, useCallback } from 'react'
import type { Engine } from '@appTypes/index'
import type { GenerateResponse, EvaluateResponse } from '@appTypes/api'
import { invokeFunction } from '@lib/supabase'
import { EVALUATION_THRESHOLD, MAX_ITERATIONS } from '@config/constants'
import type { GenerationStep } from '@ui/generation'

interface GenerationResult {
  pptxUrl: string
  reportId: string
  iteration: number
}

interface UseGenerateReturn {
  generating: boolean
  evaluating: boolean
  fetching: boolean
  currentStep: GenerationStep
  error: string | null
  result: GenerationResult | null
  evaluation: EvaluateResponse | null
  generate: () => Promise<GenerationResult | null>
  evaluate: (reportId: string) => Promise<EvaluateResponse | null>
  generateWithEvaluation: () => Promise<GenerationResult | null>
}

export function useGenerate(sessionId: string, engine: Engine | null): UseGenerateReturn {
  const [generating, setGenerating] = useState(false)
  const [evaluating, setEvaluating] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [currentStep, setCurrentStep] = useState<GenerationStep>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<GenerationResult | null>(null)
  const [evaluation, setEvaluation] = useState<EvaluateResponse | null>(null)

  const generate = useCallback(async (): Promise<GenerationResult | null> => {
    if (!engine) {
      setError('No engine selected')
      setCurrentStep('error')
      return null
    }

    // Start with fetching state (data fetch happens in backend if needed)
    setFetching(true)
    setCurrentStep('fetching')
    setError(null)

    try {
      const functionName =
        engine === 'claude-pptx' ? 'generate-claude-pptx' : 'generate-gamma'

      // After a brief moment, transition to generating state
      // The backend does fetch + generate in one call
      const fetchTimeout = setTimeout(() => {
        setFetching(false)
        setGenerating(true)
        setCurrentStep('generating')
      }, 2000) // Show fetching for 2 seconds minimum

      const response = await invokeFunction<GenerateResponse>(functionName, sessionId)

      // Clear timeout if response came back quickly
      clearTimeout(fetchTimeout)
      setFetching(false)
      setGenerating(false)

      if (!response.success) {
        throw new Error(response.error || 'Generation failed')
      }

      const generationResult: GenerationResult = {
        pptxUrl: response.pptxUrl,
        reportId: response.reportId,
        iteration: 1,
      }

      setResult(generationResult)
      return generationResult
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Generation failed'
      setError(message)
      setCurrentStep('error')
      return null
    } finally {
      setFetching(false)
      setGenerating(false)
    }
  }, [sessionId, engine])

  const evaluate = useCallback(
    async (reportId: string): Promise<EvaluateResponse | null> => {
      setEvaluating(true)
      setCurrentStep('evaluating')
      setError(null)

      try {
        const response = await invokeFunction<EvaluateResponse>('evaluate', sessionId, {
          reportId,
        })

        setEvaluation(response)
        setCurrentStep('done')
        return response
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Evaluation failed'
        setError(message)
        setCurrentStep('error')
        return null
      } finally {
        setEvaluating(false)
      }
    },
    [sessionId]
  )

  const generateWithEvaluation = useCallback(async (): Promise<GenerationResult | null> => {
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
      setResult(currentResult)
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
    generate,
    evaluate,
    generateWithEvaluation,
  }
}
