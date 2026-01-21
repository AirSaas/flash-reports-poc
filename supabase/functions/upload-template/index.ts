import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders, handleCors } from "../_shared/cors.ts"
import { getSupabaseClient, getSessionId } from "../_shared/supabase.ts"

serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const sessionId = getSessionId(req)
    const { templatePath } = await req.json()

    if (!templatePath) {
      throw new Error('Template path is required')
    }

    const supabase = getSupabaseClient()

    // Verify the file exists in storage
    const { data: fileData, error: fileError } = await supabase.storage
      .from('templates')
      .list(sessionId)

    if (fileError) {
      throw new Error(`Failed to verify template: ${fileError.message}`)
    }

    const fileName = templatePath.split('/').pop()
    const fileExists = fileData.some((f) => f.name === fileName)

    if (!fileExists) {
      throw new Error('Template file not found in storage')
    }

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
          current_step: 'upload_template',
          template_path: templatePath,
          chat_history: [],
        })
        .select()
        .single()

      if (createError) throw createError
      session = newSession
    } else {
      // Update existing session with template path
      await supabase
        .from('sessions')
        .update({ template_path: templatePath })
        .eq('id', sessionId)
    }

    // Create or update mapping record
    await supabase.from('mappings').upsert(
      {
        session_id: sessionId,
        template_path: templatePath,
      },
      { onConflict: 'session_id' }
    )

    return new Response(
      JSON.stringify({
        success: true,
        templatePath,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('Upload template error:', error)
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
