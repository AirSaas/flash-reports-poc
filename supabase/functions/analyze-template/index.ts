import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Anthropic from "npm:@anthropic-ai/sdk"
import { corsHeaders, handleCors } from "../_shared/cors.ts"
import { getSupabaseClient, getSessionId } from "../_shared/supabase.ts"
import { getAnthropicClient } from "../_shared/anthropic.ts"

// JSON Schema for structured output
const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    slides: {
      type: "array",
      items: {
        type: "object",
        properties: {
          slide_number: { type: "integer" },
          title: { type: "string" },
          fields: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                placeholder_text: { type: "string" },
                data_type: {
                  type: "string",
                  enum: ["text", "number", "date", "list", "image"]
                },
                location: {
                  type: "string",
                  enum: ["title", "subtitle", "body", "table", "chart"]
                }
              },
              required: ["id", "name", "placeholder_text", "data_type", "location"],
              additionalProperties: false
            }
          }
        },
        required: ["slide_number", "title", "fields"],
        additionalProperties: false
      }
    },
    total_fields: { type: "integer" },
    analysis_notes: { type: "string" }
  },
  required: ["slides", "total_fields", "analysis_notes"],
  additionalProperties: false
}

const ANALYSIS_PROMPT = `You are an expert at analyzing PowerPoint templates. Analyze the uploaded PPTX template and identify all placeholders and fields that need to be filled with data.

For each slide, identify:
1. The slide number and title
2. All placeholders (like {{field}}, [field], {field}, or descriptive text indicating where data should go)
3. The data type each field expects (text, number, date, list, image)
4. The location of each field (title, subtitle, body, table, chart)

Be thorough - capture every field that could be populated with data. If text appears to be a placeholder description (like "Project Name" or "Owner"), include it as a field.

Generate unique IDs for each field using snake_case format (e.g., "project_name", "budget_total").`

/**
 * Download PPTX from Supabase storage and upload to Anthropic Files API
 */
async function uploadTemplateToAnthropic(
  client: Anthropic,
  supabase: ReturnType<typeof getSupabaseClient>,
  templatePath: string
): Promise<string> {
  console.log('Downloading template from Supabase:', templatePath)

  const { data: fileData, error: downloadError } = await supabase.storage
    .from('templates')
    .download(templatePath)

  if (downloadError) {
    console.error('Download error:', JSON.stringify(downloadError))
    throw new Error(`Failed to download template: ${(downloadError as Error).message || JSON.stringify(downloadError)}`)
  }

  if (!fileData) {
    throw new Error('Failed to download template: No data returned')
  }

  console.log('Downloaded template, size:', fileData.size)

  const arrayBuffer = await fileData.arrayBuffer()
  const blob = new Blob([arrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  })

  const filename = templatePath.split('/').pop() || 'template.pptx'

  console.log('Uploading to Anthropic Files API...')

  const uploadedFile = await client.beta.files.upload({
    file: new File([blob], filename, {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    }),
    betas: ["files-api-2025-04-14"]
  })

  console.log('Uploaded to Anthropic, file ID:', uploadedFile.id)

  return uploadedFile.id
}

serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const sessionId = getSessionId(req)
    const { templatePath } = await req.json()

    if (!templatePath) {
      throw new Error('templatePath is required')
    }

    const supabase = getSupabaseClient()
    const client = getAnthropicClient()

    // Upload template to Anthropic
    const anthropicFileId = await uploadTemplateToAnthropic(client, supabase, templatePath)

    // Save file ID to session (upsert to create if not exists)
    await supabase
      .from('sessions')
      .upsert({
        id: sessionId,
        anthropic_file_id: anthropicFileId,
        template_path: templatePath,
        current_step: 'mapping'
      }, { onConflict: 'id' })

    console.log('Calling Claude to analyze template with structured outputs...')

    // Call Claude with PPTX skill and structured outputs
    // Using Haiku for faster response to avoid gateway timeout
    const response = await client.beta.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 16384,
      temperature: 0,
      betas: ["code-execution-2025-08-25", "skills-2025-10-02", "files-api-2025-04-14", "structured-outputs-2025-11-13"],
      system: ANALYSIS_PROMPT,
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
              text: 'Analyze this PPTX template and return the structured JSON with all fields that need to be populated.'
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
      output_format: {
        type: "json_schema",
        schema: ANALYSIS_SCHEMA
      }
    } as Parameters<typeof client.beta.messages.create>[0])

    console.log('Response received, extracting analysis...')
    console.log('Response content blocks:', response.content.length)
    console.log('Stop reason:', response.stop_reason)

    // With structured outputs, the response should be valid JSON in the text block
    let analysis = null

    for (const block of response.content) {
      console.log('Block type:', block.type)

      if (block.type === 'text') {
        try {
          analysis = JSON.parse(block.text)
          console.log('Successfully parsed JSON from text block')
          break
        } catch (e) {
          console.log('Failed to parse text block as JSON:', e)
          console.log('Text content (first 500 chars):', block.text.substring(0, 500))
        }
      }
    }

    // Fallback: try to extract from any text content
    if (!analysis) {
      for (const block of response.content) {
        if (block.type === 'text' && block.text.includes('"slides"')) {
          // Try to find JSON in the text
          const jsonMatch = block.text.match(/\{[\s\S]*"slides"[\s\S]*\}/)
          if (jsonMatch) {
            try {
              analysis = JSON.parse(jsonMatch[0])
              console.log('Parsed JSON from regex match')
              break
            } catch (e) {
              console.log('Regex match failed to parse:', e)
            }
          }
        }
      }
    }

    if (!analysis) {
      console.error('Failed to extract analysis. Full response:', JSON.stringify(response.content, null, 2))
      throw new Error('Failed to parse template analysis from Claude response')
    }

    // Validate the analysis structure
    if (!analysis.slides || !Array.isArray(analysis.slides)) {
      console.error('Invalid analysis structure:', JSON.stringify(analysis))
      throw new Error('Invalid analysis structure: missing slides array')
    }

    // Save analysis to session (update since we already created it above)
    console.log('Saving analysis to session...')
    const { error: saveError } = await supabase
      .from('sessions')
      .update({
        template_analysis: analysis,
        updated_at: new Date().toISOString()
      })
      .eq('id', sessionId)

    if (saveError) {
      console.error('Failed to save analysis:', saveError)
      throw new Error(`Failed to save analysis: ${saveError.message}`)
    }

    console.log('Analysis saved successfully. Total fields:', analysis.total_fields)

    return new Response(
      JSON.stringify({
        success: true,
        analysis,
        anthropicFileId,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('Analyze template error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
