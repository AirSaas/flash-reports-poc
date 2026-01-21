import { useCallback, useRef, useState, type DragEvent } from 'react'
import { cn } from '@lib/utils'

interface TemplateUploadProps {
  onUpload: (file: File) => void
  uploading: boolean
  progress: number
  error: string | null
}

export function TemplateUpload({ onUpload, uploading, progress, error }: TemplateUploadProps) {
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files[0]
      if (file && file.name.endsWith('.pptx')) {
        onUpload(file)
      }
    },
    [onUpload]
  )

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) {
        onUpload(file)
      }
    },
    [onUpload]
  )

  const handleClick = useCallback(() => {
    inputRef.current?.click()
  }, [])

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">Upload Template</h2>
      <p className="text-sm text-gray-600">
        Upload your reference PowerPoint template (.pptx) to analyze its structure.
      </p>
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
        className={cn(
          'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
          isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400',
          uploading && 'pointer-events-none opacity-50'
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pptx"
          onChange={handleFileSelect}
          className="hidden"
        />
        {uploading ? (
          <div className="space-y-2">
            <p className="text-sm text-gray-600">Uploading...</p>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-gray-500">{progress}%</p>
          </div>
        ) : (
          <>
            <div className="text-4xl mb-2">📄</div>
            <p className="text-gray-600">
              Drag and drop your .pptx file here, or click to select
            </p>
            <p className="text-sm text-gray-400 mt-2">Only .pptx files are supported</p>
          </>
        )}
      </div>
      {error && (
        <div className="text-red-600 text-sm p-2 bg-red-50 rounded-lg">
          {error}
        </div>
      )}
    </div>
  )
}
