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
