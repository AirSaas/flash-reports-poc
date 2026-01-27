import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@config/constants'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Default timeout: 30 seconds, long operations: 5 minutes
const DEFAULT_TIMEOUT = 30000
const LONG_OPERATION_TIMEOUT = 300000

// Functions that need longer timeout (AI operations, API calls, etc.)
const LONG_TIMEOUT_FUNCTIONS = [
  'fetch-projects',
  'analyze-template',
  'mapping-question',
  'mapping-batch',
  'mapping-batch-submit',
  'generate-claude-pptx',
  'generate-gamma',
  'evaluate',
]

export async function invokeFunction<T>(
  functionName: string,
  sessionId: string,
  body?: Record<string, unknown>
): Promise<T> {
  const timeout = LONG_TIMEOUT_FUNCTIONS.includes(functionName) ? LONG_OPERATION_TIMEOUT : DEFAULT_TIMEOUT
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'x-session-id': sessionId,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    return response.json()
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeout / 1000} seconds. The operation is taking too long.`)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

export interface StreamEvent {
  type: 'delta' | 'done' | 'error'
  text?: string
  message?: string
  mappingComplete?: boolean
  mappingJson?: unknown
  mappingId?: string
  error?: string
}

export async function invokeFunctionStream(
  functionName: string,
  sessionId: string,
  body: Record<string, unknown>,
  onEvent: (event: StreamEvent) => void
): Promise<void> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'x-session-id': sessionId,
    },
    body: JSON.stringify({ ...body, stream: true }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(error.error || `HTTP ${response.status}`)
  }

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('No response body')
  }

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    // Process complete SSE events
    const lines = buffer.split('\n')
    buffer = lines.pop() || '' // Keep incomplete line in buffer

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6)
        try {
          const event = JSON.parse(data) as StreamEvent
          onEvent(event)
        } catch {
          // Ignore parse errors
        }
      }
    }
  }
}
