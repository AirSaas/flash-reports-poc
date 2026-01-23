import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders, handleCors } from "../_shared/cors.ts"
import { getSupabaseClient } from "../_shared/supabase.ts"

const GAMMA_TEMPLATE_ID = 'g_9d4wnyvr02om4zk'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

interface TemplateField {
  id: string
  name: string
  data_type?: string
  location?: string
  placeholder_text?: string
}

interface TemplateSlide {
  slide_number: number
  title: string
  fields: TemplateField[]
}

interface TemplateAnalysis {
  slides: TemplateSlide[]
}

interface FieldMapping {
  source: string
  status: string
}

interface MappingJson {
  slides: Record<string, Record<string, FieldMapping>>
  missing_fields: string[]
}

interface InputData {
  mappingJson: MappingJson
  longTextStrategy: string | null
  fetchedData: Record<string, unknown>[]
  templateAnalysis?: TemplateAnalysis
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Extracts a nested value from an object using a dot-separated path.
 * E.g., getNestedValue(obj, "project.owner.first_name") returns obj.project.owner.first_name
 */
function getNestedValue(obj: unknown, path: string): unknown {
  if (!path || path === 'none') return undefined
  if (!obj) return undefined

  const parts = path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }

  return current
}

/**
 * Formats a value based on its data type from the template analysis
 */
function formatValue(value: unknown, dataType?: string): string {
  if (value === null || value === undefined) return ''

  // Handle arrays
  if (Array.isArray(value)) {
    if (value.length === 0) return ''
    // For arrays, try to extract meaningful content
    return value.slice(0, 5).map(item => {
      if (typeof item === 'object' && item !== null) {
        const obj = item as Record<string, unknown>
        return obj.name || obj.title || obj.label || JSON.stringify(item)
      }
      return String(item)
    }).join(', ')
  }

  // Handle objects (like owner, status with .name)
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>
    // Try common name fields
    if (obj.name) return String(obj.name)
    if (obj.title) return String(obj.title)
    if (obj.label) return String(obj.label)
    if (obj.full_name) return String(obj.full_name)
    if (obj.first_name && obj.last_name) {
      return `${obj.first_name} ${obj.last_name}`
    }
    if (obj.first_name) return String(obj.first_name)
    // For other objects, stringify them
    return JSON.stringify(obj)
  }

  // Handle dates
  if (dataType === 'date' || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value))) {
    try {
      const date = new Date(String(value))
      if (!isNaN(date.getTime())) {
        return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
      }
    } catch {
      // Fall through to default
    }
  }

  // Handle numbers
  if (dataType === 'number' || typeof value === 'number') {
    const num = typeof value === 'number' ? value : parseFloat(String(value))
    if (!isNaN(num)) {
      return num.toLocaleString('en-US')
    }
  }

  return String(value)
}

/**
 * Converts longTextStrategy to a clear instruction for Gamma
 */
function getLongTextInstruction(strategy: string | null): string {
  const baseInstruction = `## FORMATTING RULES (MUST FOLLOW)

You are generating a professional portfolio presentation. Follow these rules strictly:

### Long Text Handling Strategy: `

  switch (strategy) {
    case 'summarize':
      return baseInstruction + `**SUMMARIZE**

When you encounter any text field (descriptions, comments, notes, explanations, etc.) that contains more than 2 sentences:
- Condense it into exactly 1-2 clear, concise sentences
- Preserve the key information and main message
- Remove redundant details and filler words
- This applies to ALL text content in the presentation

Example: "The project has been progressing well over the past quarter. We have completed several key milestones including the design phase and initial development. The team is working hard to meet the deadline. There have been some minor delays due to resource constraints but overall we are on track."
→ Should become: "Project progressing well with design and initial development complete. Minor delays due to resource constraints but on track for deadline."`

    case 'ellipsis':
      return baseInstruction + `**TRUNCATE WITH ELLIPSIS**

When you encounter any text field (descriptions, comments, notes, explanations, etc.) that exceeds 100 characters:
- Cut the text at approximately 100 characters
- Add "..." at the end to indicate truncation
- Try to cut at a natural word boundary when possible
- This applies to ALL text content in the presentation

Example: "The project has been progressing well over the past quarter with several milestones completed."
→ Should become: "The project has been progressing well over the past quarter with several..."`

    case 'omit':
      return baseInstruction + `**OMIT LONG TEXT**

When you encounter any text field (descriptions, comments, notes, explanations, etc.) that exceeds 200 characters:
- Completely remove/omit that text from the slide
- Do not show truncated versions, just leave it out
- Short text (under 200 characters) should be kept as-is
- This applies to ALL text content in the presentation

Example: A 500-character description should be completely omitted from the slide.`

    default:
      return baseInstruction + `**KEEP READABLE**

Keep all text fields at a reasonable length for presentation slides:
- Maximum 300 characters per text field
- If longer, summarize or truncate as needed for readability
- Prioritize clarity and visual cleanliness
- This applies to ALL text content in the presentation`
  }
}

