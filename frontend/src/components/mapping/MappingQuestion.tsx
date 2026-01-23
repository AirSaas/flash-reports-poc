import { useState, useEffect, useCallback } from 'react'
import { cn } from '@lib/utils'

interface MappingOption {
  id: string
  label: string
  description?: string
  confidence?: string
}

interface TemplateField {
  id: string
  name: string
  placeholder_text: string
  data_type: string
  location: string
  slide_number?: number
}

interface MappingQuestionProps {
  currentIndex: number
  totalFields: number
  field: TemplateField
  question: string
  suggestedOptions: MappingOption[]
  allOptions: MappingOption[]
  reasoning?: string
  confidence?: string
  onAnswer: (fieldId: string, answer: string) => void
  loading?: boolean
}

export function MappingQuestion({
  currentIndex,
  totalFields,
  field,
  question,
  suggestedOptions,
  allOptions,
  reasoning: _reasoning,
  confidence,
  onAnswer,
  loading = false,
}: MappingQuestionProps) {
  const [showAllOptions, setShowAllOptions] = useState(false)
  const [customValue, setCustomValue] = useState('')

  // Pre-select the first suggested option (highest confidence)
  const [selectedOption, setSelectedOption] = useState<string | null>(
    suggestedOptions.length > 0 ? suggestedOptions[0].id : null
  )

  // Update selection when suggestedOptions change (new field)
  useEffect(() => {
    if (suggestedOptions.length > 0) {
      setSelectedOption(suggestedOptions[0].id)
      setCustomValue('')
      setShowAllOptions(false)
    }
  }, [suggestedOptions, field.id])

  const handleSubmit = useCallback(() => {
    if (selectedOption && !loading) {
      onAnswer(field.id, selectedOption)
    }
  }, [selectedOption, loading, onAnswer, field.id])

  // Handle Enter key to confirm
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && selectedOption && !loading) {
        e.preventDefault()
        handleSubmit()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSubmit, selectedOption, loading])

  const progress = ((currentIndex) / totalFields) * 100

  return (
    <div className="space-y-5">
      {/* Progress */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm text-gray-600">
          <span>Field {currentIndex + 1} of {totalFields}</span>
          <span>{Math.round(progress)}% complete</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Field Info */}
      <div className="bg-gray-50 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-gray-900">{field.name}</h3>
          {field.slide_number && (
            <span className="text-xs bg-gray-200 text-gray-600 px-2 py-1 rounded">
              Slide {field.slide_number}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-sm">
            {field.data_type}
          </span>
          <span className="bg-purple-100 text-purple-700 px-2 py-1 rounded text-sm">
            {field.location}
          </span>
        </div>
      </div>

      {/* Question */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900">{question}</h2>
        {confidence && (
          <span className={cn(
            'inline-block mt-2 px-2 py-1 rounded text-sm',
            confidence === 'high' && 'bg-green-100 text-green-700',
            confidence === 'medium' && 'bg-yellow-100 text-yellow-700',
            confidence === 'low' && 'bg-red-100 text-red-700'
          )}>
            {confidence} confidence
          </span>
        )}
      </div>

      {/* Suggested Options */}
      <div className="space-y-3">
        <p className="text-sm font-medium text-gray-700">Suggested mappings:</p>
        <div className="space-y-2">
          {suggestedOptions.map((option) => (
            <button
              key={option.id}
              onClick={() => setSelectedOption(option.id)}
              disabled={loading}
              className={cn(
                'w-full p-3 rounded-lg border text-left transition-all',
                selectedOption === option.id
                  ? 'border-blue-600 bg-blue-50 ring-2 ring-blue-200'
                  : 'border-gray-200 hover:border-gray-300',
                loading && 'opacity-50 cursor-not-allowed'
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-gray-900">{option.label}</span>
                {option.confidence && (
                  <span className={cn(
                    'text-xs px-2 py-1 rounded',
                    option.confidence === 'high' && 'bg-green-100 text-green-700',
                    option.confidence === 'medium' && 'bg-yellow-100 text-yellow-700',
                    option.confidence === 'low' && 'bg-gray-100 text-gray-600'
                  )}>
                    {option.confidence}
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-500 mt-1">{option.id}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Show All Options - collapsible */}
      <div>
        <button
          onClick={() => setShowAllOptions(!showAllOptions)}
          className="text-sm text-blue-600 hover:text-blue-700"
        >
          {showAllOptions ? '▼ Hide all options' : '▶ Show all available fields'}
        </button>

        {showAllOptions && (
          <div className="mt-3 max-h-48 overflow-y-auto border border-gray-200 rounded-lg">
            {allOptions.map((option) => (
              <button
                key={option.id}
                onClick={() => setSelectedOption(option.id)}
                disabled={loading}
                className={cn(
                  'w-full p-2 text-left text-sm border-b border-gray-100 last:border-b-0',
                  selectedOption === option.id
                    ? 'bg-blue-50 text-blue-800'
                    : 'hover:bg-gray-50'
                )}
              >
                <span className="font-medium">{option.label}</span>
                {option.description && (
                  <span className="text-gray-500 ml-2">- {option.description}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Custom Input */}
      <div className="border-t border-gray-200 pt-4">
        <p className="text-sm text-gray-600 mb-2">Or enter a custom path:</p>
        <input
          type="text"
          value={customValue}
          onChange={(e) => {
            setCustomValue(e.target.value)
            setSelectedOption(e.target.value)
          }}
          placeholder="e.g., project.custom_field"
          className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Submit Button */}
      <button
        onClick={handleSubmit}
        disabled={!selectedOption || loading}
        className={cn(
          'w-full py-3 px-4 rounded-lg font-medium transition-colors',
          selectedOption && !loading
            ? 'bg-blue-600 text-white hover:bg-blue-700'
            : 'bg-gray-200 text-gray-500 cursor-not-allowed'
        )}
      >
        {loading ? (
          'Processing...'
        ) : (
          <span className="flex items-center justify-center gap-2">
            Confirm & Next
            <kbd className="inline-flex items-center px-2 py-0.5 text-xs bg-blue-700/50 rounded">
              Enter ↵
            </kbd>
          </span>
        )}
      </button>
    </div>
  )
}
