import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Anthropic from "npm:@anthropic-ai/sdk"
import { corsHeaders, handleCors } from "../_shared/cors.ts"
import { getSupabaseClient, getSessionId } from "../_shared/supabase.ts"
import { getAnthropicClient } from "../_shared/anthropic.ts"

// Available AirSaas API fields that can be mapped
// IMPORTANT: These paths must match the actual AirSaas API response structure
const AVAILABLE_AIRSAAS_FIELDS = [
  // Basic project info
  { id: 'project.name', label: 'Project Name', description: 'The name of the project' },
  { id: 'project.short_id', label: 'Project Short ID', description: 'Short identifier like AQM-P8' },
  { id: 'project.description_text', label: 'Project Description', description: 'Project description as plain text' },
  { id: 'project.description', label: 'Project Description (Rich)', description: 'Project description with formatting' },

  // Status fields (these are strings, not objects)
  { id: 'project.status', label: 'Project Status', description: 'Current status (in_progress, finished, etc.)' },
  { id: 'project.mood', label: 'Project Mood', description: 'Mood indicator (good, complicated, blocked, etc.)' },
  { id: 'project.risk', label: 'Project Risk', description: 'Risk level (low, medium, high)' },

  // Owner info (correct field names from AirSaas)
  { id: 'project.owner.name', label: 'Owner Full Name', description: 'Project owner full name' },
  { id: 'project.owner.given_name', label: 'Owner First Name', description: 'Project owner first name' },
  { id: 'project.owner.family_name', label: 'Owner Last Name', description: 'Project owner last name' },
  { id: 'project.owner.initials', label: 'Owner Initials', description: 'Project owner initials' },

  // Dates (direct fields, not from milestones)
  { id: 'project.start_date', label: 'Start Date', description: 'Project start date' },
  { id: 'project.end_date', label: 'End Date', description: 'Project end date' },

  // Budget (direct fields)
  { id: 'project.budget_capex', label: 'Budget CAPEX', description: 'Capital expenditure budget' },
  { id: 'project.budget_opex', label: 'Budget OPEX', description: 'Operational expenditure budget' },
  { id: 'project.budget_capex_used', label: 'Budget CAPEX Used', description: 'Capital expenditure used' },
  { id: 'project.budget_opex_used', label: 'Budget OPEX Used', description: 'Operational expenditure used' },

  // Program
  { id: 'project.program.name', label: 'Program Name', description: 'Associated program name' },
  { id: 'project.program.short_id', label: 'Program ID', description: 'Program short identifier' },

  // Progress and effort
  { id: 'project.progress', label: 'Progress', description: 'Project progress percentage' },
  { id: 'project.milestone_progress', label: 'Milestone Progress', description: 'Milestone completion progress' },
  { id: 'project.effort', label: 'Planned Effort', description: 'Planned effort value' },
  { id: 'project.effort_used', label: 'Effort Used', description: 'Actual effort consumed' },

  // Arrays (from top level, not project)
  { id: 'milestones', label: 'Milestones', description: 'Array of milestones with dates and status' },
  { id: 'members', label: 'Project Members', description: 'Array of project team members' },
  { id: 'efforts', label: 'Team Efforts', description: 'Effort entries by team/period' },
  { id: 'budget_values', label: 'Budget Values', description: 'Budget value entries' },
  { id: 'attention_points', label: 'Attention Points', description: 'Items requiring attention' },
  { id: 'decisions', label: 'Decisions', description: 'Project decisions with status' },

  // Other project fields
  { id: 'project.goals', label: 'Project Goals', description: 'Array of project goals' },
  { id: 'project.teams', label: 'Project Teams', description: 'Array of associated teams' },
  { id: 'project.importance', label: 'Importance', description: 'Project importance level' },
  { id: 'project.gain_text', label: 'Expected Gains', description: 'Expected gains/benefits text' },

  // Metadata
  { id: '_metadata.name', label: 'Project Name (Meta)', description: 'Project name from metadata' },
  { id: '_metadata.short_id', label: 'Project ID (Meta)', description: 'Short ID from metadata' },

  // Skip option
  { id: 'none', label: 'No mapping (skip)', description: 'Leave this field empty' },
]

const QUESTION_PROMPT = `You are helping map PowerPoint template fields to AirSaas project data fields.

Given a template field and the available AirSaas fields, suggest the best matches.

Template field to map:
- Name: {field_name}
- Placeholder text: {placeholder_text}
- Data type expected: {data_type}
- Location in slide: {location}

Available AirSaas fields:
{available_fields}

Respond with a JSON object containing:
1. The question to ask the user (in a friendly, clear way)
2. 2-4 suggested options ordered by relevance (most relevant first)
3. Your confidence level (high, medium, low)

Format:
{
  "question": "Which data should fill the '{field_name}' field?",
  "options": [
    { "id": "project.name", "label": "Project Name", "confidence": "high" },
    { "id": "project.short_id", "label": "Project Short ID", "confidence": "medium" }
  ],
  "reasoning": "Brief explanation of why these options were suggested",
  "confidence": "high|medium|low"
}`

interface TemplateField {
  id: string
  name: string
  placeholder_text: string
  data_type: string
  location: string
}

