import { supabase } from '@lib/supabase'
import { BACKEND_URL, SUPABASE_ANON_KEY } from '@config/constants'
import type { UploadResponse } from '@appTypes/api'

export async function uploadTemplateFile(
  sessionId: string,
  file: File
): Promise<UploadResponse> {
  const fileName = `${Date.now()}_${file.name}`
  const storagePath = `${sessionId}/${fileName}`

  const { error: uploadError } = await supabase.storage
    .from('templates')
    .upload(storagePath, file, {
      contentType:
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      upsert: true,
    })

  if (uploadError) {
    return { success: false, templatePath: '', error: uploadError.message }
  }

  const response = await fetch(`${BACKEND_URL}/functions/v1/upload-template`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'x-session-id': sessionId,
    },
    body: JSON.stringify({ templatePath: storagePath }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    return {
      success: false,
      templatePath: '',
      error: errorData.error || 'Failed to register template',
    }
  }

  return { success: true, templatePath: storagePath }
}

export async function getTemplatePublicUrl(templatePath: string): Promise<string | null> {
  const { data } = supabase.storage.from('templates').getPublicUrl(templatePath)
  return data?.publicUrl || null
}
