import { useState, useCallback } from 'react'
import { invokeFunction } from '@lib/supabase'
import type { ProjectsConfig } from '@appTypes/index'

interface MappingOption {
  id: string
  label: string
  description?: string
  confidence?: string
}

interface TemplateField {
  id: string
  name: string
  placeholder_text: string
  data_type: string
  location: string
  slide_number?: number
}

interface SlideTemplate {
  template_id: string
  title: string
  type: 'per_project' | 'global'
  example_slide_numbers: number[]
  fields: TemplateField[]
}

interface TemplateAnalysis {
  // New deduplicated format
  slide_templates?: SlideTemplate[]
  total_unique_fields?: number
  total_slides_in_template?: number
  projects_detected?: number
  // Legacy format
  slides?: Array<{
    slide_number: number
    title: string
    fields: TemplateField[]
  }>
  total_fields?: number
  analysis_notes: string
}

interface QuestionState {
  complete: boolean
  currentIndex: number
  totalFields: number
  field: TemplateField
  question: string
  suggestedOptions: MappingOption[]
  allOptions: MappingOption[]
  reasoning?: string
  confidence?: string
  mappingJson?: unknown
  mappingId?: string
}

interface AnalyzeResponse {
  success: boolean
  analysis: TemplateAnalysis
  anthropicFileId: string
  rawResponse: string
}

interface FetchProjectsResponse {
  success: boolean
  projectCount: number
  successfulCount: number
  errors?: Array<{ projectId: string; error: string }>
}

interface QuestionResponse extends QuestionState {}

// Batch mapping types
interface FieldWithSuggestion {
  id: string
  name: string
  placeholder_text?: string
  data_type?: string
  location?: string
  slide_number?: number
  suggested_mapping: string
  confidence: 'high' | 'medium' | 'low'
  reasoning?: string
}

interface BatchMappingResponse {
  fields: FieldWithSuggestion[]
  allOptions: MappingOption[]
  totalFields: number
}

interface BatchSubmitResponse {
  success: boolean
  mappingId: string
  mappedFields: number
  skippedFields: number
}

// Progress steps for the mapping process
export type MappingProgressStep =
  | 'idle'
  | 'fetching_projects'
  | 'analyzing_template'
  | 'loading_questions'
  | 'loading_batch'
  | 'ready'
  | 'error'