interface MappingState {
  fields: TemplateField[]
  currentIndex: number
  mappings: Record<string, string>
}

serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const sessionId = getSessionId(req)
    const { action, answer } = await req.json()

    const supabase = getSupabaseClient()

    // Get session with template analysis
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .single()

    if (sessionError || !session) {
      throw new Error('Session not found')
    }

    const templateAnalysis = session.template_analysis
    if (!templateAnalysis || !templateAnalysis.slides) {
      throw new Error('Template analysis not found. Please analyze the template first.')
    }

    // Get or initialize mapping state
    let mappingState: MappingState = session.mapping_state || {
      fields: [],
      currentIndex: 0,
      mappings: {}
    }

    // If starting fresh, extract all fields from analysis
    if (mappingState.fields.length === 0) {
      const allFields: TemplateField[] = []
      for (const slide of templateAnalysis.slides) {
        for (const field of slide.fields || []) {
          allFields.push({
            ...field,
            slide_number: slide.slide_number
          })
        }
      }
      mappingState.fields = allFields
      mappingState.currentIndex = 0
      mappingState.mappings = {}
    }

    // Handle answer from previous question
    if (action === 'answer' && answer) {
      const currentField = mappingState.fields[mappingState.currentIndex]
      if (currentField) {
        mappingState.mappings[currentField.id] = answer
        mappingState.currentIndex++
      }
    }

    // Save updated mapping state
    await supabase
      .from('sessions')
      .update({ mapping_state: mappingState })
      .eq('id', sessionId)

    // Check if all fields have been mapped
    if (mappingState.currentIndex >= mappingState.fields.length) {
      // All done - generate final mapping JSON
      const finalMapping = {
        slides: {} as Record<string, Record<string, { source: string; status: string }>>,
        missing_fields: [] as string[]
      }

      for (const slide of templateAnalysis.slides) {
        const slideKey = `slide_${slide.slide_number}`
        finalMapping.slides[slideKey] = {}

        for (const field of slide.fields || []) {
          const mappedSource = mappingState.mappings[field.id]
          if (mappedSource && mappedSource !== 'none') {
            finalMapping.slides[slideKey][field.id] = {
              source: mappedSource,
              status: 'ok'
            }
          } else {
            finalMapping.missing_fields.push(field.id)
          }
        }
      }

      // Get fetched data from session to copy to mapping
      const fetchedProjectsData = session.fetched_projects_data as { projects?: Record<string, unknown>[] } | null
      // Save final mapping (project data is in sessions.fetched_projects_data)
      const { data: mappingData, error: mappingError } = await supabase
        .from('mappings')
        .upsert(
          {
            session_id: sessionId,
            mapping_json: finalMapping,
            template_path: session.template_path || '',
          },
          { onConflict: 'session_id' }
        )
        .select('id')
        .single()

      if (mappingError) {
        console.error('Failed to save mapping:', mappingError)
      }

      return new Response(
        JSON.stringify({
          complete: true,
          mappingJson: finalMapping,
          mappingId: mappingData?.id,
          totalFields: mappingState.fields.length,
          mappedFields: Object.keys(mappingState.mappings).filter(k => mappingState.mappings[k] !== 'none').length
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    // Get current field to ask about
    const currentField = mappingState.fields[mappingState.currentIndex]

    // Use Claude to generate smart suggestions
    const client = getAnthropicClient()

    const prompt = QUESTION_PROMPT
      .replace('{field_name}', currentField.name)
      .replace('{placeholder_text}', currentField.placeholder_text || 'N/A')
      .replace('{data_type}', currentField.data_type || 'text')
      .replace('{location}', currentField.location || 'body')
      .replace('{available_fields}', AVAILABLE_AIRSAAS_FIELDS.map(f => `- ${f.id}: ${f.label} - ${f.description}`).join('\n'))

    const response = await client.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    })

    // Extract text response
    let suggestionText = ''
    for (const block of response.content) {
      if (block.type === 'text') {
        suggestionText += block.text
      }
    }

    // Parse JSON from response
    let suggestion = null
    const jsonMatch = suggestionText.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try {
        suggestion = JSON.parse(jsonMatch[0])
      } catch {
        // Use default suggestions
      }
    }

    // Default suggestion if parsing fails
    if (!suggestion) {
      suggestion = {
        question: `Which AirSaas field should map to "${currentField.name}"?`,
        options: [
          { id: 'project.name', label: 'Project Name', confidence: 'medium' },
          { id: 'project.description', label: 'Project Description', confidence: 'medium' },
          { id: 'none', label: 'Skip this field', confidence: 'low' }
        ],
        reasoning: 'Default suggestions provided',
        confidence: 'low'
      }
    }

    // Always add the full list of available fields for custom selection
    const allOptions = AVAILABLE_AIRSAAS_FIELDS.map(f => ({
      id: f.id,
      label: f.label,
      description: f.description
    }))

    return new Response(
      JSON.stringify({
        complete: false,
        currentIndex: mappingState.currentIndex,
        totalFields: mappingState.fields.length,
        field: currentField,
        question: suggestion.question,
        suggestedOptions: suggestion.options,
        allOptions,
        reasoning: suggestion.reasoning,
        confidence: suggestion.confidence
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('Mapping question error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
