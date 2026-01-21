import { invokeFunction } from '@lib/supabase'
import type { EvaluateResponse } from '@appTypes/api'

export async function evaluateReport(
  sessionId: string,
  reportId: string
): Promise<EvaluateResponse> {
  return invokeFunction<EvaluateResponse>('evaluate', sessionId, { reportId })
}

export function getScoreColor(score: number): string {
  if (score >= 80) return 'text-green-600'
  if (score >= 65) return 'text-yellow-600'
  return 'text-red-600'
}

export function getScoreLabel(score: number): string {
  if (score >= 80) return 'Excellent'
  if (score >= 65) return 'Good'
  if (score >= 50) return 'Fair'
  return 'Needs Improvement'
}
