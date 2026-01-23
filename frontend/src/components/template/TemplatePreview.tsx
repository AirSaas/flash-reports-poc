import { cn } from '@lib/utils'

interface TemplatePreviewProps {
  templatePath: string
  onContinue: () => void
  loading?: boolean
}

export function TemplatePreview({ templatePath, onContinue, loading = false }: TemplatePreviewProps) {
  const fileName = templatePath.split('/').pop() || templatePath

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">Template Uploaded</h2>
      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">✅</span>
          <div>
            <p className="font-medium text-green-800">Template ready</p>
            <p className="text-sm text-green-600">{fileName}</p>
          </div>
        </div>
      </div>
      <button
        onClick={onContinue}
        disabled={loading}
        className={cn(
          'w-full rounded-lg py-2 px-4 font-medium transition-colors',
          loading
            ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
            : 'bg-blue-600 text-white hover:bg-blue-700'
        )}
      >
        {loading ? 'Loading...' : 'Continue to Mapping'}
      </button>
    </div>
  )
}
