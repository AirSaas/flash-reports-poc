import { useState, useEffect, useRef } from 'react'
import { cn } from '@lib/utils'

export type GenerationStep = 'idle' | 'fetching' | 'generating' | 'evaluating' | 'done' | 'error'

const COUNTDOWN_SECONDS = 8 * 60 // 8 minutes

function useCountdown(active: boolean) {
  const [remaining, setRemaining] = useState(COUNTDOWN_SECONDS)
  const startTimeRef = useRef<number | null>(null)

  useEffect(() => {
    if (!active) {
      setRemaining(COUNTDOWN_SECONDS)
      startTimeRef.current = null
      return
    }

    if (!startTimeRef.current) {
      startTimeRef.current = Date.now()
    }

    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current!) / 1000)
      const left = Math.max(0, COUNTDOWN_SECONDS - elapsed)
      setRemaining(left)
    }, 1000)

    return () => clearInterval(interval)
  }, [active])

  const minutes = Math.floor(remaining / 60)
  const seconds = remaining % 60
  const progress = 1 - remaining / COUNTDOWN_SECONDS

  return { minutes, seconds, progress, remaining }
}

interface GenerationProgressProps {
  generating: boolean
  evaluating: boolean
  fetching?: boolean
  currentStep?: GenerationStep
  iteration: number
  error: string | null
  onRetry?: () => void
  pptxUrl?: string | null
  pdfUrl?: string | null
  prompt?: string | null
  onDownload?: () => void
  onDownloadPrompt?: () => void
  onDownloadPptx?: () => void
  generatedPptxUrl?: string | null
  isHtmlEngine?: boolean
}

const STEP_MESSAGES: Record<GenerationStep, string> = {
  idle: '',
  fetching: 'Fetching project data from AirSaas...',
  generating: 'Creating your presentation...',
  evaluating: 'Analyzing quality with AI (this may take a few minutes)...',
  done: 'Complete!',
  error: 'An error occurred',
}

