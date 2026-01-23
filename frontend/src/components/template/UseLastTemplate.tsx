import { cn } from '@lib/utils'

interface UseLastTemplateProps {
  lastTemplateId: string
  onUseLastTemplate: () => void
  onUploadNew: () => void
  loading?: boolean
}

export function UseLastTemplate({
  lastTemplateId,
  onUseLastTemplate,
  onUploadNew,
  loading = false,
}: UseLastTemplateProps) {
  const fileName = lastTemplateId.split('/').pop() || lastTemplateId

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">Previous Template Found</h2>
      <p className="text-sm text-gray-600">
        Would you like to use your previous template or upload a new one?
      </p>
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">📄</span>
          <div>
            <p className="font-medium text-gray-900">Previous template</p>
            <p className="text-sm text-gray-600">{fileName}</p>
          </div>
        </div>
      </div>
      <div className="flex gap-3">
        <button
          onClick={onUseLastTemplate}
          disabled={loading}
          className={cn(
            'flex-1 rounded-lg py-2 px-4 font-medium transition-colors',
            loading
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          )}
        >
          {loading ? 'Loading...' : 'Use Previous Template'}
        </button>
        <button
          onClick={onUploadNew}
          disabled={loading}
          className={cn(
            'flex-1 rounded-lg py-2 px-4 font-medium transition-colors',
            loading
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200'
              : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
          )}
        >
          Upload New
        </button>
      </div>
    </div>
  )
}
