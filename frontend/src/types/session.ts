export type Engine = 'gamma' | 'claude-pptx'

export type Step =
  | 'select_engine'
  | 'configure_projects'
  | 'upload_template'
  | 'check_fetched_data'
  | 'check_mapping'
  | 'mapping'
  | 'long_text_options'
  | 'generating'
  | 'evaluating'
  | 'done'

export type LongTextStrategy = 'summarize' | 'ellipsis' | 'omit'

export interface ProjectItem {
  id: string
  name: string
  short_id?: string
}

export interface ProjectsConfig {
  workspace: string
  projects: ProjectItem[]
}

export interface SessionState {
  sessionId: string
  engine: Engine | null
  lastTemplateId: string | null
  lastMappingId: string | null
  lastFetchedDataId: string | null
  hasFetchedData: boolean
  projectsConfig: ProjectsConfig | null
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
