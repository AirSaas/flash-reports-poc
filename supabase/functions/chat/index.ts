import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Anthropic from "npm:@anthropic-ai/sdk"
import { corsHeaders, handleCors } from "../_shared/cors.ts"
import { getSupabaseClient, getSessionId } from "../_shared/supabase.ts"

const SYSTEM_PROMPT = `You are an expert assistant specialized in mapping PowerPoint template fields to AirSaas project data.

Your job is to:
1. Analyze the uploaded PPTX template structure (slides, placeholders, text fields)
2. Propose matches with available AirSaas API fields
3. Ask the user only when there is ambiguity
4. Generate a final mapping_json when the mapping is complete

Available AirSaas API fields per project:
- project.name (project name)
- project.short_id (short project ID like AQM-P8)
- project.description (description)
- project.status (status object with name)
- project.mood (mood object with name: sunny, cloudy, rainy, stormy)
- project.risk (risk object with name: low, medium, high)
- project.owner (owner object with first_name, last_name, email)
- project.program (program object with name)
- project.goals[] (array of goal objects)
- project.teams[] (array of team objects)
- project.milestones[] (milestones with name, due_date, status)
- project.members[] (project members)
- project.efforts[] (team efforts with planned, actual values)
- project.budget_lines[] (budget lines with name, amount)
- project.budget_values[] (budget values)
- project.attention_points[] (attention points with title, description)
- project.decisions[] (decisions with title, status)

When you propose a match, use this format:
- Template field: "X" → AirSaas field: "Y" ✓

If no match is found, indicate:
- Template field: "X" → No available match (missing)

When the mapping is COMPLETE and the user has confirmed (or you have proposed all matches), generate a JSON with this structure:
\`\`\`json
{
  "slides": {
    "slide_1": {
      "field_name": { "source": "project.name", "status": "ok" },
      "another_field": { "source": "project.mood.name", "status": "ok" }
    },
    "slide_2": {
      "field_name": { "source": "project.milestones", "status": "ok" }
    }
  },
  "missing_fields": ["field1", "field2"]
}
\`\`\`

Important:
- Be concise and propose matches directly based on the template analysis
- If the template doesn't have explicit placeholders, infer fields from the slide content
- The user will review your proposals - ask for confirmation at the end
- Generate the final JSON after the user confirms (or if they say "yes", "ok", "looks good", etc.)`

// Cache for uploaded file IDs (template path -> Anthropic file ID)
const uploadedFilesCache = new Map<string, string>()

/**
 * Download PPTX from Supabase storage and upload to Anthropic Files API
 */
async function uploadTemplateToAnthropic(
  client: Anthropic,
  supabase: ReturnType<typeof getSupabaseClient>,
  templatePath: string
): Promise<string> {
  // Check cache first
  const cachedFileId = uploadedFilesCache.get(templatePath)
  if (cachedFileId) {
    console.log('Using cached Anthropic file ID:', cachedFileId)
    return cachedFileId
  }

  console.log('Downloading template from Supabase:', templatePath)

  // First, list the files to verify the file exists
  const pathParts = templatePath.split('/')
  const folderPath = pathParts.slice(0, -1).join('/')
  const fileName = pathParts[pathParts.length - 1]

  console.log('Looking for file:', fileName, 'in folder:', folderPath)

  const { data: listData, error: listError } = await supabase.storage
    .from('templates')
    .list(folderPath)

  if (listError) {
    console.error('List error:', JSON.stringify(listError))
  } else {
    console.log('Files in folder:', listData?.map(f => f.name))
  }

  // Download from Supabase Storage
  const { data: fileData, error: downloadError } = await supabase.storage
    .from('templates')
    .download(templatePath)

  if (downloadError) {
    console.error('Download error details:', JSON.stringify(downloadError))
    console.error('Download error name:', (downloadError as Error).name)
    console.error('Download error message:', (downloadError as Error).message)
    throw new Error(`Failed to download template: ${(downloadError as Error).message || JSON.stringify(downloadError)}`)
  }

  if (!fileData) {
    throw new Error('Failed to download template: No data returned')
  }

  console.log('Downloaded template, size:', fileData.size)

  // Upload to Anthropic Files API
  const arrayBuffer = await fileData.arrayBuffer()
  const blob = new Blob([arrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  })

  // Extract filename from path
  const filename = templatePath.split('/').pop() || 'template.pptx'

  console.log('Uploading to Anthropic Files API...')

  const uploadedFile = await client.beta.files.upload({
    file: new File([blob], filename, {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    }),
    betas: ["files-api-2025-04-14"]
  })

  console.log('Uploaded to Anthropic, file ID:', uploadedFile.id)

  // Cache the file ID
  uploadedFilesCache.set(templatePath, uploadedFile.id)

  return uploadedFile.id
}

serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const sessionId = getSessionId(req)
    const { message, stream = false } = await req.json()

    if (!message) {
      throw new Error('Message is required')
    }

    const supabase = getSupabaseClient()

    // Initialize Anthropic client
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) {
      throw new Error('Missing ANTHROPIC_API_KEY')
    }
    const client = new Anthropic({ apiKey })

    // Get or create session
    let { data: session } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .single()

    if (!session) {
      const { data: newSession, error: createError } = await supabase
        .from('sessions')
        .insert({
          id: sessionId,
          current_step: 'mapping',
          chat_history: [],
        })
        .select()
        .single()

      if (createError) throw createError
      session = newSession
    }

    // Check if this is the first message with a template path
    // Match the path including the .pptx extension (capture until newline or end of message)
    const templatePathMatch = message.match(/template at: ([^\n]+\.pptx)/i)

    // If message contains template path, this is a new mapping session - reset chat history
    let chatHistory: Array<{ role: string; content: string }> = session.chat_history || []
    let isFirstMessage = chatHistory.length === 0
    let anthropicFileId: string | null = session.anthropic_file_id || null

    if (templatePathMatch) {
      // Reset chat history for new mapping session
      chatHistory = []
      isFirstMessage = true
      anthropicFileId = null // Force re-upload of the template
      console.log('New mapping session detected, resetting chat history')
    }

    // If first message with template, upload to Anthropic Files API
    if (templatePathMatch && isFirstMessage) {
      const templatePath = templatePathMatch[1].trim()
      console.log('First message with template path:', templatePath)

      try {
        anthropicFileId = await uploadTemplateToAnthropic(client, supabase, templatePath)

        // Save the file ID to session for future turns
        await supabase
          .from('sessions')
          .update({ anthropic_file_id: anthropicFileId, template_path: templatePath })
          .eq('id', sessionId)
      } catch (uploadError) {
        console.error('Failed to upload template to Anthropic:', uploadError)
        // Continue without the file - Claude will ask for description
      }
    }

    // Add user message to history
    chatHistory.push({ role: 'user', content: message })

    // Build the message content
    let messageContent: Anthropic.Messages.MessageParam['content']

    if (anthropicFileId && isFirstMessage) {
      // First message: include the file as container_upload so it's available in code execution
      messageContent = [
        {
          type: 'container_upload',
          file_id: anthropicFileId
        } as unknown as Anthropic.Messages.ContentBlockParam,
        {
          type: 'text',
          text: 'Please analyze this PPTX template file that has been uploaded. Identify all slides, their text content, and any placeholders (like {{field}}, [field], etc.). Then propose field mappings to AirSaas project data.'
        }
      ]
    } else {
      // Subsequent messages: just text
      messageContent = message
    }

    // Build messages array for API
    const apiMessages: Anthropic.Messages.MessageParam[] = []

    for (let i = 0; i < chatHistory.length; i++) {
      const msg = chatHistory[i]
      if (i === chatHistory.length - 1 && msg.role === 'user') {
        // Last user message - use the enhanced content if applicable
        apiMessages.push({
          role: 'user',
          content: messageContent
        })
      } else {
        apiMessages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content
        })
      }
    }

    console.log('Calling Claude with PPTX skill...', stream ? '(streaming)' : '(non-streaming)')

    // Streaming response
    if (stream) {
      const encoder = new TextEncoder()

      const streamResponse = new ReadableStream({
        async start(controller) {
          try {
            let assistantMessage = ''

            // Create streaming request
            const streamingResponse = await client.beta.messages.stream({
              model: "claude-sonnet-4-5-20250929",
              max_tokens: 8192,
              temperature: 0.7,
              betas: ["code-execution-2025-08-25", "skills-2025-10-02", "files-api-2025-04-14"],
              system: SYSTEM_PROMPT,
              container: {
                skills: [
                  {
                    type: "anthropic",
                    skill_id: "pptx",
                    version: "latest"
                  }
                ]
              },
              messages: apiMessages,
              tools: [
                {
                  type: "code_execution_20250825",
                  name: "code_execution"
                }
              ]
            })

            // Process stream events
            for await (const event of streamingResponse) {
              if (event.type === 'content_block_delta') {
                const delta = event.delta as { type: string; text?: string }
                if (delta.type === 'text_delta' && delta.text) {
                  assistantMessage += delta.text
                  // Send SSE event
                  const sseData = JSON.stringify({ type: 'delta', text: delta.text })
                  controller.enqueue(encoder.encode(`data: ${sseData}\n\n`))
                }
              } else if (event.type === 'message_stop') {
                // Message complete - save to database
                chatHistory.push({ role: 'assistant', content: assistantMessage })

                // Detect if mapping is complete (look for JSON in response)
                let mappingComplete = false
                let mappingJson = null
                let mappingId = null

                const jsonMatch = assistantMessage.match(/```json\n([\s\S]*?)\n```/)
                if (jsonMatch) {
                  try {
                    mappingJson = JSON.parse(jsonMatch[1])
                    if (mappingJson.slides && mappingJson.missing_fields !== undefined) {
                      mappingComplete = true
                    }
                  } catch (_e) {
                    // Not valid JSON, continue conversation
                  }
                }

                // Update session
                await supabase
                  .from('sessions')
                  .update({
                    chat_history: chatHistory,
                    current_step: mappingComplete ? 'long_text_options' : 'mapping',
                  })
                  .eq('id', sessionId)

                // If mapping is complete, save it and get the ID
                if (mappingComplete && mappingJson) {
                  const { data: mappingData, error: mappingError } = await supabase
                    .from('mappings')
                    .upsert(
                      {
                        session_id: sessionId,
                        mapping_json: mappingJson,
                        template_path: session.template_path || '',
                      },
                      { onConflict: 'session_id' }
                    )
                    .select('id')
                    .single()

                  if (!mappingError && mappingData) {
                    mappingId = mappingData.id
                  }
                }

                // Send final event with complete data
                const finalData = JSON.stringify({
                  type: 'done',
                  message: assistantMessage,
                  mappingComplete,
                  mappingJson,
                  mappingId
                })
                controller.enqueue(encoder.encode(`data: ${finalData}\n\n`))
              }
            }

            controller.close()
          } catch (error) {
            console.error('Stream error:', error)
            const errorData = JSON.stringify({
              type: 'error',
              error: error instanceof Error ? error.message : 'Unknown error'
            })
            controller.enqueue(encoder.encode(`data: ${errorData}\n\n`))
            controller.close()
          }
        }
      })

      return new Response(streamResponse, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      })
    }

    // Non-streaming response (original behavior)
    const response = await client.beta.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 8192,
      temperature: 0.7,
      betas: ["code-execution-2025-08-25", "skills-2025-10-02", "files-api-2025-04-14"],
      system: SYSTEM_PROMPT,
      container: {
        skills: [
          {
            type: "anthropic",
            skill_id: "pptx",
            version: "latest"
          }
        ]
      },
      messages: apiMessages,
      tools: [
        {
          type: "code_execution_20250825",
          name: "code_execution"
        }
      ]
    })

    // Extract text response
    let assistantMessage = ''
    for (const block of response.content) {
      if (block.type === 'text') {
        assistantMessage += block.text
      }
    }

    // Add response to history
    chatHistory.push({ role: 'assistant', content: assistantMessage })

    // Detect if mapping is complete (look for JSON in response)
    let mappingComplete = false
    let mappingJson = null
    let mappingId = null

    const jsonMatch = assistantMessage.match(/```json\n([\s\S]*?)\n```/)
    if (jsonMatch) {
      try {
        mappingJson = JSON.parse(jsonMatch[1])
        if (mappingJson.slides && mappingJson.missing_fields !== undefined) {
          mappingComplete = true
        }
      } catch (_e) {
        // Not valid JSON, continue conversation
      }
    }

    // Update session
    await supabase
      .from('sessions')
      .update({
        chat_history: chatHistory,
        current_step: mappingComplete ? 'long_text_options' : 'mapping',
      })
      .eq('id', sessionId)

    // If mapping is complete, save it and get the ID
    if (mappingComplete && mappingJson) {
      const { data: mappingData, error: mappingError } = await supabase
        .from('mappings')
        .upsert(
          {
            session_id: sessionId,
            mapping_json: mappingJson,
            template_path: session.template_path || '',
          },
          { onConflict: 'session_id' }
        )
        .select('id')
        .single()

      if (!mappingError && mappingData) {
        mappingId = mappingData.id
      }
    }

    return new Response(
      JSON.stringify({
        message: assistantMessage,
        mappingComplete,
        mappingJson,
        mappingId,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('Chat error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
