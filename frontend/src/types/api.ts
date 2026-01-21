import type { MappingJson } from './mapping'

export interface ChatResponse {
  message: string
  mappingComplete: boolean
  mappingJson: MappingJson | null
  mappingId?: string
}

export interface UploadResponse {
  success: boolean
  templatePath: string
  error?: string
}

export interface GenerateResponse {
  success: boolean
  reportId: string
  pptxUrl: string
  storagePath: string
  error?: string
}

export interface EvaluationResult {
  score: number
  completeness: number
  accuracy: number
  formatting: number
  issues: string[]
  recommendation: 'pass' | 'regenerate'
}

export interface EvaluateResponse {
  evaluation: EvaluationResult
  shouldRegenerate: boolean
}

export interface SessionResponse {
  session: {
    id: string
    current_step: string
    chat_history: Array<{ role: 'user' | 'assistant'; content: string }>
    created_at: string
    updated_at: string
  } | null
  mapping: {
    template_path: string
    mapping_json: MappingJson | null
    fetched_data: Record<string, unknown> | null
    long_text_strategy: string | null
  } | null
}

export interface AirSaasProject {
  id: string
  short_id?: string
  name: string
}
