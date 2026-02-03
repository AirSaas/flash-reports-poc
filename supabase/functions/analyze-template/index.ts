import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import "npm:zod"
import Anthropic from "npm:@anthropic-ai/sdk"
import { corsHeaders, handleCors } from "../_shared/cors.ts"
import { getSupabaseClient, getSessionId } from "../_shared/supabase.ts"
import { getAnthropicClient } from "../_shared/anthropic.ts"

// JSON Schema for structured output — deduplicated slide templates
const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    slide_templates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          template_id: { type: "string" },
          title: { type: "string" },
          type: {
            type: "string",
            enum: ["per_project", "global"]
          },
          example_slide_numbers: {
            type: "array",
            items: { type: "integer" }
          },
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
        required: ["template_id", "title", "type", "example_slide_numbers", "fields"],
        additionalProperties: false
      }
    },
    total_unique_fields: { type: "integer" },
    total_slides_in_template: { type: "integer" },
    projects_detected: { type: "integer" },
    analysis_notes: { type: "string" }
  },
  required: ["slide_templates", "total_unique_fields", "total_slides_in_template", "projects_detected", "analysis_notes"],
  additionalProperties: false
}

const ANALYSIS_PROMPT = `You are an expert at analyzing HTML templates for project portfolio reports.

Your task is to analyze an HTML template (converted from PowerPoint) and identify UNIQUE slide layouts (templates), deduplicating repeated patterns.

## How to analyze

1. The HTML contains slides as sections with class "slide" and data-slide-number attributes
2. For each slide, examine: heading text, content structure, tables, lists, placeholder patterns
3. **Group slides by structural similarity** using these criteria:
   - Same general layout structure (same number of sections, tables, lists)
   - Same placeholder patterns (e.g., {{field}}, [field], {field}, or descriptive text like "Project Name", "Owner", "N/A", "TBD")
   - Text differs only in the data values (project names, numbers, dates) but structural labels are the same
4. For each unique layout group, identify all fields that need data

## Field Detection

Look for these patterns that indicate dynamic fields:
- Placeholder syntax: {{field}}, [field], {field}, %field%
- Descriptive labels followed by values: "Project Name: ABC Corp" → field is "project_name"
- Table cells with data: headers are field names, cells are values
- Lists with repeated structure
- Dates, percentages, currency values
- Text like "N/A", "TBD", "-", "..." which indicate missing data placeholders

## Classification

- **per_project**: A slide layout that repeats once per project. If a layout appears N times with different project data filling the same placeholders, it is per_project. Example: "Project Card", "Progress", "Planning".
- **global**: A slide that appears only once in the entire presentation. Example: title page, portfolio summary, table of contents, closing slide.

## Important

- Return ONLY unique templates, NOT every slide instance
- If 5 slides share the same layout but have different project data, that is ONE template with example_slide_numbers listing all 5
- Generate unique snake_case IDs for template_id (e.g., "project_card", "progress_slide") and for field IDs (e.g., "project_name", "budget_total")
- projects_detected: count how many distinct projects appear in the template (= number of repetitions of per_project slides)
- Be thorough with field extraction — capture every field that could be populated with data
- If a template has NO repeated slides (all unique), classify all as "global" and set projects_detected to 0`

/**
 * Download HTML template from Supabase storage URL
 */
async function downloadHtmlTemplate(
  supabase: ReturnType<typeof getSupabaseClient>,
  htmlUrl: string
): Promise<string> {
  console.log('Downloading HTML template from:', htmlUrl)

  // Extract path from URL - format: https://xxx.supabase.co/storage/v1/object/public/templates/...
  const urlParts = htmlUrl.split('/storage/v1/object/public/templates/')
  if (urlParts.length !== 2) {
    throw new Error(`Invalid HTML URL format: ${htmlUrl}`)
  }
  const storagePath = urlParts[1]

  const { data: fileData, error: downloadError } = await supabase.storage
    .from('templates')
    .download(storagePath)

  if (downloadError) {
    console.error('Download error:', JSON.stringify(downloadError))
    throw new Error(`Failed to download HTML template: ${(downloadError as Error).message || JSON.stringify(downloadError)}`)
  }

  if (!fileData) {
    throw new Error('Failed to download HTML template: No data returned')
  }

  const htmlContent = await fileData.text()
  console.log('Downloaded HTML template, size:', htmlContent.length, 'characters')

  return htmlContent
}

/**
 * Filter HTML to only include specific slides
 */