/**
 * Gets critical rules for the presentation generation
 */
function getCriticalRules(): string {
  return `
---

## CRITICAL RULES

**IMPORTANT - READ CAREFULLY:**

1. Use ONLY the data provided below - do NOT invent or fabricate any values
2. If a field has no data in the prompt, you may use "N/A" or "TBD" as placeholder
3. Follow the exact slide structure defined below for each project
4. Apply the formatting rules above to all text content
5. Each project gets its own set of slides following the template structure

---
`
}

/**
 * Builds the summary slide content with all projects
 */
function buildSummarySlide(fetchedData: Record<string, unknown>[]): string {
  const projectLines = fetchedData.map((p) => {
    const meta = p._metadata as { name?: string; short_id?: string } | undefined
    const project = p.project as Record<string, unknown> | undefined

    const name = meta?.name || 'Unknown Project'
    const shortId = meta?.short_id || ''

    // Get mood and status - they might be objects with .name or strings
    let mood = ''
    if (project?.mood) {
      mood = typeof project.mood === 'object'
        ? (project.mood as Record<string, unknown>).name as string || ''
        : String(project.mood)
    }

    let status = ''
    if (project?.status) {
      status = typeof project.status === 'object'
        ? (project.status as Record<string, unknown>).name as string || ''
        : String(project.status)
    }

    const idPart = shortId ? ` (${shortId})` : ''
    const statusPart = [mood, status].filter(Boolean).join(' / ')

    return `- **${name}**${idPart}${statusPart ? ` - ${statusPart}` : ''}`
  }).join('\n')

  return `
# Portfolio Summary

## Projects Overview
${projectLines}
`
}

/**
 * Applies the user-defined mapping to extract data for a single project
 */
function applyMappingToProject(
  projectData: Record<string, unknown>,
  mappingJson: MappingJson,
  templateAnalysis: TemplateAnalysis
): Record<string, { title: string; fields: Record<string, { value: string; fieldName: string; dataType?: string }> }> {
  const result: Record<string, { title: string; fields: Record<string, { value: string; fieldName: string; dataType?: string }> }> = {}

  for (const slide of templateAnalysis.slides) {
    const slideKey = `slide_${slide.slide_number}`
    const slideMapping = mappingJson.slides[slideKey] || {}

    result[slideKey] = {
      title: slide.title,
      fields: {}
    }

    for (const field of slide.fields) {
      const mapping = slideMapping[field.id]

      if (mapping && mapping.source && mapping.source !== 'none') {
        // Extract value using the path from the mapping
        const rawValue = getNestedValue(projectData, mapping.source)
        const formattedValue = formatValue(rawValue, field.data_type)

        result[slideKey].fields[field.id] = {
          value: formattedValue || 'N/A',
          fieldName: field.name,
          dataType: field.data_type
        }
      }
    }
  }

  return result
}

/**
 * Builds the slides content for a single project using the mapped data
 */
function buildProjectSlides(
  projectData: Record<string, unknown>,
  mappedData: Record<string, { title: string; fields: Record<string, { value: string; fieldName: string; dataType?: string }> }>
): string {
  const meta = projectData._metadata as { name?: string; short_id?: string } | undefined
  const projectName = meta?.name || 'Project'
  const sections: string[] = []

  // Header for this project
  sections.push(`
---

# ${projectName}
`)

  // Generate each slide from the mapped data
  for (const [slideKey, slideData] of Object.entries(mappedData)) {
    const fieldEntries = Object.entries(slideData.fields)

    // Only add slide if it has fields with data
    if (fieldEntries.length === 0) continue

    const fieldLines = fieldEntries.map(([_fieldId, fieldInfo]) => {
      return `- **${fieldInfo.fieldName}**: ${fieldInfo.value}`
    }).join('\n')

    sections.push(`
## ${slideData.title}
${fieldLines}
`)
  }

  return sections.join('')
}

