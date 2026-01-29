import { cn } from '@lib/utils'
import { STEP_ORDER } from '@config/constants'
import type { Step } from '@appTypes/index'

interface SidebarProps {
  currentStep: Step
  completedSteps: Step[]
  sessionId?: string
  onNewSession?: () => void
}

const STEP_LABELS: Record<Step, string> = {
  select_engine: 'Select Engine',
  configure_projects: 'Configure Project',
  upload_template: 'Upload Template',
  check_fetched_data: 'Project Data',
  check_mapping: 'Check Mapping',
  mapping: 'Field Mapping',
  long_text_options: 'Text Options',
  generating: 'Generating',
  evaluating: 'Evaluating',
  done: 'Done',
}

// Steps that can be skipped/hidden in sidebar when not used
const SKIPPABLE_STEPS: Step[] = ['check_fetched_data', 'check_mapping']

export function Sidebar({ currentStep, completedSteps, sessionId, onNewSession }: SidebarProps) {
  const currentIndex = STEP_ORDER.indexOf(currentStep)

  // Filter out skippable steps unless they are the current step
  const visibleSteps = STEP_ORDER.filter(
    (step) => !SKIPPABLE_STEPS.includes(step) || step === currentStep
  )

  return (
    <aside className="w-64 bg-gray-50 border-r border-gray-200 p-4 flex flex-col relative overflow-hidden">
      <nav className="space-y-2 flex-1">
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

      {/* Session ID for debugging */}
      {sessionId && (
        <div className="pt-4 border-t border-gray-200 mt-4">
          <button
            onClick={onNewSession}
            title="Click to create a new session"
            className="text-[10px] text-gray-400 font-mono break-all hover:text-blue-600 transition-colors cursor-pointer text-left"
          >
            {sessionId}
          </button>
        </div>
      )}
      <img
        src="/mini.png"
        alt=""
        className="absolute bottom-32 left-1/2 -translate-x-1/2 w-36 opacity-[0.06] pointer-events-none select-none"
      />
      <div className="absolute bottom-0 left-0 w-full h-20 pointer-events-none overflow-hidden">
        <div className="absolute bottom-3 -left-4 w-48 h-[2px] bg-[#3C51E2] opacity-10 rotate-[-15deg] rounded-full" />
        <div className="absolute bottom-7 -left-2 w-40 h-[2px] bg-[#3C51E2] opacity-[0.07] rotate-[-15deg] rounded-full" />
        <div className="absolute bottom-11 left-0 w-32 h-[2px] bg-[#3C51E2] opacity-[0.05] rotate-[-15deg] rounded-full" />
      </div>
    </aside>
  )
}
