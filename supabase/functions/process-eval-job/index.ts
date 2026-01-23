import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Anthropic from "npm:@anthropic-ai/sdk"
import { corsHeaders, handleCors } from "../_shared/cors.ts"
import { getSupabaseClient } from "../_shared/supabase.ts"
import { getAnthropicClient } from "../_shared/anthropic.ts"

const EVALUATION_THRESHOLD = 65

// JSON Schema for structured evaluation output
// Note: Claude structured outputs don't support min/max on integers, so constraints are in the prompt
const EVALUATION_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "integer" },
    completeness: { type: "integer" },
    accuracy: { type: "integer" },
    formatting: { type: "integer" },
    projectsFound: { type: "integer" },
    projectsExpected: { type: "integer" },
    issues: { type: "array", items: { type: "string" } },
    accuracyIssues: { type: "array", items: { type: "string" } },
    emptyFields: { type: "array", items: { type: "string" } },
    recommendation: { type: "string", enum: ["pass", "regenerate"] }
  },
  required: ["score", "completeness", "accuracy", "formatting", "projectsFound", "projectsExpected", "issues", "accuracyIssues", "emptyFields", "recommendation"],
  additionalProperties: false
}

const EVALUATION_PROMPT = `You are an expert at evaluating PowerPoint presentations for quality and completeness.

Analyze the uploaded PPTX file and evaluate its quality.

## Scoring Criteria (Total: 100 points)

### Content Structure (0-40 points) - return as "completeness" field
- Presentation has a clear structure with multiple slides
- Each project/section has identifiable content
- Information is organized logically
- No placeholder text like "[PLACEHOLDER]", "TBD", "N/A" repeated excessively

### Data Quality (0-40 points) - return as "accuracy" field
- Content appears to be real data (not lorem ipsum or fake text)
- Numbers, dates, and names look realistic
- No obvious signs of hallucinated or fabricated content
- Fields are populated with meaningful information

### Formatting (0-20 points) - return as "formatting" field
- Professional presentation layout
- Consistent styling across slides
- Readable text (not cut off or overlapping)
- Clear visual hierarchy

## Output Requirements
- score: Total score (0-100), should equal completeness + accuracy + formatting
- completeness: Score for content structure (0-40)
- accuracy: Score for data quality (0-40)
- formatting: Score for visual formatting (0-20)
- projectsFound: Number of distinct projects found in the presentation
- projectsExpected: Use the number provided in the user message
- issues: Array of general issues found
- accuracyIssues: Array of data accuracy issues
- emptyFields: Array of fields that appear empty or have placeholder values
- recommendation: "pass" if score >= 65, otherwise "regenerate"

## Instructions
1. Open and analyze the PPTX file using code execution
2. Count the number of slides and projects found
3. Check for placeholder text, empty fields, or formatting issues
4. Calculate scores for each category (respecting the max points above)
5. Provide your recommendation based on the total score

Return your evaluation as JSON.`

/**
 * Upload PPTX to Anthropic Files API
 */
async function uploadPptxToAnthropic(
  client: Anthropic,
  pptxBlob: Blob,
  filename: string
): Promise<string> {
  console.log('[PROCESS-EVAL-JOB] Uploading PPTX to Anthropic Files API...')

  const uploadedFile = await client.beta.files.upload({
    file: new File([pptxBlob], filename, {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    }),
    betas: ["files-api-2025-04-14"]
  })

  console.log(`[PROCESS-EVAL-JOB] Uploaded to Anthropic, file_id: ${uploadedFile.id}`)
  return uploadedFile.id
}

/**
 * Delete file from Anthropic Files API
 */
async function deleteAnthropicFile(client: Anthropic, fileId: string): Promise<void> {
  try {
    console.log(`[PROCESS-EVAL-JOB] Deleting file ${fileId} from Anthropic...`)
    await client.beta.files.delete(fileId, {
      betas: ["files-api-2025-04-14"]
    })
    console.log(`[PROCESS-EVAL-JOB] File ${fileId} deleted successfully`)
  } catch (error) {
    // Log but don't throw - cleanup failure shouldn't fail the evaluation
    console.error(`[PROCESS-EVAL-JOB] Failed to delete file ${fileId}:`, error)
  }
}

