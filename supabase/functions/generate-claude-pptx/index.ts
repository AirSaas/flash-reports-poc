import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Anthropic from "npm:@anthropic-ai/sdk"
import { corsHeaders, handleCors } from "../_shared/cors.ts"
import { getSupabaseClient, getSessionId } from "../_shared/supabase.ts"
import { fetchAllProjectsData, compressProjectData, estimateTokens } from "../_shared/anthropic.ts"

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

  return `Generate a PowerPoint presentation for the project portfolio with the following data:

## Project Data
${JSON.stringify(fetchedData, null, 2)}

## Field Mapping
${JSON.stringify(mappingJson, null, 2)}

## Long Text Strategy
${strategyInstructions}

## Required Structure
1. Summary slide with a list of all projects and their status/mood
2. For each project: slides according to the mapping (Card, Progress, Planning)
3. Final slide listing fields that could not be populated

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

serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const sessionId = getSessionId(req)
    const supabase = getSupabaseClient()

    // Get mapping
    const { data: mapping, error: mappingError } = await supabase
      .from('mappings')
      .select('*')
      .eq('session_id', sessionId)
      .single()

    if (mappingError || !mapping) {
      throw new Error('No mapping found for session')
    }

    // Fetch AirSaas data if not already fetched
    let fetchedData = mapping.fetched_data as Record<string, unknown>[] | null
    if (!fetchedData || fetchedData.length === 0) {
      console.log('No fetched_data found, fetching from AirSaas...')
      try {
        fetchedData = await fetchAllProjectsData()
        console.log(`Fetched ${fetchedData.length} projects from AirSaas`)

        // Save fetched data
        await supabase
          .from('mappings')
          .update({ fetched_data: fetchedData })
          .eq('session_id', sessionId)
      } catch (fetchError) {
        console.error('Failed to fetch AirSaas data:', fetchError)
        throw new Error(
          `Cannot generate PPTX: failed to fetch project data. ${
            fetchError instanceof Error ? fetchError.message : 'Check AIRSAAS_API_KEY configuration.'
          }`
        )
      }
    }

    if (!fetchedData || fetchedData.length === 0) {
      throw new Error('No project data available. Please ensure AirSaas data has been fetched.')
    }

    // Compress data to reduce tokens
    console.log(`Original data tokens estimate: ${estimateTokens(fetchedData)}`)
    const compressedData = compressProjectData(fetchedData)
    const compressedTokens = estimateTokens(compressedData)
    console.log(`Compressed data tokens estimate: ${compressedTokens}`)

    // Safety check: if still too large, truncate further
    let dataForPrompt = compressedData
    if (compressedTokens > 150000) {
      console.warn('Data still too large, applying aggressive compression...')
      dataForPrompt = compressProjectData(fetchedData, 100) // Shorter text truncation

      // If still too big, limit number of projects
      if (estimateTokens(dataForPrompt) > 150000) {
        console.warn('Limiting to first 5 projects...')
        dataForPrompt = dataForPrompt.slice(0, 5)
      }
    }

    // Initialize Anthropic client
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) {
      throw new Error('Missing ANTHROPIC_API_KEY')
    }

    const client = new Anthropic({ apiKey })

    // Build prompt with compressed data
    const prompt = buildPromptFromMapping(
      mapping.mapping_json || {},
      dataForPrompt,
      mapping.long_text_strategy
    )

    console.log(`Final prompt tokens estimate: ${estimateTokens(prompt)}`)

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

    // Extract file_id from generated PPTX
    // The file can be in different places depending on response structure:
    // 1. Directly in content as a 'file' block
    // 2. Inside a 'tool_result' block from code_execution
    // 3. Inside the code_execution result content
    let fileId: string | null = null

    console.log('Response content blocks:', JSON.stringify(response.content.map(b => ({ type: b.type }))))

    for (const block of response.content) {
      // Direct file block
      if (block.type === 'file') {
        fileId = (block as { type: 'file'; file_id: string }).file_id
        console.log('Found file_id in file block:', fileId)
        break
      }

      // Tool use block (code execution result)
      if (block.type === 'tool_use' && (block as { name?: string }).name === 'code_execution') {
        const toolBlock = block as { content?: Array<{ type: string; file_id?: string }> }
        if (toolBlock.content) {
          for (const resultBlock of toolBlock.content) {
            if (resultBlock.file_id) {
              fileId = resultBlock.file_id
              console.log('Found file_id in tool_use content:', fileId)
              break
            }
          }
        }
      }

      // Tool result block
      if (block.type === 'tool_result') {
        const resultBlock = block as { content?: Array<{ type: string; file_id?: string }> }
        if (resultBlock.content) {
          for (const item of resultBlock.content) {
            if (item.file_id) {
              fileId = item.file_id
              console.log('Found file_id in tool_result:', fileId)
              break
            }
          }
        }
      }

      if (fileId) break
    }

    if (!fileId) {
      // Log full response for debugging
      console.error('No file_id found. Full response content:', JSON.stringify(response.content, null, 2))
      throw new Error('No PPTX file generated - could not find file_id in response')
    }

    // Download file from Anthropic Files API
    const fileResponse = await client.beta.files.content(fileId, {
      betas: ["files-api-2025-04-14"],
    })
    const fileBuffer = await fileResponse.arrayBuffer()

    // Upload to Supabase Storage
    const fileName = `${Date.now()}_report.pptx`
    const storagePath = `${sessionId}/${fileName}`

    const { error: uploadError } = await supabase.storage
      .from('outputs')
      .upload(storagePath, fileBuffer, {
        contentType:
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      })

    if (uploadError) {
      throw new Error(`Failed to upload PPTX: ${uploadError.message}`)
    }

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

    // Update session step
    await supabase
      .from('sessions')
      .update({ current_step: 'evaluating' })
      .eq('id', sessionId)

    // Get public URL
    const { data: publicUrlData } = supabase.storage
      .from('outputs')
      .getPublicUrl(storagePath)

    return new Response(
      JSON.stringify({
        success: true,
        reportId: report.id,
        pptxUrl: publicUrlData.publicUrl,
        storagePath,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('Generate PPTX error:', error)
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
