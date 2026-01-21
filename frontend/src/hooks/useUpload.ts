import { useState, useCallback } from 'react'
import { supabase } from '@lib/supabase'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@config/constants'

interface UseUploadReturn {
  uploading: boolean
  error: string | null
  progress: number
  uploadTemplate: (file: File) => Promise<string | null>
}

export function useUpload(sessionId: string): UseUploadReturn {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)

  const uploadTemplate = useCallback(
    async (file: File): Promise<string | null> => {
      if (!file.name.endsWith('.pptx')) {
        setError('Only .pptx files are allowed')
        return null
      }

      setUploading(true)
      setError(null)
      setProgress(0)

      try {
        const fileName = `${Date.now()}_${file.name}`
        const storagePath = `${sessionId}/${fileName}`

        setProgress(30)

        const { error: uploadError } = await supabase.storage
          .from('templates')
          .upload(storagePath, file, {
            contentType:
              'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            upsert: true,
          })

        if (uploadError) {
          throw uploadError
        }

        setProgress(70)

        const response = await fetch(
          `${SUPABASE_URL}/functions/v1/upload-template`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
              'x-session-id': sessionId,
            },
            body: JSON.stringify({ templatePath: storagePath }),
          }
        )

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          throw new Error(errorData.error || 'Failed to register template')
        }

        setProgress(100)
        return storagePath
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Upload failed'
        setError(message)
        return null
      } finally {
        setUploading(false)
      }
    },
    [sessionId]
  )

  return {
    uploading,
    error,
    progress,
    uploadTemplate,
  }
}
