import { useState, useCallback, useEffect } from 'react'
import type { Step, LongTextStrategy, ProjectsConfig as ProjectsConfigType } from '@appTypes/index'
import { useSession } from '@hooks/useSession'
import { useMapping } from '@hooks/useMapping'
import { useUpload } from '@hooks/useUpload'
import { useGenerate } from '@hooks/useGenerate'
import { updateLongTextStrategy, copyMapping, copyFetchedData, getFetchedDataInfo, fetchProjects } from '@services/session.service'
import { downloadReport } from '@services/generate.service'
import { Header, Sidebar } from '@ui/layout'
import { EngineSelector } from '@ui/engine'
import { ProjectsConfig } from '@ui/projects'
import { TemplateUpload, TemplatePreview, UseLastTemplate } from '@ui/template'
import { UseLastMapping, UseLastFetchedData, MappingQuestion, BatchMappingEditor } from '@ui/mapping'
import { LongTextOptions } from '@ui/options'
import { GenerationProgress, EvaluationResult, DownloadButton } from '@ui/generation'

export function Home() {
  const {
    sessionId,
    engine,
    lastTemplateId,
    lastMappingId,
    lastFetchedDataId,
    hasFetchedData,
    projectsConfig,
    currentStep,
    setEngine,
    setLastTemplateId,
    setLastMappingId,
    setLastFetchedDataId,
    setHasFetchedData,
    setProjectsConfig,
    resetSession,
    goToStep,
  } = useSession()

  const {
    progressStep,
    progressMessage,
    analyzing,
    questionLoading,
    error: mappingError,
    currentQuestion,
    mappingComplete,
    mappingId: newMappingId,
    fetchComplete,
    answerQuestion,
    resetMapping,
    // Batch mapping
    batchFields,
    batchAllOptions,
    batchLoading,
    startBatchMappingProcess,
    submitBatchMappings,
  } = useMapping(sessionId)

  const {
    uploading,
    error: uploadError,
    progress: uploadProgress,
    uploadTemplate,
  } = useUpload(sessionId)

  const {
    generating,
    evaluating,
    fetching,
    currentStep: generationStep,
    error: generateError,
    result,
    evaluation,
    evaluationCount,
    generateWithEvaluation,
    generate,
    reEvaluate,
  } = useGenerate(sessionId, engine)

  const [templatePath, setTemplatePath] = useState<string | null>(null)
  const [longTextStrategy, setLongTextStrategy] = useState<LongTextStrategy | null>(null)
  const [completedSteps, setCompletedSteps] = useState<Step[]>([])
  const [showUploadNew, setShowUploadNew] = useState(false)
  const [showCreateNewMapping, setShowCreateNewMapping] = useState(false)
  const [showFetchNewData, setShowFetchNewData] = useState(false)
  const [analysisStarted, setAnalysisStarted] = useState(false)
  const [cachedDataInfo, setCachedDataInfo] = useState<{ projectCount: number; fetchedAt: string } | null>(null)
  const [useCachedData, setUseCachedData] = useState(false)
  const [copyingData, setCopyingData] = useState(false)
  const [checkingCachedData, setCheckingCachedData] = useState(false)
  const [startingGeneration, setStartingGeneration] = useState(false)

  const markStepComplete = useCallback((step: Step) => {
    setCompletedSteps((prev) => (prev.includes(step) ? prev : [...prev, step]))
  }, [])

  const handleEngineSelect = useCallback(
    (selectedEngine: typeof engine) => {
      if (selectedEngine) {
        setEngine(selectedEngine)
        markStepComplete('select_engine')
        goToStep('configure_projects')
      }
    },
    [setEngine, markStepComplete, goToStep]
  )

  const handleProjectsSave = useCallback(
    (config: ProjectsConfigType) => {
      setProjectsConfig(config)
    },
    [setProjectsConfig]
  )

  const handleProjectsContinue = useCallback(() => {
    if (projectsConfig && projectsConfig.projects.length > 0) {
      markStepComplete('configure_projects')
      goToStep('upload_template')
    }
  }, [projectsConfig, markStepComplete, goToStep])

  const handleTemplateUpload = useCallback(
    async (file: File) => {
      const path = await uploadTemplate(file)
      if (path) {
        setTemplatePath(path)
        setLastTemplateId(path)
      }
    },
    [uploadTemplate, setLastTemplateId]
  )

  const handleContinueToMapping = useCallback(async () => {
    if (templatePath) {
      markStepComplete('upload_template')
      // Check if there's cached project data to reuse
      if (lastFetchedDataId && !showFetchNewData) {
        setCheckingCachedData(true)
        try {
          // Get info about the cached data
          const info = await getFetchedDataInfo(lastFetchedDataId)
          if (info.success && info.projectCount && info.fetchedAt) {
            setCachedDataInfo({ projectCount: info.projectCount, fetchedAt: info.fetchedAt })
            goToStep('check_fetched_data')
            return
          }
        } finally {
          setCheckingCachedData(false)
        }
      }
      // Check if there's a previous mapping to reuse
      if (lastMappingId && !showCreateNewMapping) {
        goToStep('check_mapping')
      } else {
        setAnalysisStarted(false)
        resetMapping()
        goToStep('mapping')
      }
    }
  }, [templatePath, lastFetchedDataId, lastMappingId, showFetchNewData, showCreateNewMapping, markStepComplete, goToStep, resetMapping])

  const handleUseLastMapping = useCallback(async () => {
    if (!lastMappingId) return

    setCopyingData(true)
    try {
      // Copy mapping from previous session to current session
      const result = await copyMapping(sessionId, lastMappingId)
      if (result.success) {
        if (result.hasFetchedData) {
          setHasFetchedData(true)
          setUseCachedData(true)
        } else {
          // Mapping copied but no project data - will fetch during generation
          console.log('Mapping copied but no fetched data - will fetch during generation')
          setHasFetchedData(false) // Important: reset to false so fetch happens
          setUseCachedData(false)
        }
        markStepComplete('check_mapping')
        markStepComplete('mapping')
        goToStep('long_text_options')
      } else {
        // If copy fails, fall back to creating new mapping
        console.error('Failed to copy mapping:', result.error)
        setShowCreateNewMapping(true)
        markStepComplete('check_mapping')
        setAnalysisStarted(false)
        resetMapping()
        goToStep('mapping')
      }
    } finally {
      setCopyingData(false)
    }
  }, [lastMappingId, sessionId, setHasFetchedData, markStepComplete, goToStep, resetMapping])

  const handleCreateNewMapping = useCallback(() => {
    setShowCreateNewMapping(true)
    markStepComplete('check_mapping')
    setAnalysisStarted(false)
    resetMapping()
    goToStep('mapping')
  }, [markStepComplete, goToStep, resetMapping])

  const handleUseLastFetchedData = useCallback(async () => {
    if (!lastFetchedDataId) return

    setCopyingData(true)
    try {
      // Copy fetched data from previous session to current session
      const result = await copyFetchedData(sessionId, lastFetchedDataId)
      if (result.success) {
        setHasFetchedData(true)
        setUseCachedData(true) // Mark that we're using cached data
        markStepComplete('check_fetched_data')
        // Now check if there's a mapping to reuse
        if (lastMappingId && !showCreateNewMapping) {
          goToStep('check_mapping')
        } else {
          setAnalysisStarted(false)
          resetMapping()
          goToStep('mapping')
        }
      } else {
        // If copy fails, fall back to fetching new data
        console.error('Failed to copy fetched data:', result.error)
        handleFetchNewData()
      }
    } finally {
      setCopyingData(false)
    }
  }, [lastFetchedDataId, sessionId, lastMappingId, showCreateNewMapping, setHasFetchedData, markStepComplete, goToStep, resetMapping])

  const handleFetchNewData = useCallback(() => {
    setShowFetchNewData(true)
    setUseCachedData(false) // Mark that we need fresh data
    markStepComplete('check_fetched_data')
    setAnalysisStarted(false)
    resetMapping()
    goToStep('mapping')
  }, [markStepComplete, goToStep, resetMapping])

  const handleUseLastTemplate = useCallback(() => {
    if (lastTemplateId) {
      setTemplatePath(lastTemplateId)
    }
  }, [lastTemplateId])

  const handleUploadNew = useCallback(() => {
    setShowUploadNew(true)
  }, [])

  const handleMappingAnswer = useCallback(
    async (fieldId: string, answer: string) => {
      await answerQuestion(fieldId, answer)
    },
    [answerQuestion]
  )

  const handleBatchMappingSubmit = useCallback(
    async (mappings: Record<string, string>) => {
      const result = await submitBatchMappings(mappings)
      if (result?.success) {
        // Save mapping ID for reuse
        setLastMappingId(result.mappingId)
        markStepComplete('mapping')
        goToStep('long_text_options')
      }
    },
    [submitBatchMappings, setLastMappingId, markStepComplete, goToStep]
  )

  const handleLongTextSelect = useCallback((strategy: LongTextStrategy) => {
    setLongTextStrategy(strategy)
  }, [])

  const handleContinueToGeneration = useCallback(async () => {
    if (longTextStrategy) {
      setStartingGeneration(true)
      try {
        await updateLongTextStrategy(sessionId, longTextStrategy)
        markStepComplete('long_text_options')
        goToStep('generating')

        // Debug: log the state
        console.log('handleContinueToGeneration:', { hasFetchedData, hasProjectsConfig: !!projectsConfig })

        // If we don't have fetched data yet, fetch it now before generating
        if (!hasFetchedData) {
          if (projectsConfig && projectsConfig.projects.length > 0) {
            console.log('No fetched data - fetching projects before generation...')
            try {
              const fetchResult = await fetchProjects(sessionId, projectsConfig)
              if (fetchResult.success) {
                setHasFetchedData(true)
                console.log(`Fetched ${fetchResult.projectCount} projects - waiting for data propagation...`)
                // Small delay to ensure data is committed to database
                await new Promise(resolve => setTimeout(resolve, 1000))
              } else {
                console.error('Failed to fetch projects:', fetchResult.error)
                // Don't continue - show error to user
                return
              }
            } catch (error) {
              console.error('Error fetching projects:', error)
              return
            }
          } else {
            console.warn('No fetched data AND no projectsConfig - generation will likely fail')
            return
          }
        }

        await generateWithEvaluation()
        goToStep('done')
        markStepComplete('generating')
        markStepComplete('evaluating')
        markStepComplete('done')
      } finally {
        setStartingGeneration(false)
      }
    }
  }, [sessionId, longTextStrategy, markStepComplete, goToStep, generateWithEvaluation, hasFetchedData, projectsConfig, setHasFetchedData])

  const handleRegenerate = useCallback(async () => {
    goToStep('generating')
    await generate()
    goToStep('done')
  }, [goToStep, generate])

  const handleDownloadReport = useCallback(() => {
    if (result?.pptxUrl) {
      downloadReport(result.pptxUrl, 'portfolio_report.pptx')
    }
  }, [result])

  const handleDownloadPrompt = useCallback(() => {
    if (result?.prompt) {
      // Create a blob with the prompt content and download it
      const blob = new Blob([result.prompt], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'gamma_prompt.txt'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    }
  }, [result])

  const handleReset = useCallback(() => {
    resetSession()
    setTemplatePath(null)
    setLongTextStrategy(null)
    setCompletedSteps([])
    setShowUploadNew(false)
    setShowCreateNewMapping(false)
    setShowFetchNewData(false)
    setAnalysisStarted(false)
    setCachedDataInfo(null)
    setUseCachedData(false)
    setCopyingData(false)
    setCheckingCachedData(false)
    setStartingGeneration(false)
    resetMapping()
  }, [resetSession, resetMapping])

  // Auto-trigger mapping process when entering mapping step
  useEffect(() => {
    const startProcess = async () => {
      if (currentStep === 'mapping' && templatePath && projectsConfig && !analysisStarted && !analyzing) {
        setAnalysisStarted(true)
        // Skip fetching projects if we're using cached data
        // Use batch mapping process (new UX)
        await startBatchMappingProcess(templatePath, projectsConfig, { skipFetchProjects: useCachedData })
      }
    }
    startProcess()
  }, [currentStep, templatePath, projectsConfig, analysisStarted, analyzing, startBatchMappingProcess, useCachedData])

  // Save lastFetchedDataId immediately when fetch completes (before analyze-template)
  // This ensures data is saved for reuse even if subsequent steps fail
  useEffect(() => {
    if (fetchComplete && !useCachedData) {
      setLastFetchedDataId(sessionId)
      setHasFetchedData(true)
    }
  }, [fetchComplete, useCachedData, sessionId, setLastFetchedDataId, setHasFetchedData])

  // Handle mapping completion
  useEffect(() => {
    if (mappingComplete && currentStep === 'mapping') {
      // Save the mappingId for future reuse
      if (newMappingId) {
        setLastMappingId(newMappingId)
        // Note: lastFetchedDataId is already saved when fetch completes (see useEffect above)
      }
      markStepComplete('mapping')
      goToStep('long_text_options')
    }
  }, [mappingComplete, currentStep, newMappingId, setLastMappingId, markStepComplete, goToStep])

  const renderContent = () => {
    switch (currentStep) {
      case 'select_engine':
        return <EngineSelector selected={engine} onSelect={handleEngineSelect} />

      case 'configure_projects':
        return (
          <ProjectsConfig
            config={projectsConfig}
            onSave={handleProjectsSave}
            onContinue={handleProjectsContinue}
          />
        )

      case 'upload_template':
        if (lastTemplateId && !templatePath && !showUploadNew) {
          return (
            <UseLastTemplate
              lastTemplateId={lastTemplateId}
              onUseLastTemplate={handleUseLastTemplate}
              onUploadNew={handleUploadNew}
              loading={uploading}
            />
          )
        }
        if (templatePath) {
          return (
            <TemplatePreview
              templatePath={templatePath}
              onContinue={handleContinueToMapping}
              loading={analyzing || copyingData || checkingCachedData}
            />
          )
        }
        return (
          <TemplateUpload
            onUpload={handleTemplateUpload}
            uploading={uploading}
            progress={uploadProgress}
            error={uploadError}
          />
        )

      case 'check_fetched_data':
        return cachedDataInfo ? (
          <UseLastFetchedData
            projectCount={cachedDataInfo.projectCount}
            fetchedAt={cachedDataInfo.fetchedAt}
            onUseLastData={handleUseLastFetchedData}
            onFetchNew={handleFetchNewData}
            loading={copyingData}
          />
        ) : (
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            <p className="text-gray-600">Loading cached data info...</p>
          </div>
        )

      case 'check_mapping':
        return (
          <UseLastMapping
            hasFetchedData={hasFetchedData}
            onUseLastMapping={handleUseLastMapping}
            onCreateNew={handleCreateNewMapping}
            loading={copyingData}
          />
        )

      case 'mapping':
        // Show detailed progress during analysis
        if (analyzing) {
          // Adjust steps based on whether we're using cached data
          const steps = useCachedData
            ? [
                { key: 'fetching_projects', label: 'Using cached project data', icon: '✓', skipped: true },
                { key: 'analyzing_template', label: 'Analyzing template with AI', icon: '🔍' },
                { key: 'loading_batch', label: 'Generating mapping suggestions', icon: '📋' },
              ]
            : [
                { key: 'fetching_projects', label: 'Downloading projects data from AirSaas', icon: '📥' },
                { key: 'analyzing_template', label: 'Analyzing template with AI', icon: '🔍' },
                { key: 'loading_batch', label: 'Generating mapping suggestions', icon: '📋' },
              ]

          const currentStepIndex = steps.findIndex(s => s.key === progressStep)

          return (
            <div className="py-8 space-y-6">
              <h2 className="text-lg font-semibold text-gray-900 text-center">
                Setting up field mapping...
              </h2>

              <div className="space-y-4">
                {steps.map((step, index) => {
                  const isSkipped = 'skipped' in step && step.skipped
                  const isActive = step.key === progressStep && !isSkipped
                  const isComplete = index < currentStepIndex || isSkipped

                  return (
                    <div
                      key={step.key}
                      className={`flex items-center gap-4 p-4 rounded-lg border transition-all ${
                        isActive
                          ? 'border-blue-300 bg-blue-50'
                          : isComplete
                            ? 'border-green-200 bg-green-50'
                            : 'border-gray-200 bg-gray-50'
                      }`}
                    >
                      <div className="flex-shrink-0 w-10 h-10 flex items-center justify-center">
                        {isActive ? (
                          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
                        ) : isComplete ? (
                          <span className="text-green-600 text-xl">✓</span>
                        ) : (
                          <span className="text-gray-400 text-xl">{step.icon}</span>
                        )}
                      </div>
                      <div className="flex-1">
                        <p className={`font-medium ${
                          isActive ? 'text-blue-800' : isComplete ? 'text-green-800' : 'text-gray-500'
                        }`}>
                          {step.label}
                        </p>
                        {isActive && progressMessage && (
                          <p className="text-sm text-blue-600 mt-1">{progressMessage}</p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              <p className="text-sm text-gray-400 text-center">
                This may take a few minutes depending on the number of projects...
              </p>
            </div>
          )
        }

        // Show error if any
        if (mappingError || progressStep === 'error') {
          return (
            <div className="bg-red-50 border border-red-200 rounded-lg p-6 space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-2xl">❌</span>
                <p className="text-red-800 font-medium text-lg">Error occurred</p>
              </div>
              <p className="text-red-600">{mappingError || 'An unknown error occurred'}</p>
              <button
                onClick={() => {
                  setAnalysisStarted(false)
                  resetMapping()
                }}
                className="w-full mt-4 py-2 px-4 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors font-medium"
              >
                Try again
              </button>
            </div>
          )
        }

        // Show batch mapping editor (new UX)
        if (batchFields.length > 0) {
          return (
            <BatchMappingEditor
              fields={batchFields}
              allOptions={batchAllOptions}
              onSubmit={handleBatchMappingSubmit}
              loading={batchLoading}
            />
          )
        }

        // Legacy: Show loading state for questions
        if (questionLoading && !currentQuestion) {
          return (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
              <p className="text-gray-600">Loading next question...</p>
            </div>
          )
        }

        // Legacy: Show question (fallback for old one-by-one flow)
        if (currentQuestion) {
          return (
            <MappingQuestion
              currentIndex={currentQuestion.currentIndex}
              totalFields={currentQuestion.totalFields}
              field={currentQuestion.field}
              question={currentQuestion.question}
              suggestedOptions={currentQuestion.suggestedOptions}
              allOptions={currentQuestion.allOptions}
              reasoning={currentQuestion.reasoning}
              confidence={currentQuestion.confidence}
              onAnswer={handleMappingAnswer}
              loading={questionLoading}
            />
          )
        }

        // Fallback: waiting for analysis
        return (
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            <p className="text-gray-600">Initializing...</p>
          </div>
        )

      case 'long_text_options':
        return (
          <LongTextOptions
            selected={longTextStrategy}
            onSelect={handleLongTextSelect}
            onContinue={handleContinueToGeneration}
            loading={startingGeneration}
          />
        )

      case 'generating':
      case 'evaluating':
        return (
          <GenerationProgress
            generating={generating}
            evaluating={evaluating}
            fetching={fetching}
            currentStep={generationStep}
            iteration={result?.iteration || 1}
            error={generateError}
            onRetry={generateError ? handleRegenerate : undefined}
            pptxUrl={result?.pptxUrl}
            prompt={result?.prompt}
            onDownload={handleDownloadReport}
            onDownloadPrompt={handleDownloadPrompt}
          />
        )

      case 'done':
        return (
          <div className="space-y-6">
            {evaluation && (
              <EvaluationResult
                evaluation={evaluation.evaluation}
                onRegenerate={handleRegenerate}
                showRegenerate={evaluation.shouldRegenerate}
              />
            )}
            {result && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-gray-900">Your Report is Ready!</h2>
                <DownloadButton pptxUrl={result.pptxUrl} fileName="portfolio_report.pptx" />

                {/* Download Prompt button */}
                {result.prompt && (
                  <button
                    onClick={handleDownloadPrompt}
                    className="w-full border border-blue-600 text-blue-600 rounded-lg py-2 px-4 font-medium hover:bg-blue-50 transition-colors"
                  >
                    Download Prompt
                  </button>
                )}

                {/* Re-evaluate button */}
                {evaluationCount < 2 && (
                  <button
                    onClick={reEvaluate}
                    disabled={evaluating}
                    className={`w-full border rounded-lg py-2 px-4 font-medium transition-colors ${
                      evaluating
                        ? 'border-gray-300 text-gray-400 cursor-not-allowed'
                        : 'border-purple-600 text-purple-600 hover:bg-purple-50'
                    }`}
                  >
                    {evaluating ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-600" />
                        Re-evaluating...
                      </span>
                    ) : (
                      `Re-evaluate (${evaluationCount}/2)`
                    )}
                  </button>
                )}
              </div>
            )}
            <button
              onClick={handleReset}
              className="w-full border border-gray-300 text-gray-700 rounded-lg py-2 px-4 font-medium hover:bg-gray-50 transition-colors"
            >
              Generate Another Report
            </button>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      <Header onReset={handleReset} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar currentStep={currentStep} completedSteps={completedSteps} sessionId={sessionId} />
        <main className="flex-1 overflow-hidden p-6">
          <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-sm border border-gray-200 p-6 h-full max-h-full overflow-y-auto">
            {renderContent()}
          </div>
        </main>
      </div>
    </div>
  )
}