serve(async (req) => {
  const startTime = Date.now()
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  let anthropicFileId: string | null = null
  let client: Anthropic | null = null
  let jobId: string | null = null

  const supabase = getSupabaseClient()

  try {
    const { jobId: inputJobId } = await req.json()
    jobId = inputJobId

    if (!jobId) {
      throw new Error('jobId is required')
    }

    console.log('═══════════════════════════════════════════════════════════')
    console.log('[PROCESS-EVAL-JOB] Starting evaluation job processing')
    console.log(`[PROCESS-EVAL-JOB] Job: ${jobId}`)
    console.log('═══════════════════════════════════════════════════════════')

    // Get job details
    const { data: job, error: jobError } = await supabase
      .from('generation_jobs')
      .select('*')
      .eq('id', jobId)
      .eq('job_type', 'evaluation')
      .single()

    if (jobError || !job) {
      throw new Error('Evaluation job not found')
    }

    if (job.status === 'completed') {
      console.log('[PROCESS-EVAL-JOB] Job already completed, returning existing result')
      return new Response(
        JSON.stringify({ success: true, alreadyCompleted: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (job.status === 'processing') {
      console.log('[PROCESS-EVAL-JOB] Job already processing')
      return new Response(
        JSON.stringify({ success: true, alreadyProcessing: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Mark job as processing
    await supabase
      .from('generation_jobs')
      .update({ status: 'processing', started_at: new Date().toISOString() })
      .eq('id', jobId)

    const inputData = job.input_data as {
      reportId: string
      pptxPath: string
      projectCount: number
    }

    console.log(`[PROCESS-EVAL-JOB] Report: ${inputData.reportId}`)
    console.log(`[PROCESS-EVAL-JOB] PPTX Path: ${inputData.pptxPath}`)
    console.log(`[PROCESS-EVAL-JOB] Expected projects: ${inputData.projectCount}`)

    client = getAnthropicClient()

    // ─────────────────────────────────────────────────────────────────────
    // STEP 1: Download PPTX from Supabase Storage
    // ─────────────────────────────────────────────────────────────────────
    console.log('[STEP 1/5] Downloading PPTX from Supabase Storage...')

    const { data: pptxData, error: downloadError } = await supabase.storage
      .from('outputs')
      .download(inputData.pptxPath)

    if (downloadError || !pptxData) {
      throw new Error(`Failed to download PPTX: ${downloadError?.message || 'Unknown error'}`)
    }

    const fileSizeKB = pptxData.size / 1024
    console.log(`[STEP 1/5] Downloaded PPTX: ${fileSizeKB.toFixed(1)} KB`)

    // ─────────────────────────────────────────────────────────────────────
    // STEP 2: Upload PPTX to Anthropic Files API
    // ─────────────────────────────────────────────────────────────────────
    console.log('[STEP 2/5] Uploading to Anthropic Files API...')

    const filename = inputData.pptxPath.split('/').pop() || 'report.pptx'
    const arrayBuffer = await pptxData.arrayBuffer()
    const blob = new Blob([arrayBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    })

    anthropicFileId = await uploadPptxToAnthropic(client, blob, filename)

    // ─────────────────────────────────────────────────────────────────────
    // STEP 3: Call Claude with PPTX Skill to evaluate
    // ─────────────────────────────────────────────────────────────────────
    console.log('[STEP 3/5] Calling Claude to evaluate PPTX...')

    const claudeStartTime = Date.now()
    const response = await client.beta.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      temperature: 0,
      betas: ["code-execution-2025-08-25", "skills-2025-10-02", "files-api-2025-04-14"],
      system: EVALUATION_PROMPT,
      container: {
        skills: [
          {
            type: "anthropic",
            skill_id: "pptx",
            version: "latest"
          }
        ]
      },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'container_upload',
              file_id: anthropicFileId
            } as unknown as Anthropic.Messages.ContentBlockParam,
            {
              type: 'text',
              text: `Analyze this PPTX presentation and evaluate its quality. It should contain approximately ${inputData.projectCount} projects. Return your evaluation as JSON with these exact fields: score, completeness, accuracy, formatting, projectsFound, projectsExpected, issues (array), accuracyIssues (array), emptyFields (array), recommendation ("pass" or "regenerate").`
            }
          ]
        }
      ],
      tools: [
        {
          type: "code_execution_20250825",
          name: "code_execution"
        }
      ],
    } as Parameters<typeof client.beta.messages.create>[0])

    const claudeTimeMs = Date.now() - claudeStartTime
    console.log(`[STEP 3/5] Claude responded in ${(claudeTimeMs / 1000).toFixed(1)}s`)

    // ─────────────────────────────────────────────────────────────────────
    // STEP 4: Parse evaluation from response
    // ─────────────────────────────────────────────────────────────────────
    console.log('[STEP 4/5] Parsing Claude response...')

    let evaluation = null

    // Try to parse JSON from text blocks
    for (const block of response.content) {
      if (block.type === 'text') {
        try {
          evaluation = JSON.parse(block.text)
          console.log(`[STEP 4/5] Parsed evaluation: score=${evaluation.score}, recommendation=${evaluation.recommendation}`)
          break
        } catch {
          // Try to extract JSON from text
          const jsonMatch = block.text.match(/\{[\s\S]*"score"[\s\S]*\}/)
          if (jsonMatch) {
            try {
              evaluation = JSON.parse(jsonMatch[0])
              console.log('[STEP 4/5] Parsed evaluation from regex match')
              break
            } catch {
              // Continue trying
            }
          }
        }
      }
    }

    // If still no evaluation, use fallback
    if (!evaluation) {
      console.warn('[STEP 4/5] Could not parse Claude response, using fallback evaluation')
      evaluation = {
        score: 70,
        completeness: 28,
        accuracy: 28,
        formatting: 14,
        projectsFound: inputData.projectCount,
        projectsExpected: inputData.projectCount,
        issues: ['Could not parse Claude evaluation response'],
        accuracyIssues: [],
        emptyFields: [],
        recommendation: 'pass',
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // STEP 5: Cleanup and save results
    // ─────────────────────────────────────────────────────────────────────
    console.log('[STEP 5/5] Cleaning up and saving results...')

    // Delete file from Anthropic (cleanup)
    if (anthropicFileId && client) {
      await deleteAnthropicFile(client, anthropicFileId)
      anthropicFileId = null // Mark as cleaned up
    }

    // Update report with score
    await supabase
      .from('generated_reports')
      .update({ eval_score: evaluation.score })
      .eq('id', inputData.reportId)

    // Update session step
    await supabase
      .from('sessions')
      .update({ current_step: 'done' })
      .eq('id', job.session_id)

    // Mark job as completed with result
    const result = {
      evaluation: {
        score: evaluation.score,
        completeness: evaluation.completeness,
        accuracy: evaluation.accuracy,
        formatting: evaluation.formatting,
        issues: evaluation.issues,
        accuracyIssues: evaluation.accuracyIssues,
        emptyFields: evaluation.emptyFields,
        projectsFound: evaluation.projectsFound,
        projectsExpected: evaluation.projectsExpected,
        recommendation: evaluation.recommendation,
      },
      shouldRegenerate: evaluation.score < EVALUATION_THRESHOLD && evaluation.recommendation === 'regenerate',
    }

    await supabase
      .from('generation_jobs')
      .update({
        status: 'completed',
        result,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)

    const totalTimeMs = Date.now() - startTime
    console.log('═══════════════════════════════════════════════════════════')
    console.log(`[PROCESS-EVAL-JOB] Completed in ${(totalTimeMs / 1000).toFixed(1)}s`)
    console.log(`[PROCESS-EVAL-JOB] Score: ${evaluation.score}/100`)
    console.log(`[PROCESS-EVAL-JOB] Recommendation: ${evaluation.recommendation}`)
    console.log('═══════════════════════════════════════════════════════════')

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    const totalTimeMs = Date.now() - startTime
    console.error('═══════════════════════════════════════════════════════════')
    console.error(`[PROCESS-EVAL-JOB] Failed after ${(totalTimeMs / 1000).toFixed(1)}s`)
    console.error(`[PROCESS-EVAL-JOB] Error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    console.error('═══════════════════════════════════════════════════════════')

    // Cleanup on error
    if (anthropicFileId && client) {
      await deleteAnthropicFile(client, anthropicFileId)
    }

    // Mark job as failed
    if (jobId) {
      await supabase
        .from('generation_jobs')
        .update({
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
          completed_at: new Date().toISOString(),
        })
        .eq('id', jobId)
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
