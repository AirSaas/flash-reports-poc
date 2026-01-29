import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Anthropic from "npm:@anthropic-ai/sdk"
import { corsHeaders, handleCors } from "../_shared/cors.ts"
import { getSupabaseClient } from "../_shared/supabase.ts"
import { compressProjectData, estimateTokens } from "../_shared/anthropic.ts"

/**
 * Applies the user's long text strategy to the data before sending to Claude
 */
function applyLongTextStrategy(
  data: Record<string, unknown>[],
  strategy: string | null
): Record<string, unknown>[] {
  const longTextFields = ['description', 'content', 'body', 'notes', 'comment', 'summary', 'details', 'text']

  function processValue(value: unknown, depth = 0): unknown {
    if (depth > 5) return value

    if (typeof value === 'string' && value.length > 100) {
      switch (strategy) {
        case 'summarize':
          return value.length > 300 ? value.substring(0, 300) + ' [to be summarized]' : value
        case 'ellipsis':
          return value.substring(0, 100) + '...'
        case 'omit':
          return value.length > 200 ? '[long text omitted]' : value
        default:
          return value.length > 200 ? value.substring(0, 200) + '...' : value
      }
    }

    if (Array.isArray(value)) {
      return value.slice(0, 20).map(item => processValue(item, depth + 1))
    }

    if (typeof value === 'object' && value !== null) {
      const result: Record<string, unknown> = {}
      for (const [key, val] of Object.entries(value)) {
        if (longTextFields.includes(key) && typeof val === 'string') {
          result[key] = processValue(val, depth + 1)
        } else {
          result[key] = processValue(val, depth + 1)
        }
      }
      return result
    }

    return value
  }

  return data.map(project => processValue(project) as Record<string, unknown>)
}

function buildPromptFromMapping(
  mappingJson: Record<string, unknown>,
  fetchedData: Record<string, unknown>[],
  longTextStrategy: string | null
): string {
  let strategyInstructions = ''

  switch (longTextStrategy) {
    case 'summarize':
      strategyInstructions = 'Summarize long texts to a maximum of 2 sentences'
      break
    case 'ellipsis':
      strategyInstructions = 'Truncate long texts with "..." after 100 characters'
      break
    case 'omit':
      strategyInstructions = 'Omit fields with very long texts'
      break
    default:
      strategyInstructions = 'Keep texts at reasonable length for slides'
  }

  // Detect new template-based format vs legacy slide-based format
  const slides = mappingJson.slides as Record<string, Record<string, unknown>> | undefined
  const hasTemplates = slides && Object.keys(slides).some(k => k.startsWith('template_'))

  let structureSection = ''
  if (hasTemplates) {
    structureSection = `## Slide Templates (deduplicated)

The mapping uses deduplicated slide templates. Each template key (e.g., "template_project_card") has a \`_meta\` field:
- \`_meta.type = "per_project"\`: This slide layout is repeated for EACH project. Create one instance per project.
- \`_meta.type = "global"\`: This slide appears only once in the presentation.

${JSON.stringify(mappingJson, null, 2)}

## Required Slide Order
Build the PPTX in this exact order:
1. Global slides that come first (title page, table of contents) — one instance each
2. **For each project in the data array**, create ALL per_project slides in sequence:
   - Project A: template_1 → template_2 → ...
   - Project B: template_1 → template_2 → ...
   - (Group all slides for one project together before moving to the next)
3. Global slides that come last (summary, closing) — one instance each
4. Final slide listing any fields that could not be populated`
  } else {
    structureSection = `## Field Mapping
${JSON.stringify(mappingJson, null, 2)}

## Required Structure
1. Summary slide with a list of all projects and their status/mood
2. For each project: slides according to the mapping (Card, Progress, Planning)
3. Final slide listing fields that could not be populated`
  }

  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })

  return `Generate a PowerPoint presentation for the project portfolio with the following data:

## Project Data
${JSON.stringify(fetchedData, null, 2)}

## Special Values
- current_date: ${today}
Any field mapped to "current_date" should use the value above.

${structureSection}

## Long Text Strategy
${strategyInstructions}

## Design Guidelines
- Use a professional, clean design
- Use consistent colors for status indicators:
  - Green: completed/sunny/low risk
  - Yellow: in progress/cloudy/medium risk
  - Red: delayed/stormy/high risk
- Include project names clearly on each slide
- Use tables for budget and effort data
- Use timelines or Gantt-style visuals for milestones

Generate the PPTX file now.`
}

