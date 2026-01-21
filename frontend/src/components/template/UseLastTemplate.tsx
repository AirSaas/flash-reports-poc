interface UseLastTemplateProps {
  lastTemplateId: string
  onUseLastTemplate: () => void
  onUploadNew: () => void
}

export function UseLastTemplate({
  lastTemplateId,
  onUseLastTemplate,
  onUploadNew,
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
          className="flex-1 bg-blue-600 text-white rounded-lg py-2 px-4 font-medium hover:bg-blue-700 transition-colors"
        >
          Use Previous Template
        </button>
        <button
          onClick={onUploadNew}
          className="flex-1 border border-gray-300 text-gray-700 rounded-lg py-2 px-4 font-medium hover:bg-gray-50 transition-colors"
        >
          Upload New
        </button>
      </div>
    </div>
  )
}
