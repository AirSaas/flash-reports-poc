import { cn } from '@lib/utils'

export type GenerationStep = 'idle' | 'fetching' | 'generating' | 'evaluating' | 'done' | 'error'

interface GenerationProgressProps {
  generating: boolean
  evaluating: boolean
  fetching?: boolean
  currentStep?: GenerationStep
  iteration: number
  error: string | null
}

const STEP_MESSAGES: Record<GenerationStep, string> = {
  idle: '',
  fetching: 'Fetching project data from AirSaas...',
  generating: 'Creating your presentation...',
  evaluating: 'Checking quality...',
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
}: GenerationProgressProps) {
  // Determine step from props if not explicitly provided
  const activeStep: GenerationStep = currentStep ?? (
    fetching ? 'fetching' :
    generating ? 'generating' :
    evaluating ? 'evaluating' :
    error ? 'error' : 'idle'
  )

  const steps = [
    { id: 'fetching', label: 'Fetching Project Data', active: activeStep === 'fetching', done: ['generating', 'evaluating', 'done'].includes(activeStep) },
    { id: 'generating', label: 'Generating PPTX', active: activeStep === 'generating', done: ['evaluating', 'done'].includes(activeStep) },
    { id: 'evaluating', label: 'Evaluating Quality', active: activeStep === 'evaluating', done: activeStep === 'done' },
  ]

  const isProcessing = ['fetching', 'generating', 'evaluating'].includes(activeStep)

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
      {isProcessing && (
        <div className="bg-gray-100 rounded-lg p-4">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-gray-600">
              {STEP_MESSAGES[activeStep]}
            </span>
          </div>
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      )}
    </div>
  )
}