function filterSlidesByNumbers(htmlContent: string, slideNumbers: number[]): string {
  if (!slideNumbers || slideNumbers.length === 0) {
    return htmlContent
  }

  console.log('Filtering HTML to slides:', slideNumbers)

  // Parse HTML and filter slides
  // Slides are marked with data-slide-number attribute
  const slideRegex = /<section[^>]*class="slide"[^>]*data-slide-number="(\d+)"[^>]*>[\s\S]*?<\/section>/gi

  let filteredHtml = htmlContent
  const allSlides: { full: string; number: number }[] = []

  let match
  while ((match = slideRegex.exec(htmlContent)) !== null) {
    allSlides.push({
      full: match[0],
      number: parseInt(match[1], 10)
    })
  }

  // If no slides found with data-slide-number, try alternative patterns
  if (allSlides.length === 0) {
    console.log('No slides found with data-slide-number, returning full HTML')
    return htmlContent
  }

  // Filter to only requested slides
  const slidesToKeep = allSlides.filter(s => slideNumbers.includes(s.number))

  if (slidesToKeep.length === 0) {
    console.log('No matching slides found, returning full HTML')
    return htmlContent
  }

  // Rebuild HTML with only selected slides
  // Find the container and replace its content
  const containerMatch = htmlContent.match(/<div[^>]*class="slides-container"[^>]*>/i)
  if (containerMatch) {
    const containerStart = htmlContent.indexOf(containerMatch[0])
    const containerEnd = htmlContent.lastIndexOf('</div>')

    // Build new content with only selected slides
    const newSlidesContent = slidesToKeep.map(s => s.full).join('\n')

    filteredHtml = htmlContent.substring(0, containerStart + containerMatch[0].length) +
      '\n' + newSlidesContent + '\n' +
      htmlContent.substring(containerEnd)
  }

  console.log(`Filtered from ${allSlides.length} to ${slidesToKeep.length} slides`)
  return filteredHtml
}

