export type Engine = 'gamma' | 'claude-pptx'

export type Step =
  | 'select_engine'
  | 'upload_template'
  | 'check_mapping'
  | 'mapping'
  | 'long_text_options'
  | 'generating'
  | 'evaluating'
  | 'done'

export type LongTextStrategy = 'summarize' | 'ellipsis' | 'omit'

export interface SessionState {
  sessionId: string
  engine: Engine | null
  lastTemplateId: string | null
  lastMappingId: string | null
  hasFetchedData: boolean
}

export interface Session {
  id: string
  current_step: Step
  chat_history: ChatMessage[]
  created_at: string
  updated_at: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}