/**
 * Process a PPTX generation job.
 * This endpoint processes a job from the generation_jobs table.
 * It's designed to be called by a worker/cron or triggered after job creation.
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

    const sessionId = job.session_id
    const inputData = job.input_data as {
      mappingJson: Record<string, unknown>
      longTextStrategy: string | null
      fetchedData: Record<string, unknown>[]
    }

    console.log(`Processing job ${jobId} for session ${sessionId}`)

    // Apply long text strategy
    let dataForPrompt = applyLongTextStrategy(inputData.fetchedData, inputData.longTextStrategy)
    console.log(`After applying strategy: ${estimateTokens(dataForPrompt)} tokens`)

    // Compress data aggressively to fit within timeout limits
    // Claude PPTX Skill with 42k tokens was timing out (>150s)
    // Target: ~15k tokens for data to keep total prompt under 20k
    const MAX_DATA_TOKENS = 12000

    // First pass: aggressive compression (50 char limit for strings)
    dataForPrompt = compressProjectData(dataForPrompt, 50)
    let compressedTokens = estimateTokens(dataForPrompt)
    console.log(`After compression (50 char): ${compressedTokens} tokens`)

    // If still too large, compress more aggressively
    if (compressedTokens > MAX_DATA_TOKENS) {
      dataForPrompt = compressProjectData(dataForPrompt, 30)
      compressedTokens = estimateTokens(dataForPrompt)
      console.log(`After compression (30 char): ${compressedTokens} tokens`)
    }

    // If still too large, limit number of projects
    if (compressedTokens > MAX_DATA_TOKENS) {
      const ratio = MAX_DATA_TOKENS / compressedTokens
      const maxProjects = Math.max(3, Math.floor(ratio * dataForPrompt.length))
      dataForPrompt = dataForPrompt.slice(0, maxProjects)
      compressedTokens = estimateTokens(dataForPrompt)
      console.log(`After limiting to ${maxProjects} projects: ${compressedTokens} tokens`)
    }

    // Final safety check - hard limit to 5 projects if still too large
    if (compressedTokens > 15000) {
      dataForPrompt = dataForPrompt.slice(0, 4)
      compressedTokens = estimateTokens(dataForPrompt)
      console.log(`Final safety limit (4 projects): ${compressedTokens} tokens`)
    }

    // Initialize Anthropic client
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) {
      throw new Error('Missing ANTHROPIC_API_KEY')
    }

    const client = new Anthropic({ apiKey })

    // Build prompt
    const prompt = buildPromptFromMapping(
      inputData.mappingJson || {},
      dataForPrompt,
      inputData.longTextStrategy
    )

    console.log(`Final prompt tokens estimate: ${estimateTokens(prompt)}`)
    console.log(`[STEP 1/6] Calling Claude API with PPTX Skill...`)

    const startTime = Date.now()

    // Call Claude with PPTX Skill
    const response = await client.beta.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 16384,
      betas: ["code-execution-2025-08-25", "skills-2025-10-02"],
      container: {
        skills: [
          {
            type: "anthropic",
            skill_id: "pptx",
            version: "latest",
          },
        ],
      },
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      tools: [
        {
          type: "code_execution_20250825",
          name: "code_execution",
        },
      ],
    })

    const claudeTime = Date.now() - startTime
    console.log(`[STEP 2/6] Claude API responded in ${claudeTime}ms (${(claudeTime / 1000).toFixed(1)}s)`)
    console.log(`Claude response stop_reason: ${response.stop_reason}`)

    // Extract file_id
    let fileId: string | null = null

    for (const block of response.content) {
      if (block.type === 'file') {
        fileId = (block as { type: 'file'; file_id: string }).file_id
        break
      }

      if (block.type === 'tool_use' && (block as { name?: string }).name === 'code_execution') {
        const toolBlock = block as { content?: Array<{ type: string; file_id?: string }> }
        if (toolBlock.content) {
          for (const resultBlock of toolBlock.content) {
            if (resultBlock.file_id) {
              fileId = resultBlock.file_id
              break
            }
          }
        }
      }

      if (block.type === 'tool_result') {
        const resultBlock = block as { content?: Array<{ type: string; file_id?: string }> }
        if (resultBlock.content) {
          for (const item of resultBlock.content) {
            if (item.file_id) {
              fileId = item.file_id
              break
            }
          }
        }
      }

      if (fileId) break
    }

    if (!fileId) {
      console.error('No file_id found in response. Content blocks:', JSON.stringify(response.content.map(b => b.type)))
      throw new Error('No PPTX file generated - could not find file_id in response')
    }

    console.log(`[STEP 3/6] Found file_id: ${fileId}, downloading from Anthropic...`)

    // Download file from Anthropic Files API
    const fileResponse = await client.beta.files.content(fileId, {
      betas: ["files-api-2025-04-14"],
    })
    const fileBuffer = await fileResponse.arrayBuffer()

    console.log(`[STEP 4/6] Downloaded file (${(fileBuffer.byteLength / 1024).toFixed(1)} KB), uploading to Supabase Storage...`)

    // Upload to Supabase Storage
    const fileName = `${Date.now()}_report.pptx`
    const storagePath = `${sessionId}/${fileName}`

    const { error: uploadError } = await supabase.storage
      .from('outputs')
      .upload(storagePath, fileBuffer, {
        contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      })

    if (uploadError) {
      throw new Error(`Failed to upload PPTX: ${uploadError.message}`)
    }

    console.log(`[STEP 5/6] Uploaded to storage: ${storagePath}, saving report record...`)

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
        engine: 'claude-pptx',
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

    console.log(`[STEP 6/6] Marking job as completed...`)

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
    console.log(`✅ Job ${jobId} completed successfully in ${(totalTime / 1000).toFixed(1)}s`)

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
    console.error('Process PPTX job error:', error)

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
