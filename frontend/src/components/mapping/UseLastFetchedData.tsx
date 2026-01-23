import { cn } from '@lib/utils'

interface UseLastFetchedDataProps {
  projectCount: number
  fetchedAt: string
  onUseLastData: () => void
  onFetchNew: () => void
  loading?: boolean
}

export function UseLastFetchedData({
  projectCount,
  fetchedAt,
  onUseLastData,
  onFetchNew,
  loading = false,
}: UseLastFetchedDataProps) {
  const formattedDate = new Date(fetchedAt).toLocaleString()

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">Previous Project Data Found</h2>
      <p className="text-sm text-gray-600">
        We found previously downloaded AirSaas project data. Would you like to reuse it or fetch fresh data?
      </p>
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl">📊</span>
          <div>
            <p className="font-medium text-gray-900">Cached project data</p>
            <p className="text-sm text-gray-600">
              {projectCount} project{projectCount !== 1 ? 's' : ''} downloaded
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 border-t border-gray-200 pt-3">
          <span className="text-2xl">🕐</span>
          <div>
            <p className="font-medium text-gray-900">Last fetched</p>
            <p className="text-sm text-gray-600">{formattedDate}</p>
          </div>
        </div>
      </div>
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
        <p className="text-sm text-blue-700">
          <strong>Tip:</strong> Reusing cached data saves time and API calls. Fetch new data only if your AirSaas projects have been updated recently.
        </p>
      </div>
      <div className="flex gap-3">
        <button
          onClick={onUseLastData}
          disabled={loading}
          className={cn(
            'flex-1 rounded-lg py-2 px-4 font-medium transition-colors',
            loading
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          )}
        >
          {loading ? 'Loading...' : 'Use Cached Data'}
        </button>
        <button
          onClick={onFetchNew}
          disabled={loading}
          className={cn(
            'flex-1 rounded-lg py-2 px-4 font-medium transition-colors',
            loading
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200'
              : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
          )}
        >
          Fetch Fresh Data
        </button>
      </div>
    </div>
  )
}