export function GenerationProgress({
  generating,
  evaluating,
  fetching = false,
  currentStep,
  iteration,
  error,
  onRetry,
  pptxUrl,
  pdfUrl,
  prompt,
  onDownload,
  onDownloadPrompt,
  onDownloadPptx,
  generatedPptxUrl,
  isHtmlEngine = false,
}: GenerationProgressProps) {
  const { minutes, seconds, progress } = useCountdown(
    (currentStep ?? (fetching ? 'fetching' : generating ? 'generating' : 'idle')) === 'generating'
  )

  const downloadButtonText = isHtmlEngine
    ? (pdfUrl ? 'Download PDF' : 'Open Report')
    : 'Download PPTX'

  // Determine step from props if not explicitly provided
  const activeStep: GenerationStep = currentStep ?? (
    fetching ? 'fetching' :
    generating ? 'generating' :
    evaluating ? 'evaluating' :
    error ? 'error' : 'idle'
  )

  const steps = [
    { id: 'fetching', label: 'Fetching Project Data', active: activeStep === 'fetching', done: ['generating', 'evaluating', 'done'].includes(activeStep) },
    { id: 'generating', label: isHtmlEngine ? 'Generating Report' : 'Generating PPTX', active: activeStep === 'generating', done: ['evaluating', 'done'].includes(activeStep) },
    { id: 'evaluating', label: 'Evaluating Quality', active: activeStep === 'evaluating', done: activeStep === 'done' },
  ]

  const isProcessing = ['fetching', 'generating'].includes(activeStep)
  const isEvaluating = activeStep === 'evaluating'
  const canDownload = !!pptxUrl && (activeStep === 'evaluating' || activeStep === 'done')

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">
        Generating Report{iteration > 1 ? ` (Attempt ${iteration})` : ''}
      </h2>
      <div className="space-y-3">
        {steps.map((step, index) => (
          <div key={step.id} className="flex items-center gap-3">
            <div
              className={cn(
                'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors',
                step.active
                  ? 'bg-blue-600 text-white animate-pulse'
                  : step.done
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-200 text-gray-600'
              )}
            >
              {step.done ? '✓' : index + 1}
            </div>
            <span
              className={cn(
                'text-sm',
                step.active ? 'text-blue-600 font-medium' :
                step.done ? 'text-green-600' : 'text-gray-600'
              )}
            >
              {step.label}
              {step.active && '...'}
            </span>
          </div>
        ))}
      </div>

      {/* Processing message for fetching/generating */}
      {isProcessing && (
        <div className="bg-gray-100 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-gray-600">
              {STEP_MESSAGES[activeStep]}
            </span>
          </div>
          {activeStep === 'generating' && (
            <div className="space-y-2">
              <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-1000 ease-linear"
                  style={{ width: `${Math.min(progress * 100, 100)}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 text-center">
                Estimated time remaining: {minutes}:{seconds.toString().padStart(2, '0')}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Download available during evaluation - user can download while quality check runs */}
      {isEvaluating && canDownload && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl">✅</span>
            <div className="flex-1">
              <p className="text-green-800 font-semibold">{isHtmlEngine ? 'PDF Ready!' : 'PPTX Ready!'}</p>
              <p className="text-green-600 text-sm">Download while quality check runs in background.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={onDownload}
              className="flex-1 bg-green-600 text-white rounded-lg py-2.5 px-4 font-medium hover:bg-green-700 transition-colors flex items-center justify-center gap-2"
            >
              <span>📥</span>
              {downloadButtonText}
            </button>
            {generatedPptxUrl && onDownloadPptx && (
              <button
                onClick={onDownloadPptx}
                className="bg-blue-600 text-white rounded-lg py-2.5 px-4 font-medium hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
              >
                <span>📊</span>
                PPTX
              </button>
            )}
            {prompt && onDownloadPrompt && (
              <button
                onClick={onDownloadPrompt}
                className="bg-gray-100 text-gray-700 rounded-lg py-2.5 px-4 font-medium hover:bg-gray-200 transition-colors flex items-center justify-center gap-2"
                title="Download the prompt sent to Gamma"
              >
                <span>📄</span>
                Prompt
              </button>
            )}
          </div>
          {/* Evaluation progress indicator */}
          <div className="flex items-center gap-2 pt-2 border-t border-green-200">
            <div className="w-3 h-3 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-gray-500">
              {STEP_MESSAGES.evaluating}
            </span>
          </div>
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-red-500">❌</span>
            <p className="text-red-600 text-sm font-medium">Error occurred</p>
          </div>
          <p className="text-red-600 text-sm">{error}</p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="w-full py-2 px-4 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors font-medium text-sm"
            >
              Try again
            </button>
          )}
        </div>
      )}
      {activeStep === 'done' && pptxUrl && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-6 space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-3xl">✅</span>
            <div>
              <p className="text-green-800 font-semibold text-lg">Report Generated Successfully!</p>
              <p className="text-green-600 text-sm">Your {isHtmlEngine ? 'PDF report' : 'presentation'} is ready for download.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={onDownload}
              className="flex-1 bg-green-600 text-white rounded-lg py-3 px-4 font-medium hover:bg-green-700 transition-colors flex items-center justify-center gap-2"
            >
              <span className="text-xl">📥</span>
              {downloadButtonText}
            </button>
            {generatedPptxUrl && onDownloadPptx && (
              <button
                onClick={onDownloadPptx}
                className="flex-1 bg-blue-600 text-white rounded-lg py-3 px-4 font-medium hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
              >
                <span className="text-xl">📊</span>
                Download PPTX
              </button>
            )}
            {prompt && onDownloadPrompt && (
              <button
                onClick={onDownloadPrompt}
                className="bg-gray-100 text-gray-700 rounded-lg py-3 px-4 font-medium hover:bg-gray-200 transition-colors flex items-center justify-center gap-2"
                title="Download the prompt sent to Gamma"
              >
                <span className="text-xl">📄</span>
                Prompt
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
