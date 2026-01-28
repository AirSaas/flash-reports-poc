/**
 * Python Backend Service
 *
 * Handles communication with the Python FastAPI backend for HTML generation.
 */

import { PYTHON_BACKEND_URL } from '@config/constants'

interface GenerateJobResponse {
  success: boolean
  jobId?: string
  error?: string
}

interface JobStatus {
  id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  result?: {
    reportId?: string
    htmlUrl?: string
    pdfUrl?: string
    templateHtmlUrl?: string
    templatePdfUrl?: string
    projectCount?: number
    slideCount?: number
  }
  error?: string
  created_at?: string
  started_at?: string
  completed_at?: string
}

interface JobStatusResponse {
  success: boolean
  job?: JobStatus
  error?: string
}

interface TemplateAnalysisResponse {
  success: boolean
  html_template?: string
  fields?: Array<{
    field_name: string
    slide_number?: number
    description?: string
    example_value?: string
  }>
  slide_count?: number
  error?: string
}

/**
 * Create an HTML generation job on the Python backend.
 */
export async function createHtmlGenerationJob(
  sessionId: string,
  useClaudePopulation: boolean = true
): Promise<GenerateJobResponse> {
  const response = await fetch(`${PYTHON_BACKEND_URL}/generate-html`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-session-id': sessionId,
    },
    body: JSON.stringify({ use_claude_population: useClaudePopulation }),
  })

  return response.json()
}

/**
 * Check the status of an HTML generation job.
 */
export async function checkHtmlJobStatus(
  sessionId: string,
  jobId: string
): Promise<JobStatusResponse> {
  const response = await fetch(`${PYTHON_BACKEND_URL}/job-status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-session-id': sessionId,
    },
    body: JSON.stringify({ job_id: jobId }),
  })

  return response.json()
}

/**
 * Analyze a PPTX template and generate HTML template with placeholders.
 */
export async function analyzeTemplate(
  sessionId: string
): Promise<TemplateAnalysisResponse> {
  const response = await fetch(`${PYTHON_BACKEND_URL}/analyze-template`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-session-id': sessionId,
    },
  })

  return response.json()
}

/**
 * Generate HTML directly (synchronous, for testing).
 * Warning: This can take several minutes.
 */
export async function generateHtmlDirect(
  sessionId: string,
  useClaude: boolean = true
): Promise<string> {
  const response = await fetch(
    `${PYTHON_BACKEND_URL}/generate-direct?use_claude=${useClaude}`,
    {
      method: 'POST',
      headers: {
        'x-session-id': sessionId,
      },
    }
  )

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }))
    throw new Error(error.detail || `HTTP ${response.status}`)
  }

  return response.text()
}

/**
 * Check if the Python backend is healthy.
 */
export async function checkPythonBackendHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${PYTHON_BACKEND_URL}/health`, {
      method: 'GET',
    })
    return response.ok
  } catch {
    return false
  }
}
