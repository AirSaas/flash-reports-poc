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

/**
 * Smartview from AirSaas API
 */
export interface Smartview {
  id: string
  name: string
  description: string | null
  display: string
  view_category: string
  private: boolean
  updated_at: string
}

/**
 * Selected smartview with its projects
 */
export interface SmartviewSelection {
  smartview: Smartview
  projects: ProjectItem[]
}

/**
 * @deprecated Use SmartviewSelection instead.
 * Legacy format where users manually pasted JSON with workspace + projects.
 * Kept for backward compatibility with existing sessions.
 */
export interface ProjectsConfig {
  workspace: string
  projects: ProjectItem[]
}

/**
 * New smartview-based config that replaces ProjectsConfig
 */
export interface SmartviewConfig {
  smartview_id: string
  smartview_name: string
  projects: ProjectItem[]
}

export interface SessionState {
  sessionId: string
  engine: Engine | null
  lastTemplateId: string | null
  lastMappingId: string | null
  lastFetchedDataId: string | null
  hasFetchedData: boolean
  /**
   * @deprecated Use smartviewSelection instead
   */
  projectsConfig: ProjectsConfig | null
  /**
   * New: selected smartview with its projects
   */
  smartviewSelection: SmartviewSelection | null
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
