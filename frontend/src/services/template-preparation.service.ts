/**
 * Template Preparation Service
 *
 * Handles background PPTX → HTML conversion.
 * The conversion runs in the background while the user continues with other steps.
 */

import { PYTHON_BACKEND_URL } from '@config/constants'

export type PreparationStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface PreparationStatusResponse {
  success: boolean
  status: PreparationStatus
  htmlTemplateUrl?: string
  templatePngUrls?: string[]
  templatePdfUrl?: string
  error?: string
}

export interface PrepareTemplateResponse {
  success: boolean
  message?: string
  error?: string
}

export interface SlideFromHtml {
  slide_number: number
  title: string
  field_count: number
  layout?: string
}

export interface ListSlidesFromHtmlResponse {
  success: boolean
  slides?: SlideFromHtml[]
  total?: number
  error?: string
}

/**
 * Start template preparation (PPTX → HTML conversion) in background.
 *
 * This should be called immediately after uploading or selecting a template.
 * The conversion runs asynchronously while the user continues with other steps.
 */
export async function startTemplatePreparation(
  sessionId: string
): Promise<PrepareTemplateResponse> {
  try {
    const response = await fetch(`${PYTHON_BACKEND_URL}/prepare-template`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-id': sessionId,
      },
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Failed to start preparation' }))
      return { success: false, error: error.detail || `HTTP ${response.status}` }
    }

    return response.json()
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Network error',
    }
  }
}

/**
 * Check template preparation status.
 *
 * Poll this endpoint to know when the HTML template is ready.
 */
export async function getTemplatePreparationStatus(
  sessionId: string
): Promise<PreparationStatusResponse> {
  try {
    const response = await fetch(`${PYTHON_BACKEND_URL}/template-preparation-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-id': sessionId,
      },
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Failed to get status' }))
      return {
        success: false,
        status: 'failed',
        error: error.detail || `HTTP ${response.status}`,
      }
    }

    return response.json()
  } catch (error) {
    return {
      success: false,
      status: 'failed',
      error: error instanceof Error ? error.message : 'Network error',
    }
  }
}

/**
 * List slides from the prepared HTML template.
 *
 * This parses the HTML to extract slide information for the SlideSelector.
 * Only call this after template preparation is completed.
 */
export async function listSlidesFromHtml(
  sessionId: string
): Promise<ListSlidesFromHtmlResponse> {
  try {
    const response = await fetch(`${PYTHON_BACKEND_URL}/list-slides-from-html`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-id': sessionId,
      },
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Failed to list slides' }))
      return { success: false, error: error.detail || `HTTP ${response.status}` }
    }

    return response.json()
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Network error',
    }
  }
}
