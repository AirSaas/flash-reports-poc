import { useState, useCallback, useEffect } from 'react'
import type { Step, LongTextStrategy } from '@appTypes/index'
import { useSession } from '@hooks/useSession'
import { useChat } from '@hooks/useChat'
import { useUpload } from '@hooks/useUpload'
import { useGenerate } from '@hooks/useGenerate'
import { updateLongTextStrategy, copyMapping } from '@services/session.service'
import { Header, Sidebar } from '@ui/layout'
import { EngineSelector } from '@ui/engine'
import { TemplateUpload, TemplatePreview, UseLastTemplate } from '@ui/template'
import { UseLastMapping } from '@ui/mapping'
import { ChatContainer } from '@ui/chat'
import { LongTextOptions } from '@ui/options'
import { GenerationProgress, EvaluationResult, DownloadButton } from '@ui/generation'

export function Home() {
  const {
    sessionId,
    engine,
    lastTemplateId,
    lastMappingId,
    hasFetchedData,
    currentStep,
    setEngine,
    setLastTemplateId,
    setLastMappingId,
    setHasFetchedData,
    resetSession,
    goToStep,
  } = useSession()

  const {
    messages,
    loading: chatLoading,
    error: chatError,
    mappingComplete,
    mappingId: chatMappingId,
    sendMessage,
    clearMessages,
    setInitialMessages,
  } = useChat(sessionId)

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
    generateWithEvaluation,
    generate,
  } = useGenerate(sessionId, engine)

  const [templatePath, setTemplatePath] = useState<string | null>(null)
  const [longTextStrategy, setLongTextStrategy] = useState<LongTextStrategy | null>(null)
  const [completedSteps, setCompletedSteps] = useState<Step[]>([])
  const [showUploadNew, setShowUploadNew] = useState(false)
  const [showCreateNewMapping, setShowCreateNewMapping] = useState(false)
  const [mappingInitiated, setMappingInitiated] = useState(false)

  const markStepComplete = useCallback((step: Step) => {
    setCompletedSteps((prev) => (prev.includes(step) ? prev : [...prev, step]))
  }, [])

  const handleEngineSelect = useCallback(
    (selectedEngine: typeof engine) => {
      if (selectedEngine) {
        setEngine(selectedEngine)
        markStepComplete('select_engine')
        goToStep('upload_template')
      }
    },
    [setEngine, markStepComplete, goToStep]
  )

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

  const handleContinueToMapping = useCallback(() => {
    if (templatePath) {
      markStepComplete('upload_template')
      // Check if there's a previous mapping to reuse
      if (lastMappingId && !showCreateNewMapping) {
        goToStep('check_mapping')
      } else {
        setMappingInitiated(false)
        clearMessages()
        goToStep('mapping')
      }
    }
  }, [templatePath, lastMappingId, showCreateNewMapping, markStepComplete, goToStep, clearMessages])

  const handleUseLastMapping = useCallback(async () => {
    if (!lastMappingId) return

    // Copy mapping from previous session to current session
    const result = await copyMapping(sessionId, lastMappingId)
    if (result.success) {
      if (result.hasFetchedData) {
        setHasFetchedData(true)
      }
      markStepComplete('check_mapping')
      markStepComplete('mapping')
      goToStep('long_text_options')
    } else {
      // If copy fails, fall back to creating new mapping
      console.error('Failed to copy mapping:', result.error)
      handleCreateNewMapping()
    }
  }, [lastMappingId, sessionId, setHasFetchedData, markStepComplete, goToStep])

  const handleCreateNewMapping = useCallback(() => {
    setShowCreateNewMapping(true)
    markStepComplete('check_mapping')
    setMappingInitiated(false)
    clearMessages()
    goToStep('mapping')
  }, [markStepComplete, goToStep, clearMessages])

  const handleUseLastTemplate = useCallback(() => {
    if (lastTemplateId) {
      setTemplatePath(lastTemplateId)
    }
  }, [lastTemplateId])

  const handleUploadNew = useCallback(() => {
    setShowUploadNew(true)
  }, [])

  const handleChatMessage = useCallback(
    async (content: string) => {
      await sendMessage(content)
    },
    [sendMessage]
  )

  const handleLongTextSelect = useCallback((strategy: LongTextStrategy) => {
    setLongTextStrategy(strategy)
  }, [])

  const handleContinueToGeneration = useCallback(async () => {
    if (longTextStrategy) {
      await updateLongTextStrategy(sessionId, longTextStrategy)
      markStepComplete('long_text_options')
      goToStep('generating')
      await generateWithEvaluation()
      goToStep('done')
      markStepComplete('generating')
      markStepComplete('evaluating')
      markStepComplete('done')
    }
  }, [sessionId, longTextStrategy, markStepComplete, goToStep, generateWithEvaluation])

  const handleRegenerate = useCallback(async () => {
    goToStep('generating')
    await generate()
    goToStep('done')
  }, [goToStep, generate])

  const handleReset = useCallback(() => {
    resetSession()
    setTemplatePath(null)
    setLongTextStrategy(null)
    setCompletedSteps([])
    setShowUploadNew(false)
    setShowCreateNewMapping(false)
    setMappingInitiated(false)
    clearMessages()
  }, [resetSession, clearMessages])

  // Auto-trigger first message when entering mapping step
  useEffect(() => {
    if (currentStep === 'mapping' && templatePath && messages.length === 0 && !mappingInitiated && !chatLoading) {
      setMappingInitiated(true)
      // Show "Analyzing..." message to user
      setInitialMessages([
        { role: 'user', content: 'Analyzing your template...' }
      ])
      const initialMessage = `I have uploaded a PPTX template at: ${templatePath}.
Please analyze the template structure and help me map the placeholders to AirSaas project data fields.
Start by identifying the slides and their placeholders.`
      sendMessage(initialMessage)
    }
  }, [currentStep, templatePath, messages.length, mappingInitiated, chatLoading, sendMessage, setInitialMessages])

  // Handle mapping completion
  useEffect(() => {
    if (mappingComplete && currentStep === 'mapping') {
      // Save the mappingId for future reuse
      if (chatMappingId) {
        setLastMappingId(chatMappingId)
        setHasFetchedData(true) // Data is fetched during mapping
      }
      markStepComplete('mapping')
      goToStep('long_text_options')
    }
  }, [mappingComplete, currentStep, chatMappingId, setLastMappingId, setHasFetchedData, markStepComplete, goToStep])

  const renderContent = () => {
    switch (currentStep) {
      case 'select_engine':
        return <EngineSelector selected={engine} onSelect={handleEngineSelect} />

      case 'upload_template':
        if (lastTemplateId && !templatePath && !showUploadNew) {
          return (
            <UseLastTemplate
              lastTemplateId={lastTemplateId}
              onUseLastTemplate={handleUseLastTemplate}
              onUploadNew={handleUploadNew}
            />
          )
        }
        if (templatePath) {
          return (
            <TemplatePreview templatePath={templatePath} onContinue={handleContinueToMapping} />
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

      case 'check_mapping':
        return (
          <UseLastMapping
            hasFetchedData={hasFetchedData}
            onUseLastMapping={handleUseLastMapping}
            onCreateNew={handleCreateNewMapping}
          />
        )

      case 'mapping':
        return (
          <div className="h-full">
            <ChatContainer
              messages={messages}
              loading={chatLoading}
              error={chatError}
              onSendMessage={handleChatMessage}
              disabled={mappingComplete}
            />
          </div>
        )

      case 'long_text_options':
        return (
          <LongTextOptions
            selected={longTextStrategy}
            onSelect={handleLongTextSelect}
            onContinue={handleContinueToGeneration}
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
        <Sidebar currentStep={currentStep} completedSteps={completedSteps} />
        <main className="flex-1 overflow-auto p-6">
          <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-sm border border-gray-200 p-6 min-h-[500px]">
            {renderContent()}
          </div>
        </main>
      </div>
    </div>
  )
}
