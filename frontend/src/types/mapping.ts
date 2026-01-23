export type FieldStatus = 'ok' | 'missing' | 'manual'

export interface FieldMapping {
  source: string
  transform?: string
  status: FieldStatus
}

export interface SlideMapping {
  [fieldName: string]: FieldMapping
}

export interface MappingJson {
  slides: {
    [slideType: string]: SlideMapping
  }
  missing_fields: string[]
}

export interface Mapping {
  id: string
  session_id: string
  template_path: string
  mapping_json: MappingJson | null
  long_text_strategy: 'summarize' | 'ellipsis' | 'omit' | null
  created_at: string
}
