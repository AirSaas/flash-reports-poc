import { cn } from '@lib/utils'

interface UseLastMappingProps {
  hasFetchedData: boolean
  onUseLastMapping: () => void
  onCreateNew: () => void
  loading?: boolean
}

export function UseLastMapping({
  hasFetchedData,
  onUseLastMapping,
  onCreateNew,
  loading = false,
}: UseLastMappingProps) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">Previous Mapping Found</h2>
      <p className="text-sm text-gray-600">
        We found a previous field mapping configuration. Would you like to reuse it or create a new one?
      </p>
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🗺️</span>
          <div>
            <p className="font-medium text-gray-900">Previous mapping</p>
            <p className="text-sm text-gray-600">Field configuration from last session</p>
          </div>
        </div>
        {hasFetchedData && (
          <div className="flex items-center gap-3 border-t border-gray-200 pt-3">
            <span className="text-2xl">📊</span>
            <div>
              <p className="font-medium text-gray-900">Cached project data</p>
              <p className="text-sm text-gray-600">AirSaas data already fetched</p>
            </div>
          </div>
        )}
      </div>
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
        <p className="text-sm text-blue-700">
          <strong>Tip:</strong> Using the previous mapping will skip the Q&A conversation and go directly to generation options.
          {hasFetchedData && ' Project data will be reused, saving API calls.'}
        </p>
      </div>
      <div className="flex gap-3">
        <button
          onClick={onUseLastMapping}
          disabled={loading}
          className={cn(
            'flex-1 rounded-lg py-2 px-4 font-medium transition-colors',
            loading
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          )}
        >
          {loading ? 'Loading...' : 'Use Previous Mapping'}
        </button>
        <button
          onClick={onCreateNew}
          disabled={loading}
          className={cn(
            'flex-1 rounded-lg py-2 px-4 font-medium transition-colors',
            loading
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200'
              : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
          )}
        >
          Create New Mapping
        </button>
      </div>
    </div>
  )
}
