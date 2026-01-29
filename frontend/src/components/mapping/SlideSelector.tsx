import { useState, useCallback } from 'react'
import { cn } from '@lib/utils'
import type { SlideInfo } from '@services/python-backend.service'

interface SlideSelectorProps {
  slides: SlideInfo[]
  onConfirm: (selectedSlideNumbers: number[]) => void
  onAutoAnalyze: () => void
  loading?: boolean
}

export function SlideSelector({
  slides,
  onConfirm,
  onAutoAnalyze,
  loading = false,
}: SlideSelectorProps) {
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const toggleSlide = useCallback((slideNumber: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(slideNumber)) {
        next.delete(slideNumber)
      } else {
        next.add(slideNumber)
      }
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    setSelected(new Set(slides.map((s) => s.slide_number)))
  }, [slides])

  const deselectAll = useCallback(() => {
    setSelected(new Set())
  }, [])

  const handleConfirm = useCallback(() => {
    if (selected.size > 0 && !loading) {
      onConfirm(Array.from(selected).sort((a, b) => a - b))
    }
  }, [selected, loading, onConfirm])

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">
          Select Unique Slide Templates
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          Your template has {slides.length} slides. Select only the <strong>unique layouts</strong> — skip repeated slides that share the same structure with different project data.
        </p>
      </div>

      {/* Quick actions */}
      <div className="flex items-center gap-3 text-sm">
        <button
          onClick={selectAll}
          disabled={loading}
          className="text-blue-600 hover:text-blue-800 transition-colors"
        >
          Select all
        </button>
        <span className="text-gray-300">|</span>
        <button
          onClick={deselectAll}
          disabled={loading}
          className="text-blue-600 hover:text-blue-800 transition-colors"
        >
          Deselect all
        </button>
        <span className="text-gray-300">|</span>
        <span className="text-gray-500">{selected.size} of {slides.length} selected</span>
      </div>

      {/* Slide list */}
      <div className="space-y-1.5 max-h-[50vh] overflow-y-auto">
        {slides.map((slide) => (
          <button
            key={slide.slide_number}
            type="button"
            onClick={() => toggleSlide(slide.slide_number)}
            disabled={loading}
            className={cn(
              'w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left',
              selected.has(slide.slide_number)
                ? 'border-blue-300 bg-blue-50'
                : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
            )}
          >
            {/* Checkbox */}
            <div
              className={cn(
                'w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors',
                selected.has(slide.slide_number)
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-gray-300'
              )}
            >
              {selected.has(slide.slide_number) && (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>

            {/* Slide number */}
            <span className="w-8 h-8 rounded bg-gray-200 text-gray-700 text-sm font-medium flex items-center justify-center flex-shrink-0">
              {slide.slide_number}
            </span>

            {/* Slide info */}
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-900 truncate">{slide.title}</p>
              <p className="text-xs text-gray-500">
                Layout: {slide.layout} · {slide.shape_count} shapes
              </p>
            </div>
          </button>
        ))}
      </div>

      {/* Actions */}
      <div className="space-y-3 pt-2">
        <button
          onClick={handleConfirm}
          disabled={selected.size === 0 || loading}
          className={cn(
            'w-full py-2.5 px-4 rounded-lg font-medium transition-colors',
            selected.size > 0 && !loading
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-gray-200 text-gray-500 cursor-not-allowed'
          )}
        >
          {loading ? 'Analyzing...' : `Analyze ${selected.size} selected slide${selected.size !== 1 ? 's' : ''}`}
        </button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-white px-2 text-gray-400">or</span>
          </div>
        </div>

        <button
          onClick={onAutoAnalyze}
          disabled={loading}
          className="w-full py-2 px-4 text-sm text-blue-600 hover:text-blue-800 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
        >
          Auto-detect with AI (~1.5 min)
        </button>
      </div>
    </div>
  )
}