/**
 * Builds the Data Notes slide with missing/unmapped fields
 */
function buildDataNotesSlide(missingFields: string[]): string {
  if (missingFields.length === 0) return ''

  return `
---

# Data Notes

## Fields Not Available
The following fields were not populated because they were not mapped or data is not available:
${missingFields.map((f) => `- ${f}`).join('\n')}
`
}

/**
 * Fallback function to build content when template analysis is not available
 * Uses the legacy hardcoded approach
 */
function buildLegacyContent(
  fetchedData: Record<string, unknown>[],
  mappingJson: MappingJson
): string {
  const sections: string[] = []

  // Summary
  sections.push(buildSummarySlide(fetchedData))

  // Process each project with hardcoded field extraction
  for (const projectData of fetchedData) {
    const meta = projectData._metadata as { name?: string; short_id?: string } | undefined
    const project = projectData.project as Record<string, unknown> | undefined
    const milestones = projectData.milestones as Array<Record<string, unknown>> | undefined
    const budgetLines = projectData.budget_lines as Array<Record<string, unknown>> | undefined

    const projectName = meta?.name || 'Project'
    const shortId = meta?.short_id || ''

    // Build key information
    const keyInfoLines: string[] = []

    if (shortId) keyInfoLines.push(`- **Project ID**: ${shortId}`)
    if (project?.status) keyInfoLines.push(`- **Status**: ${formatValue(project.status)}`)
    if (project?.mood) keyInfoLines.push(`- **Mood**: ${formatValue(project.mood)}`)
    if (project?.risk) keyInfoLines.push(`- **Risk Level**: ${formatValue(project.risk)}`)
    if (project?.owner) keyInfoLines.push(`- **Owner**: ${formatValue(project.owner)}`)

    // Card slide
    sections.push(`
---

# ${projectName}

## Key Information
${keyInfoLines.length > 0 ? keyInfoLines.join('\n') : '- No key information available'}

${project?.description ? `### Description\n${formatValue(project.description)}` : ''}
`)

    // Milestones slide
    if (milestones && milestones.length > 0) {
      const milestonesWithData = milestones.slice(0, 5).map((m) => {
        const name = m.name || m.title || ''
        if (!name) return null
        const dateValue = m.target_date || m.due_date || m.date
        const formattedDate = formatValue(dateValue, 'date')
        const status = formatValue(m.status)
        let line = `- **${name}**`
        if (formattedDate) line += `: ${formattedDate}`
        if (status) line += ` (${status})`
        return line
      }).filter(Boolean)

      if (milestonesWithData.length > 0) {
        sections.push(`
---

# ${projectName} - Progress

## Milestones
${milestonesWithData.join('\n')}
`)
      }
    }

    // Budget slide
    if (budgetLines && budgetLines.length > 0) {
      const budgetWithData = budgetLines.slice(0, 5).map((b) => {
        const name = b.name || b.label || b.category || ''
        if (!name) return null
        const amount = b.amount || b.value || b.budget
        const formattedAmount = formatValue(amount, 'number')
        if (!formattedAmount) return `- **${name}**`
        return `- **${name}**: ${formattedAmount}`
      }).filter(Boolean)

      if (budgetWithData.length > 0) {
        sections.push(`
---

# ${projectName} - Budget

## Budget Lines
${budgetWithData.join('\n')}
`)
      }
    }
  }

  // Data Notes slide
  sections.push(buildDataNotesSlide(mappingJson.missing_fields || []))

  return sections.join('')
}

// =============================================================================
// MAIN CONTENT BUILDER
// =============================================================================

/**
 * Builds the complete content for Gamma presentation generation.
 *
 * Uses the user-defined mapping from the Q&A flow to extract data
 * according to the template structure.
 */
function buildGammaContent(
  mappingJson: MappingJson,
  fetchedData: Record<string, unknown>[],
  longTextStrategy: string | null,
  templateAnalysis?: TemplateAnalysis
): string {
  const sections: string[] = []

  // 1. Formatting rules
  sections.push(getLongTextInstruction(longTextStrategy))

  // 2. Critical rules
  sections.push(getCriticalRules())

  // 3. Summary slide (always included)
  sections.push(buildSummarySlide(fetchedData))

  // 4. Project slides - use mapping if template analysis is available
  if (templateAnalysis && templateAnalysis.slides && templateAnalysis.slides.length > 0) {
    console.log(`[buildGammaContent] Using template analysis with ${templateAnalysis.slides.length} slides`)

    for (const projectData of fetchedData) {
      // Apply mapping to extract data for this project
      const mappedData = applyMappingToProject(projectData, mappingJson, templateAnalysis)

      // Build slides for this project
      sections.push(buildProjectSlides(projectData, mappedData))
    }
  } else {
    // Fallback to legacy hardcoded approach
    console.log('[buildGammaContent] No template analysis available, using legacy content builder')
    sections.push(buildLegacyContent(fetchedData, mappingJson))
  }

  // 5. Data Notes slide (missing fields)
  if (!templateAnalysis) {
    // Already included in legacy content
  } else {
    sections.push(buildDataNotesSlide(mappingJson.missing_fields || []))
  }

  return sections.join('\n')
}

async function waitForGammaGeneration(
  generationId: string,
  apiKey: string,
  baseUrl: string,
  maxAttempts = 60 // 3 minutes with 3s intervals
): Promise<{ status: string; downloadUrl?: string; gammaUrl?: string }> {
  for (let i = 0; i < maxAttempts; i++) {
    console.log(`[POLL ${i + 1}/${maxAttempts}] Checking Gamma generation ${generationId}...`)

    const response = await fetch(`${baseUrl}/generations/${generationId}`, {
      headers: {
        'X-API-KEY': apiKey,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to check generation status: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    console.log(`Gamma status: ${data.status}`)

    if (data.status === 'completed') {
      return {
        status: 'completed',
        downloadUrl: data.exportUrl || data.exports?.pptx?.url,
        gammaUrl: data.gammaUrl,
      }
    }

    if (data.status === 'failed') {
      throw new Error('Gamma generation failed')
    }

    // Wait 3 seconds before next check
    await new Promise((resolve) => setTimeout(resolve, 3000))
  }

  throw new Error('Gamma generation timed out after 3 minutes')
}

/**
 * Process a Gamma generation job.
 * This endpoint processes a job from the generation_jobs table.
 */
serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const supabase = getSupabaseClient()
    const { jobId } = await req.json()

    if (!jobId) {
      throw new Error('jobId is required')
    }

    // Get the job
    const { data: job, error: jobError } = await supabase
      .from('generation_jobs')
      .select('*')
      .eq('id', jobId)
      .single()

    if (jobError || !job) {
      throw new Error('Job not found')
    }

    if (job.status !== 'pending') {
      return new Response(
        JSON.stringify({ success: true, message: `Job already ${job.status}` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Mark job as processing
    await supabase
      .from('generation_jobs')
      .update({ status: 'processing', started_at: new Date().toISOString() })
      .eq('id', jobId)

    // We'll save the prompt after building it

    const sessionId = job.session_id
    const inputData = job.input_data as InputData

    console.log(`[STEP 1/6] Processing Gamma job ${jobId} for session ${sessionId}`)
    console.log(`[DEBUG] Has templateAnalysis: ${!!inputData.templateAnalysis}`)
    if (inputData.templateAnalysis) {
      console.log(`[DEBUG] Template has ${inputData.templateAnalysis.slides?.length || 0} slides`)
    }

    const startTime = Date.now()

    // Get Gamma API credentials
    const gammaApiKey = Deno.env.get('GAMMA_API_KEY')
    const gammaBaseUrl = Deno.env.get('GAMMA_BASE_URL') || 'https://public-api.gamma.app/v1.0'

    if (!gammaApiKey) {
      throw new Error('Missing GAMMA_API_KEY')
    }

    // Build content for Gamma using the user-defined mapping
    const content = buildGammaContent(
      inputData.mappingJson || { slides: {}, missing_fields: [] },
      inputData.fetchedData,
      inputData.longTextStrategy,
      inputData.templateAnalysis
    )

    console.log(`[STEP 2/6] Built content: ${content.length} characters`)

    if (!content || content.length === 0) {
      throw new Error('Generated content is empty. Cannot create presentation.')
    }

    // Save the prompt to the job for debugging/auditing
    await supabase
      .from('generation_jobs')
      .update({ prompt: content })
      .eq('id', jobId)

    // Create generation via Gamma API (from-template endpoint)
    const requestBody = {
      gammaId: GAMMA_TEMPLATE_ID,
      prompt: content,
      exportAs: 'pptx',
    }

    console.log(`[STEP 3/6] Calling Gamma API from-template...`)

    const createResponse = await fetch(`${gammaBaseUrl}/generations/from-template`, {
      method: 'POST',
      headers: {
        'X-API-KEY': gammaApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    if (!createResponse.ok) {
      const errorText = await createResponse.text()
      throw new Error(`Gamma API error: ${createResponse.status} - ${errorText}`)
    }

    const createData = await createResponse.json()
    const generationId = createData.generationId || createData.id

    if (!generationId) {
      throw new Error('No generationId in Gamma API response')
    }

    console.log(`[STEP 4/6] Gamma generation started: ${generationId}, polling...`)

    // Wait for generation to complete
    const result = await waitForGammaGeneration(generationId, gammaApiKey, gammaBaseUrl)

    if (!result.downloadUrl) {
      console.error('Generation result:', JSON.stringify(result))
      throw new Error('No download URL in generation result')
    }

    const gammaTime = Date.now() - startTime
    console.log(`[STEP 5/6] Gamma completed in ${(gammaTime / 1000).toFixed(1)}s. Downloading PPTX...`)

    // Download the PPTX from Gamma
    const pptxResponse = await fetch(result.downloadUrl)
    if (!pptxResponse.ok) {
      throw new Error('Failed to download PPTX from Gamma')
    }

    const pptxBuffer = await pptxResponse.arrayBuffer()
    console.log(`Downloaded PPTX: ${(pptxBuffer.byteLength / 1024).toFixed(1)} KB`)

    // Upload to Supabase Storage
    const fileName = `${Date.now()}_report_gamma.pptx`
    const storagePath = `${sessionId}/${fileName}`

    const { error: uploadError } = await supabase.storage
      .from('outputs')
      .upload(storagePath, pptxBuffer, {
        contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      })

    if (uploadError) {
      throw new Error(`Failed to upload PPTX: ${uploadError.message}`)
    }

    console.log(`[STEP 6/6] Uploaded to storage: ${storagePath}`)

    // Get iteration count
    const { count } = await supabase
      .from('generated_reports')
      .select('*', { count: 'exact', head: true })
      .eq('session_id', sessionId)

    const iteration = (count || 0) + 1

    // Save report reference
    const { data: report, error: reportError } = await supabase
      .from('generated_reports')
      .insert({
        session_id: sessionId,
        engine: 'gamma',
        pptx_path: storagePath,
        iteration,
      })
      .select()
      .single()

    if (reportError) {
      throw new Error(`Failed to save report: ${reportError.message}`)
    }

    // Get public URL
    const { data: publicUrlData } = supabase.storage
      .from('outputs')
      .getPublicUrl(storagePath)

    // Mark job as completed with result
    await supabase
      .from('generation_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        result: {
          reportId: report.id,
          pptxUrl: publicUrlData.publicUrl,
          storagePath,
          iteration,
        },
      })
      .eq('id', jobId)

    // Update session step
    await supabase
      .from('sessions')
      .update({ current_step: 'evaluating' })
      .eq('id', sessionId)

    const totalTime = Date.now() - startTime
    console.log(`✅ Gamma job ${jobId} completed successfully in ${(totalTime / 1000).toFixed(1)}s`)

    return new Response(
      JSON.stringify({
        success: true,
        reportId: report.id,
        pptxUrl: publicUrlData.publicUrl,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('Process Gamma job error:', error)

    // Try to mark job as failed
    try {
      const supabase = getSupabaseClient()
      const { jobId } = await req.clone().json()
      if (jobId) {
        await supabase
          .from('generation_jobs')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            error: error instanceof Error ? error.message : 'Unknown error',
          })
          .eq('id', jobId)
      }
    } catch (e) {
      console.error('Failed to mark job as failed:', e)
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
