import { cn } from '@lib/utils'
import { ENGINE_OPTIONS } from '@config/constants'
import type { Engine } from '@appTypes/index'

interface EngineSelectorProps {
  selected: Engine | null
  onSelect: (engine: Engine) => void
  disabled?: boolean
}

export function EngineSelector({ selected, onSelect, disabled = false }: EngineSelectorProps) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">Select Generation Engine</h2>
      <p className="text-sm text-gray-600">
        Choose how you want to generate your PowerPoint presentation.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Object.values(ENGINE_OPTIONS).map((engine) => (
          <button
            key={engine.id}
            onClick={() => onSelect(engine.id as Engine)}
            disabled={disabled}
            className={cn(
              'p-4 rounded-lg border-2 text-left transition-all',
              selected === engine.id
                ? 'border-blue-600 bg-blue-50'
                : 'border-gray-200 hover:border-gray-300',
              disabled && 'opacity-50 cursor-not-allowed'
            )}
          >
            <h3 className="font-medium text-gray-900">{engine.name}</h3>
            <p className="text-sm text-gray-600 mt-1">{engine.description}</p>
          </button>
        ))}
      </div>
    </div>
  )
}