export function useMapping(sessionId: string) {
  const [progressStep, setProgressStep] = useState<MappingProgressStep>('idle')
  const [progressMessage, setProgressMessage] = useState<string>('')
  const [questionLoading, setQuestionLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<TemplateAnalysis | null>(null)
  const [currentQuestion, setCurrentQuestion] = useState<QuestionState | null>(null)
  const [mappingComplete, setMappingComplete] = useState(false)
  const [mappingId, setMappingId] = useState<string | null>(null)
  const [mappingJson, setMappingJson] = useState<unknown>(null)
  const [fetchedProjectsCount, setFetchedProjectsCount] = useState<number>(0)
  const [fetchComplete, setFetchComplete] = useState(false)

  // Batch mapping state
  const [batchFields, setBatchFields] = useState<FieldWithSuggestion[]>([])
  const [batchAllOptions, setBatchAllOptions] = useState<MappingOption[]>([])
  const [batchLoading, setBatchLoading] = useState(false)

  const fetchProjectsData = useCallback(async (projectsConfig: ProjectsConfig) => {
    setProgressStep('fetching_projects')
    setProgressMessage(`Downloading data for ${projectsConfig.projects.length} projects from AirSaas...`)
    setError(null)

    try {
      const response = await invokeFunction<FetchProjectsResponse>(
        'fetch-projects',
        sessionId,
        { projectsConfig }
      )

      if (response.success) {
        setFetchedProjectsCount(response.successfulCount)
        setProgressMessage(`Downloaded ${response.successfulCount}/${response.projectCount} projects`)
        setFetchComplete(true) // Mark fetch as complete for early saving
        return true
      } else {
        throw new Error('Failed to fetch projects data')
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to fetch projects data'
      setError(message)
      setProgressStep('error')
      return false
    }
  }, [sessionId])

  const analyzeTemplate = useCallback(async (templatePath: string) => {
    setProgressStep('analyzing_template')
    setProgressMessage('Analyzing template structure with AI...')
    setError(null)

    try {
      const response = await invokeFunction<AnalyzeResponse>(
        'analyze-template',
        sessionId,
        { templatePath }
      )

      if (response.success && response.analysis) {
        setAnalysis(response.analysis)
        const fieldCount = response.analysis.total_unique_fields || response.analysis.total_fields
        setProgressMessage(`Found ${fieldCount} unique fields in template`)
        return response.analysis
      } else {
        throw new Error('Failed to analyze template')
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to analyze template'
      setError(message)
      setProgressStep('error')
      return null
    }
  }, [sessionId])

  const startMappingProcess = useCallback(async (
    templatePath: string,
    projectsConfig: ProjectsConfig,
    options?: { skipFetchProjects?: boolean }
  ) => {
    // Step 1: Fetch projects data (skip if already cached)
    if (!options?.skipFetchProjects) {
      const fetchSuccess = await fetchProjectsData(projectsConfig)
      if (!fetchSuccess) return null
    } else {
      // Skip fetching, show as complete
      setProgressStep('analyzing_template')
      setProgressMessage('Using cached project data...')
    }

    // Step 2: Analyze template
    const analysisResult = await analyzeTemplate(templatePath)
    if (!analysisResult) return null

    // Step 3: Get first question
    setProgressStep('loading_questions')
    setProgressMessage('Preparing mapping questions...')

    const questionResult = await getNextQuestion()
    if (questionResult) {
      setProgressStep('ready')
      return analysisResult
    }

    return null
  }, [fetchProjectsData, analyzeTemplate])

  const getNextQuestion = useCallback(async (answer?: string) => {
    setQuestionLoading(true)
    setError(null)

    try {
      const body = answer
        ? { action: 'answer', answer }
        : { action: 'next' }

      const response = await invokeFunction<QuestionResponse>(
        'mapping-question',
        sessionId,
        body
      )

      if (response.complete) {
        setMappingComplete(true)
        setMappingId(response.mappingId || null)
        setMappingJson(response.mappingJson)
        setCurrentQuestion(null)
        return { complete: true, mappingId: response.mappingId, mappingJson: response.mappingJson }
      } else {
        setCurrentQuestion(response)
        setProgressStep('ready')
        return { complete: false, question: response }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to get mapping question'
      setError(message)
      setProgressStep('error')
      return null
    } finally {
      setQuestionLoading(false)
    }
  }, [sessionId])

  const answerQuestion = useCallback(async (_fieldId: string, answer: string) => {
    return getNextQuestion(answer)
  }, [getNextQuestion])

  // ==========================================================================
  // Batch Mapping Functions (New UX)
  // ==========================================================================

  const getBatchMappings = useCallback(async () => {
    setBatchLoading(true)
    setProgressStep('loading_batch')
    setProgressMessage('Generating mapping suggestions with AI...')
    setError(null)

    try {
      const response = await invokeFunction<BatchMappingResponse>(
        'mapping-batch',
        sessionId,
        {}
      )

      if (response.fields && response.allOptions) {
        setBatchFields(response.fields)
        setBatchAllOptions(response.allOptions)
        setProgressStep('ready')
        setProgressMessage(`Generated suggestions for ${response.totalFields} fields`)
        return response
      } else {
        throw new Error('Failed to get batch mapping suggestions')
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to get batch mappings'
      setError(message)
      setProgressStep('error')
      return null
    } finally {
      setBatchLoading(false)
    }
  }, [sessionId])

  const submitBatchMappings = useCallback(async (mappings: Record<string, string>) => {
    setBatchLoading(true)
    setError(null)

    try {
      const response = await invokeFunction<BatchSubmitResponse>(
        'mapping-batch-submit',
        sessionId,
        { mappings }
      )

      if (response.success) {
        setMappingComplete(true)
        setMappingId(response.mappingId)
        setProgressMessage(`Saved ${response.mappedFields} mappings`)
        return response
      } else {
        throw new Error('Failed to save batch mappings')
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to save batch mappings'
      setError(message)
      return null
    } finally {
      setBatchLoading(false)
    }
  }, [sessionId])

  const startBatchMappingProcess = useCallback(async (
    templatePath: string,
    projectsConfig: ProjectsConfig,
    options?: { skipFetchProjects?: boolean }
  ) => {
    // Step 1: Fetch projects data (skip if already cached)
    if (!options?.skipFetchProjects) {
      const fetchSuccess = await fetchProjectsData(projectsConfig)
      if (!fetchSuccess) return null
    } else {
      setProgressStep('analyzing_template')
      setProgressMessage('Using cached project data...')
    }

    // Step 2: Analyze template
    const analysisResult = await analyzeTemplate(templatePath)
    if (!analysisResult) return null

    // Step 3: Get batch suggestions (instead of one-by-one questions)
    const batchResult = await getBatchMappings()
    if (batchResult) {
      return analysisResult
    }

    return null
  }, [fetchProjectsData, analyzeTemplate, getBatchMappings])

  const resetMapping = useCallback(() => {
    setProgressStep('idle')
    setProgressMessage('')
    setAnalysis(null)
    setCurrentQuestion(null)
    setMappingComplete(false)
    setMappingId(null)
    setMappingJson(null)
    setError(null)
    setFetchedProjectsCount(0)
    setFetchComplete(false)
    // Reset batch state
    setBatchFields([])
    setBatchAllOptions([])
    setBatchLoading(false)
  }, [])

  // Computed state for backward compatibility
  const analyzing = progressStep === 'fetching_projects' ||
                    progressStep === 'analyzing_template' ||
                    progressStep === 'loading_questions' ||
                    progressStep === 'loading_batch'

  return {
    // Progress tracking
    progressStep,
    progressMessage,
    analyzing,
    questionLoading,
    error,

    // Data
    analysis,
    currentQuestion,
    mappingComplete,
    mappingId,
    mappingJson,
    fetchedProjectsCount,
    fetchComplete,

    // Batch mapping data
    batchFields,
    batchAllOptions,
    batchLoading,

    // Actions (legacy one-by-one)
    startMappingProcess,
    fetchProjectsData,
    analyzeTemplate,
    getNextQuestion,
    answerQuestion,
    resetMapping,

    // Actions (new batch)
    startBatchMappingProcess,
    getBatchMappings,
    submitBatchMappings,
  }
}
