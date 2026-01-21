import { useCallback } from 'react'
import { downloadReport } from '@services/generate.service'

interface DownloadButtonProps {
  pptxUrl: string
  fileName?: string
  disabled?: boolean
}

export function DownloadButton({ pptxUrl, fileName, disabled = false }: DownloadButtonProps) {
  const handleDownload = useCallback(() => {
    downloadReport(pptxUrl, fileName)
  }, [pptxUrl, fileName])

  return (
    <button
      onClick={handleDownload}
      disabled={disabled}
      className="w-full bg-green-600 text-white rounded-lg py-3 px-4 font-medium hover:bg-green-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
    >
      <span className="text-xl">📥</span>
      Download PPTX
    </button>
  )
}
