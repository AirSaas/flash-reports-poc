interface TemplatePreviewProps {
  templatePath: string
  onContinue: () => void
}

export function TemplatePreview({ templatePath, onContinue }: TemplatePreviewProps) {
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
        className="w-full bg-blue-600 text-white rounded-lg py-2 px-4 font-medium hover:bg-blue-700 transition-colors"
      >
        Continue to Mapping
      </button>
    </div>
  )
}
