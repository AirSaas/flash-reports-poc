import { useState, useCallback } from 'react'
import { supabase } from '@lib/supabase'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@config/constants'
import { startTemplatePreparation } from '@services/template-preparation.service'

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

        // Reset preparation status before starting new preparation
        await supabase
          .from('sessions')
          .update({
            template_preparation_status: 'pending',
            html_template_url: null,
            template_png_urls: null,
            template_pdf_url: null,
            template_preparation_error: null,
          })
          .eq('id', sessionId)

        // Start template preparation in background (PPTX → HTML conversion)
        // This runs asynchronously while the user continues with other steps
        startTemplatePreparation(sessionId).catch((err) => {
          console.warn('Failed to start template preparation:', err)
          // Don't fail the upload if preparation fails to start
          // The preparation will be retried when entering the mapping step
        })

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
