import { cn } from '@lib/utils'
import { STEP_ORDER } from '@config/constants'
import type { Step } from '@appTypes/index'

interface SidebarProps {
  currentStep: Step
  completedSteps: Step[]
}

const STEP_LABELS: Record<Step, string> = {
  select_engine: 'Select Engine',
  upload_template: 'Upload Template',
  check_mapping: 'Check Mapping',
  mapping: 'Field Mapping',
  long_text_options: 'Text Options',
  generating: 'Generating',
  evaluating: 'Evaluating',
  done: 'Done',
}

// Steps that can be skipped/hidden in sidebar when not used
const SKIPPABLE_STEPS: Step[] = ['check_mapping']

export function Sidebar({ currentStep, completedSteps }: SidebarProps) {
  const currentIndex = STEP_ORDER.indexOf(currentStep)

  // Filter out skippable steps unless they are the current step
  const visibleSteps = STEP_ORDER.filter(
    (step) => !SKIPPABLE_STEPS.includes(step) || step === currentStep
  )

  return (
    <aside className="w-64 bg-gray-50 border-r border-gray-200 p-4">
      <nav className="space-y-2">
        {visibleSteps.map((step, index) => {
          const isCompleted = completedSteps.includes(step)
          const isCurrent = step === currentStep
          const stepIndex = STEP_ORDER.indexOf(step)
          const isPast = stepIndex < currentIndex

          return (
            <div
              key={step}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm',
                isCurrent && 'bg-blue-100 text-blue-800 font-medium',
                isCompleted && !isCurrent && 'text-green-700',
                !isCurrent && !isCompleted && !isPast && 'text-gray-400'
              )}
            >
              <div
                className={cn(
                  'w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium',
                  isCurrent && 'bg-blue-600 text-white',
                  isCompleted && !isCurrent && 'bg-green-600 text-white',
                  !isCurrent && !isCompleted && 'bg-gray-300 text-gray-600'
                )}
              >
                {isCompleted && !isCurrent ? '✓' : index + 1}
              </div>
              <span>{STEP_LABELS[step]}</span>
            </div>
          )
        })}
      </nav>
    </aside>
  )
}
