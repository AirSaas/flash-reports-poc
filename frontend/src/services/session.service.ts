import { invokeFunction } from '@lib/supabase'
import type { SessionResponse } from '@appTypes/api'
import type { LongTextStrategy } from '@appTypes/index'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@config/constants'

export async function getSession(sessionId: string): Promise<SessionResponse> {
  return invokeFunction<SessionResponse>('get-session', sessionId)
}

export async function updateLongTextStrategy(
  sessionId: string,
  strategy: LongTextStrategy
): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/get-session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'x-session-id': sessionId,
    },
    body: JSON.stringify({
      action: 'update_strategy',
      long_text_strategy: strategy,
    }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    return { success: false, error: errorData.error || 'Failed to update strategy' }
  }

  return { success: true }
}

export async function copyMapping(
  sessionId: string,
  sourceMappingId: string
): Promise<{ success: boolean; hasFetchedData?: boolean; error?: string }> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/copy-mapping`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'x-session-id': sessionId,
    },
    body: JSON.stringify({ sourceMappingId }),
  })

  const data = await response.json()

  if (!response.ok || !data.success) {
    return { success: false, error: data.error || 'Failed to copy mapping' }
  }

  return { success: true, hasFetchedData: data.hasFetchedData }
}

export async function copyFetchedData(
  sessionId: string,
  sourceSessionId: string
): Promise<{ success: boolean; projectCount?: number; fetchedAt?: string; error?: string }> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/copy-fetched-data`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'x-session-id': sessionId,
    },
    body: JSON.stringify({ sourceSessionId }),
  })

  const data = await response.json()

  if (!response.ok || !data.success) {
    return { success: false, error: data.error || 'Failed to copy fetched data' }
  }

  return { success: true, projectCount: data.projectCount, fetchedAt: data.fetchedAt }
}

export async function getFetchedDataInfo(
  sessionId: string
): Promise<{ success: boolean; projectCount?: number; fetchedAt?: string; error?: string }> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/get-session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'x-session-id': sessionId,
    },
    body: JSON.stringify({ action: 'get_fetched_data_info' }),
  })

  const data = await response.json()

  if (!response.ok) {
    return { success: false, error: data.error || 'Failed to get fetched data info' }
  }

  return {
    success: true,
    projectCount: data.projectCount,
    fetchedAt: data.fetchedAt,
  }
}

interface ProjectItem {
  id: string
  name: string
  short_id?: string
}

interface ProjectsConfig {
  workspace: string
  projects: ProjectItem[]
}

export async function fetchProjects(
  sessionId: string,
  projectsConfig: ProjectsConfig
): Promise<{ success: boolean; projectCount?: number; error?: string }> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/fetch-projects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'x-session-id': sessionId,
    },
    body: JSON.stringify({ projectsConfig }),
  })

  const data = await response.json()

  if (!response.ok || !data.success) {
    return { success: false, error: data.error || 'Failed to fetch projects' }
  }

  return { success: true, projectCount: data.successfulCount }
}

// Job status types
export interface JobStatus {
  id: string
  jobType?: 'generation' | 'evaluation'
  status: 'pending' | 'processing' | 'completed' | 'failed'
  result?: {
    // Generation job result
    reportId?: string
    pptxUrl?: string
    storagePath?: string
    iteration?: number
    // Evaluation job result
    evaluation?: {
      score: number
      completeness: number
      accuracy: number
      formatting: number
      issues: string[]
      accuracyIssues: string[]
      emptyFields: string[]
      projectsFound: number
      projectsExpected: number
      recommendation: 'pass' | 'regenerate'
    }
    shouldRegenerate?: boolean
  }
  error?: string
  prompt?: string
  createdAt: string
  startedAt?: string
  completedAt?: string
}

export async function checkJobStatus(
  sessionId: string,
  jobId: string
): Promise<{ success: boolean; job?: JobStatus; error?: string }> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/check-job-status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'x-session-id': sessionId,
    },
    body: JSON.stringify({ jobId }),
  })

  const data = await response.json()

  if (!response.ok || !data.success) {
    return { success: false, error: data.error || 'Failed to check job status' }
  }

  return { success: true, job: data.job }
}

/**
 * Triggers job processing in background (fire-and-forget).
 * The function returns immediately - use checkJobStatus to poll for completion.
 */
export function triggerJobProcessing(jobId: string, engine: 'claude-pptx' | 'gamma' = 'gamma'): void {
  const endpoint = engine === 'gamma' ? 'process-gamma-job' : 'process-pptx-job'

  // Fire and forget - don't await, don't handle errors
  // The job will update its own status in the database
  fetch(`${SUPABASE_URL}/functions/v1/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ jobId }),
  }).catch((err) => {
    // Log but don't throw - the polling will detect if job failed
    console.error(`Failed to trigger ${engine} job processing:`, err)
  })
}

/**
 * Creates an evaluation job for a generated report.
 * Returns immediately with a jobId that can be polled.
 */
export async function createEvalJob(
  sessionId: string,
  reportId: string
): Promise<{ success: boolean; jobId?: string; error?: string }> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/create-eval-job`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'x-session-id': sessionId,
    },
    body: JSON.stringify({ reportId }),
  })

  const data = await response.json()

  if (!response.ok || !data.success) {
    return { success: false, error: data.error || 'Failed to create evaluation job' }
  }

  return { success: true, jobId: data.jobId }
}

/**
 * Triggers evaluation job processing in background (fire-and-forget).
 * The function returns immediately - use checkJobStatus to poll for completion.
 */
export function triggerEvalJobProcessing(jobId: string): void {
  // Fire and forget - don't await, don't handle errors
  // The job will update its own status in the database
  fetch(`${SUPABASE_URL}/functions/v1/process-eval-job`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ jobId }),
  }).catch((err) => {
    // Log but don't throw - the polling will detect if job failed
    console.error('Failed to trigger evaluation job processing:', err)
  })
}
