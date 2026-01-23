import { cn } from '@lib/utils'
import { LONG_TEXT_STRATEGIES } from '@config/constants'
import type { LongTextStrategy } from '@appTypes/index'

interface LongTextOptionsProps {
  selected: LongTextStrategy | null
  onSelect: (strategy: LongTextStrategy) => void
  onContinue: () => void
  disabled?: boolean
  loading?: boolean
}

export function LongTextOptions({
  selected,
  onSelect,
  onContinue,
  disabled = false,
  loading = false,
}: LongTextOptionsProps) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">Long Text Handling</h2>
      <p className="text-sm text-gray-600">
        How should we handle fields with long text content that may not fit in the slide layout?
      </p>
      <div className="space-y-3">
        {Object.values(LONG_TEXT_STRATEGIES).map((strategy) => (
          <button
            key={strategy.id}
            onClick={() => onSelect(strategy.id as LongTextStrategy)}
            disabled={disabled}
            className={cn(
              'w-full p-4 rounded-lg border-2 text-left transition-all',
              selected === strategy.id
                ? 'border-blue-600 bg-blue-50'
                : 'border-gray-200 hover:border-gray-300',
              disabled && 'opacity-50 cursor-not-allowed'
            )}
          >
            <h3 className="font-medium text-gray-900">{strategy.name}</h3>
            <p className="text-sm text-gray-600 mt-1">{strategy.description}</p>
          </button>
        ))}
      </div>
      <button
        onClick={onContinue}
        disabled={!selected || disabled || loading}
        className="w-full bg-blue-600 text-white rounded-lg py-2 px-4 font-medium hover:bg-blue-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
      >
        {loading ? 'Loading...' : 'Continue to Generation'}
      </button>
    </div>
  )
}
