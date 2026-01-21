interface UseLastMappingProps {
  hasFetchedData: boolean
  onUseLastMapping: () => void
  onCreateNew: () => void
}

export function UseLastMapping({
  hasFetchedData,
  onUseLastMapping,
  onCreateNew,
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
          className="flex-1 bg-blue-600 text-white rounded-lg py-2 px-4 font-medium hover:bg-blue-700 transition-colors"
        >
          Use Previous Mapping
        </button>
        <button
          onClick={onCreateNew}
          className="flex-1 border border-gray-300 text-gray-700 rounded-lg py-2 px-4 font-medium hover:bg-gray-50 transition-colors"
        >
          Create New Mapping
        </button>
      </div>
    </div>
  )
}
