import { useState, useCallback } from 'react'
import { invokeFunction } from '@lib/supabase'
import { listTemplateSlides, listSlidesFromHtml, type SlideInfo } from '@services/python-backend.service'
import { getTemplatePreparationStatus } from '@services/template-preparation.service'
import type { ProjectsConfig, SmartviewConfig } from '@appTypes/index'

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
  | 'preparing_template'  // NEW: waiting for PPTX → HTML conversion
  | 'listing_slides'
  | 'selecting_slides'
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

  // Slide listing state
  const [slideList, setSlideList] = useState<SlideInfo[]>([])

  // Batch mapping state
  const [batchFields, setBatchFields] = useState<FieldWithSuggestion[]>([])
  const [batchAllOptions, setBatchAllOptions] = useState<MappingOption[]>([])
  const [batchLoading, setBatchLoading] = useState(false)

  const fetchProjectsData = useCallback(async (config: ProjectsConfig | SmartviewConfig) => {
    const projectCount = config.projects.length
    setProgressStep('fetching_projects')
    setProgressMessage(`Downloading data for ${projectCount} projects from AirSaas...`)
    setError(null)

    try {
      // Determine if this is a smartview config or legacy config
      const isSmartviewConfig = 'smartview_id' in config
      const body = isSmartviewConfig
        ? { smartviewConfig: config as SmartviewConfig }
        : { projectsConfig: config as ProjectsConfig }

      const response = await invokeFunction<FetchProjectsResponse>(
        'fetch-projects',
        sessionId,
        body
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

  const waitForTemplatePreparation = useCallback(async (): Promise<'completed' | 'failed' | 'timeout'> => {
    const MAX_WAIT_MS = 3 * 60 * 1000 // 3 minutes max
    const POLL_INTERVAL_MS = 2000 // 2 seconds
    const startTime = Date.now()

    setProgressStep('preparing_template')
    setProgressMessage('Checking template status...')

    // First check - might already be completed (reused from previous session)
    try {
      const initialStatus = await getTemplatePreparationStatus(sessionId)

      if (initialStatus.status === 'completed') {
        setProgressMessage('Template ready!')
        return 'completed'
      }

      if (initialStatus.status === 'failed') {
        console.warn('Template preparation failed:', initialStatus.error)
        setProgressMessage('Using alternative analysis method...')
        return 'failed'
      }
    } catch (err) {
      console.warn('Error checking initial preparation status:', err)
    }

    // Need to wait for preparation to complete
    setProgressMessage('Analyzing your template...')

    while (Date.now() - startTime < MAX_WAIT_MS) {
      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))

      try {
        const prepStatus = await getTemplatePreparationStatus(sessionId)

        if (prepStatus.status === 'completed') {
          setProgressMessage('Template analysis completed!')
          return 'completed'
        }

        if (prepStatus.status === 'failed') {
          console.warn('Template preparation failed:', prepStatus.error)
          setProgressMessage('Using alternative analysis method...')
          return 'failed'
        }

        // Update progress message with elapsed time
        const elapsed = Math.floor((Date.now() - startTime) / 1000)
        setProgressMessage(`Analyzing your template... (${elapsed}s)`)
      } catch (err) {
        console.warn('Error checking preparation status:', err)
        // Continue polling even if one request fails
      }
    }

    setProgressMessage('Taking longer than expected, using alternative method...')
    return 'timeout'
  }, [sessionId])

  const fetchSlideList = useCallback(async () => {
    setError(null)

    try {
      // First, wait for template preparation to complete (or timeout/fail)
      const prepResult = await waitForTemplatePreparation()

      setProgressStep('listing_slides')
      setProgressMessage('Reading template slides...')

      let response
      if (prepResult === 'completed') {
        // Use optimized HTML-based slide listing
        setProgressMessage('Reading slides from HTML template...')
        response = await listSlidesFromHtml(sessionId)
      } else {
        // Fallback to PPTX-based listing
        setProgressMessage('Reading slides from PPTX...')
        response = await listTemplateSlides(sessionId)
      }

      if (response.success && response.slides) {
        setSlideList(response.slides)
        setProgressStep('selecting_slides')
        setProgressMessage(`Found ${response.total} slides — select the unique templates`)
        return response.slides
      } else {
        throw new Error('Failed to list slides')
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to list slides'
      setError(message)
      setProgressStep('error')
      return null
    }
  }, [sessionId, waitForTemplatePreparation])

  const analyzeTemplate = useCallback(async (templatePath: string, uniqueSlideNumbers?: number[]) => {
    setProgressStep('analyzing_template')
    setProgressMessage('Analyzing template structure with AI...')
    setError(null)

    try {
      const body: Record<string, unknown> = { templatePath }
      if (uniqueSlideNumbers) {
        body.uniqueSlideNumbers = uniqueSlideNumbers
      }
      const response = await invokeFunction<AnalyzeResponse>(
        'analyze-template',
        sessionId,
        body
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

  // Continue after user selects slides (or auto-analyze)
  const continueWithAnalysis = useCallback(async (
    templatePath: string,
    uniqueSlideNumbers?: number[]
  ) => {
    const analysisResult = await analyzeTemplate(templatePath, uniqueSlideNumbers)
    if (!analysisResult) return null

    const batchResult = await getBatchMappings()
    if (batchResult) {
      return analysisResult
    }

    return null
  }, [analyzeTemplate, getBatchMappings])

  const startBatchMappingProcess = useCallback(async (
    _templatePath: string,
    config: ProjectsConfig | SmartviewConfig,
    options?: { skipFetchProjects?: boolean }
  ) => {
    // Step 1: Fetch projects data (skip if already cached)
    if (!options?.skipFetchProjects) {
      const fetchSuccess = await fetchProjectsData(config)
      if (!fetchSuccess) return null
    } else {
      setProgressMessage('Using cached project data...')
    }

    // Step 2: List slides for user selection (fast, no AI)
    const slides = await fetchSlideList()
    if (!slides) return null

    // Flow pauses here — user selects slides in the UI
    // Then Home.tsx calls continueWithAnalysis()
    return 'selecting_slides'
  }, [fetchProjectsData, fetchSlideList])

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
    // Reset slide list and batch state
    setSlideList([])
    setBatchFields([])
    setBatchAllOptions([])
    setBatchLoading(false)
  }, [])

  // Computed state for backward compatibility
  const analyzing = progressStep === 'fetching_projects' ||
                    progressStep === 'preparing_template' ||
                    progressStep === 'listing_slides' ||
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

    // Slide selection data
    slideList,

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
    continueWithAnalysis,
    getBatchMappings,
    submitBatchMappings,
  }
}
