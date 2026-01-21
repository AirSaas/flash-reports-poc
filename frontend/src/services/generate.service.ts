import { invokeFunction } from '@lib/supabase'
import type { GenerateResponse } from '@appTypes/api'
import type { Engine } from '@appTypes/index'

export async function generateReport(
  sessionId: string,
  engine: Engine
): Promise<GenerateResponse> {
  const functionName =
    engine === 'claude-pptx' ? 'generate-claude-pptx' : 'generate-gamma'

  return invokeFunction<GenerateResponse>(functionName, sessionId)
}

export async function downloadReport(pptxUrl: string, fileName?: string): Promise<void> {
  const link = document.createElement('a')
  link.href = pptxUrl
  link.download = fileName || 'report.pptx'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}