/**
 * Legacy: Download PPTX from Supabase storage and upload to Anthropic Files API
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

const LEGACY_ANALYSIS_PROMPT = `You are an expert at analyzing PowerPoint templates for project portfolio reports.

Your task is to analyze a PPTX template and identify UNIQUE slide layouts (templates), deduplicating repeated patterns.

## How to analyze

1. Use python-pptx to inspect ALL slides
2. For each slide, extract: layout master name, number of shapes, shape types, shape positions/sizes, placeholder indices, and text content
3. **Group slides by structural similarity** using these concrete criteria:
   - Same slide layout master (slide.slide_layout.name)
   - Same number and types of shapes (e.g., 3 text boxes + 1 table)
   - Same placeholder structure (same placeholder indices and types)
   - Similar spatial arrangement (shapes in roughly the same positions)
   - Text differs only in the data values (project names, numbers, dates) but structural labels are the same
4. For each unique layout group, identify all fields that need data (placeholders like {{field}}, [field], {field}, or descriptive text like "Project Name", "Owner")

## Classification

- **per_project**: A slide layout that repeats once per project. If a layout appears N times with different project data filling the same placeholders, it is per_project. Example: "Project Card", "Progress", "Planning".
- **global**: A slide that appears only once in the entire presentation. Example: title page, portfolio summary, table of contents, closing slide.

## Important

- Return ONLY unique templates, NOT every slide instance
- If 5 slides share the same layout but have different project data, that is ONE template with example_slide_numbers listing all 5
- Generate unique snake_case IDs for template_id (e.g., "project_card", "progress_slide") and for field IDs (e.g., "project_name", "budget_total")
- projects_detected: count how many distinct projects appear in the template (= number of repetitions of per_project slides)
- Be thorough with field extraction — capture every field that could be populated with data
- If a template has NO repeated slides (all unique), classify all as "global" and set projects_detected to 0`

serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const sessionId = getSessionId(req)
    const { templatePath, uniqueSlideNumbers } = await req.json()

    if (!templatePath) {
      throw new Error('templatePath is required')
    }

    const supabase = getSupabaseClient()
    const client = getAnthropicClient()

    // Check if we have a pre-generated HTML template
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('html_template_url, template_preparation_status')
      .eq('id', sessionId)
      .single()

    if (sessionError) {
      console.log('Session not found, will use legacy PPTX analysis')
    }

    const htmlTemplateUrl = session?.html_template_url
    const preparationStatus = session?.template_preparation_status

    // OPTIMIZED PATH: Use pre-generated HTML template
    if (htmlTemplateUrl && preparationStatus === 'completed') {
      console.log('Using optimized HTML analysis path')

      // Download HTML template
      let htmlContent = await downloadHtmlTemplate(supabase, htmlTemplateUrl)

      // Filter slides if specific ones were selected
      if (uniqueSlideNumbers && uniqueSlideNumbers.length > 0) {
        htmlContent = filterSlidesByNumbers(htmlContent, uniqueSlideNumbers)
      }

      // Truncate if too large (Claude has context limits)
      const MAX_HTML_LENGTH = 100000 // ~100KB
      if (htmlContent.length > MAX_HTML_LENGTH) {
        console.log(`HTML too large (${htmlContent.length}), truncating to ${MAX_HTML_LENGTH}`)
        htmlContent = htmlContent.substring(0, MAX_HTML_LENGTH) + '\n<!-- truncated -->'
      }

      console.log('Calling Claude to analyze HTML template (no code execution)...')

      // Call Claude WITHOUT code execution - just analyze the HTML text
      const response = await client.messages.create({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 16384,
        temperature: 0,
        system: ANALYSIS_PROMPT,
        messages: [
          {
            role: 'user',
            content: uniqueSlideNumbers && uniqueSlideNumbers.length > 0
              ? `Analyze this HTML template (converted from PowerPoint). The user has selected these specific slides as unique templates: ${uniqueSlideNumbers.join(', ')}. Focus on those slides and extract their fields. Classify each as per_project or global based on context.\n\nHTML Template:\n\`\`\`html\n${htmlContent}\n\`\`\``
              : `Analyze this HTML template (converted from PowerPoint). Extract all slides and identify unique slide templates by grouping structurally similar slides. Classify each as per_project (repeats for each project) or global (appears once). Extract all fields that need data.\n\nHTML Template:\n\`\`\`html\n${htmlContent}\n\`\`\``
          }
        ],
        tools: [
          {
            name: "submit_analysis",
            description: "Submit the template analysis results",
            input_schema: ANALYSIS_SCHEMA
          }
        ],
        tool_choice: { type: "tool", name: "submit_analysis" }
      })

      console.log('Response received, extracting analysis...')
      console.log('Stop reason:', response.stop_reason)

      // Extract analysis from tool use
      let analysis = null

      for (const block of response.content) {
        if (block.type === 'tool_use' && block.name === 'submit_analysis') {
          analysis = block.input
          console.log('Successfully extracted analysis from tool use')
          break
        }
      }

      if (!analysis) {
        console.error('Failed to extract analysis. Full response:', JSON.stringify(response.content, null, 2))
        throw new Error('Failed to parse template analysis from Claude response')
      }

      // Validate the analysis structure
      if (!analysis.slide_templates) {
        console.error('Invalid analysis structure:', JSON.stringify(analysis))
        throw new Error('Invalid analysis structure: missing slide_templates array')
      }

      // Save analysis to session
      console.log('Saving analysis to session...')
      const { error: saveError } = await supabase
        .from('sessions')
        .update({
          template_analysis: analysis,
          template_path: templatePath,
          current_step: 'mapping',
          updated_at: new Date().toISOString()
        })
        .eq('id', sessionId)

      if (saveError) {
        console.error('Failed to save analysis:', saveError)
        throw new Error(`Failed to save analysis: ${saveError.message}`)
      }

      console.log('Analysis saved successfully. Unique fields:', analysis.total_unique_fields)

      return new Response(
        JSON.stringify({
          success: true,
          analysis,
          method: 'html' // Indicate which method was used
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    // LEGACY PATH: Upload PPTX to Anthropic and use code execution
    console.log('Using legacy PPTX analysis path (HTML not available)')

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

    console.log('Calling Claude to analyze template with code execution...')

    // Call Claude with code execution to analyze the PPTX file
    const response = await client.beta.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 16384,
      temperature: 0,
      betas: ["code-execution-2025-08-25", "files-api-2025-04-14", "structured-outputs-2025-11-13"],
      system: LEGACY_ANALYSIS_PROMPT,
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
              text: uniqueSlideNumbers && uniqueSlideNumbers.length > 0
                ? `Analyze this PPTX template. Use code execution to inspect the file with python-pptx. The user has indicated that the UNIQUE slide templates are slides: ${uniqueSlideNumbers.join(', ')}. Only analyze those slides and extract their fields. Classify each as per_project or global based on context. Return the deduplicated slide_templates JSON.`
                : 'Analyze this PPTX template. Use code execution to inspect the file with python-pptx. Extract all slides, shapes, and placeholder fields. Then GROUP slides by structural similarity to identify unique slide templates. Classify each as per_project (repeats for each project) or global (appears once). Return the deduplicated slide_templates JSON.'
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
        if (block.type === 'text' && (block.text.includes('"slide_templates"') || block.text.includes('"slides"'))) {
          const jsonMatch = block.text.match(/\{[\s\S]*"slide_templates"[\s\S]*\}/) ||
                            block.text.match(/\{[\s\S]*"slides"[\s\S]*\}/)
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

    // Validate the analysis structure (accept new or legacy format)
    if (!analysis.slide_templates && !analysis.slides) {
      console.error('Invalid analysis structure:', JSON.stringify(analysis))
      throw new Error('Invalid analysis structure: missing slide_templates or slides array')
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

    console.log('Analysis saved successfully. Unique fields:', analysis.total_unique_fields || analysis.total_fields)

    return new Response(
      JSON.stringify({
        success: true,
        analysis,
        anthropicFileId,
        method: 'pptx' // Indicate which method was used
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
