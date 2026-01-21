import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export function getSupabaseClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, supabaseKey)
}

export function getSessionId(req: Request): string {
  const sessionId = req.headers.get('x-session-id')
  if (!sessionId) {
    throw new Error('Missing session ID header')
  }
  return sessionId
}
