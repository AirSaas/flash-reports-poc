import { cn } from '@lib/utils'
import type { EvaluationResult as EvalResult } from '@appTypes/api'
import { getScoreColor, getScoreLabel } from '@services/evaluate.service'

interface EvaluationResultProps {
  evaluation: EvalResult
  onRegenerate?: () => void
  showRegenerate?: boolean
}

export function EvaluationResult({
  evaluation,
  onRegenerate,
  showRegenerate = false,
}: EvaluationResultProps) {
  const { score, completeness, accuracy, formatting, issues, recommendation } = evaluation

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">Quality Evaluation</h2>
      <div className="bg-gray-50 rounded-lg p-4 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">Overall Score</span>
          <span className={cn('text-2xl font-bold', getScoreColor(score))}>
            {score}/100
          </span>
        </div>
        <div className="text-center">
          <span
            className={cn(
              'inline-block px-3 py-1 rounded-full text-sm font-medium',
              recommendation === 'pass'
                ? 'bg-green-100 text-green-800'
                : 'bg-yellow-100 text-yellow-800'
            )}
          >
            {getScoreLabel(score)}
          </span>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">Completeness</span>
            <span className="font-medium">{completeness}/40</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full"
              style={{ width: `${(completeness / 40) * 100}%` }}
            />
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">Accuracy</span>
            <span className="font-medium">{accuracy}/40</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-green-600 h-2 rounded-full"
              style={{ width: `${(accuracy / 40) * 100}%` }}
            />
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">Formatting</span>
            <span className="font-medium">{formatting}/20</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-purple-600 h-2 rounded-full"
              style={{ width: `${(formatting / 20) * 100}%` }}
            />
          </div>
        </div>
        {issues.length > 0 && (
          <div className="pt-2 border-t border-gray-200">
            <p className="text-sm font-medium text-gray-700 mb-2">Issues Found:</p>
            <ul className="space-y-1">
              {issues.map((issue, index) => (
                <li key={index} className="text-sm text-gray-600 flex items-start gap-2">
                  <span className="text-yellow-500">⚠</span>
                  {issue}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {showRegenerate && recommendation === 'regenerate' && onRegenerate && (
        <button
          onClick={onRegenerate}
          className="w-full border border-blue-600 text-blue-600 rounded-lg py-2 px-4 font-medium hover:bg-blue-50 transition-colors"
        >
          Regenerate Report
        </button>
      )}
    </div>
  )
}
