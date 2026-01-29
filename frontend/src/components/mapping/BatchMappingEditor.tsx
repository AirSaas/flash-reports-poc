import { useState, useCallback, useMemo } from 'react'
import { cn } from '@lib/utils'

interface MappingOption {
  id: string
  label: string
  description?: string
}

interface FieldWithSuggestion {
  id: string
  name: string
  placeholder_text?: string
  data_type?: string
  location?: string
  slide_number?: number
  suggested_mapping: string
  confidence: 'high' | 'medium' | 'low'
  reasoning?: string
}

interface BatchMappingEditorProps {
  fields: FieldWithSuggestion[]
  allOptions: MappingOption[]
  onSubmit: (mappings: Record<string, string>) => void
  onReset?: () => void
  loading?: boolean
}

export function BatchMappingEditor({
  fields,
  allOptions,
  onSubmit,
  onReset,
  loading = false,
}: BatchMappingEditorProps) {
  // Initialize mappings with suggested values
  const [mappings, setMappings] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    fields.forEach((field) => {
      initial[field.id] = field.suggested_mapping || 'none'
    })
    return initial
  })

  // Search filter for dropdowns
  const [searchTerm, setSearchTerm] = useState('')
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null)

  const handleMappingChange = useCallback((fieldId: string, value: string) => {
    setMappings((prev) => ({ ...prev, [fieldId]: value }))
    setActiveDropdown(null)
    setSearchTerm('')
  }, [])

  const handleSubmit = useCallback(() => {
    if (!loading) {
      onSubmit(mappings)
    }
  }, [mappings, loading, onSubmit])

  // Filter options based on search
  const filteredOptions = useMemo(() => {
    if (!searchTerm) return allOptions
    const lower = searchTerm.toLowerCase()
    return allOptions.filter(
      (opt) =>
        opt.label.toLowerCase().includes(lower) ||
        opt.id.toLowerCase().includes(lower) ||
        opt.description?.toLowerCase().includes(lower)
    )
  }, [allOptions, searchTerm])

  // Count stats
  const mappedCount = Object.values(mappings).filter((v) => v && v !== 'none').length
  const totalCount = fields.length

  // Get label for a mapping id
  const getOptionLabel = (id: string) => {
    if (id === 'none') return 'Skip (no mapping)'
    const option = allOptions.find((o) => o.id === id)
    return option?.label || id
  }

  // Confidence badge colors
  const confidenceColors = {
    high: 'bg-green-100 text-green-700',
    medium: 'bg-yellow-100 text-yellow-700',
    low: 'bg-gray-100 text-gray-600',
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header - Fixed */}
      <div className="flex items-center justify-between pb-4 border-b border-gray-200">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            Map Template Fields
          </h2>
          <p className="text-sm text-gray-500">
            {mappedCount} of {totalCount} fields mapped
          </p>
        </div>
        <button
          onClick={handleSubmit}
          disabled={loading}
          className={cn(
            'px-4 py-2 rounded-lg font-medium transition-colors',
            loading
              ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          )}
        >
          {loading ? 'Saving...' : 'Confirm All'}
        </button>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto mt-4 max-h-[60vh]">
        <div className="space-y-2">
          {fields.map((field) => (
            <div
              key={field.id}
              className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
            >
              {/* Field Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900 truncate">
                    {field.name}
                  </span>
                  {field.slide_number && (
                    <span className="text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded flex-shrink-0">
                      Slide {field.slide_number}
                    </span>
                  )}
                </div>
                {field.data_type && (
                  <span className="text-xs text-gray-500">
                    {field.data_type}
                  </span>
                )}
              </div>

              {/* Dropdown */}
              <div className="relative w-64 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setActiveDropdown(activeDropdown === field.id ? null : field.id)
                    setSearchTerm('')
                  }}
                  disabled={loading}
                  className={cn(
                    'w-full px-3 py-2 text-left text-sm border rounded-lg',
                    'bg-white hover:border-gray-400 transition-colors',
                    'flex items-center justify-between',
                    mappings[field.id] === 'none'
                      ? 'text-gray-400 border-gray-200'
                      : 'text-gray-900 border-gray-300',
                    loading && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  <span className="truncate">{getOptionLabel(mappings[field.id])}</span>
                  <svg
                    className={cn(
                      'w-4 h-4 text-gray-400 transition-transform flex-shrink-0',
                      activeDropdown === field.id && 'rotate-180'
                    )}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Dropdown Menu */}
                {activeDropdown === field.id && (
                  <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg">
                    {/* Search Input */}
                    <div className="p-2 border-b border-gray-100">
                      <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Search fields..."
                        className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                        autoFocus
                      />
                    </div>
                    {/* Options List */}
                    <div className="max-h-48 overflow-y-auto">
                      {filteredOptions.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => handleMappingChange(field.id, option.id)}
                          className={cn(
                            'w-full px-3 py-2 text-left text-sm hover:bg-gray-50',
                            'border-b border-gray-50 last:border-b-0',
                            mappings[field.id] === option.id && 'bg-blue-50 text-blue-700'
                          )}
                        >
                          <div className="font-medium">{option.label}</div>
                          {option.description && (
                            <div className="text-xs text-gray-500 truncate">
                              {option.description}
                            </div>
                          )}
                        </button>
                      ))}
                      {filteredOptions.length === 0 && (
                        <div className="px-3 py-2 text-sm text-gray-500">
                          No matching fields
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Confidence Badge */}
              <div className="flex-shrink-0 w-20">
                <span
                  className={cn(
                    'inline-flex items-center px-2 py-1 rounded text-xs font-medium',
                    confidenceColors[field.confidence]
                  )}
                >
                  {field.confidence}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="pt-4 mt-4 border-t border-gray-200 space-y-3">
        <p className="text-xs text-gray-500">
          AI suggestions are pre-filled based on field names and sample data.
          Review and adjust as needed before confirming.
        </p>
        {onReset && (
          <p className="text-sm text-gray-500 text-center py-2">
            Mapping doesn't look right?{' '}
            <button
              onClick={onReset}
              disabled={loading}
              className="underline text-gray-600 hover:text-gray-900 transition-colors disabled:opacity-50"
            >
              Re-analyze template
            </button>
          </p>
        )}
      </div>
    </div>
  )
}
