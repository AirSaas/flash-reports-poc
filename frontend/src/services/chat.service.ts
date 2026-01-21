import { invokeFunction } from '@lib/supabase'
import type { ChatResponse } from '@appTypes/api'

export async function sendChatMessage(
  sessionId: string,
  message: string
): Promise<ChatResponse> {
  return invokeFunction<ChatResponse>('chat', sessionId, { message })
}

export async function startMappingConversation(
  sessionId: string,
  templatePath: string
): Promise<ChatResponse> {
  const initialMessage = `I have uploaded a PPTX template at: ${templatePath}.
Please analyze the template structure and help me map the placeholders to AirSaas project data fields.
Start by identifying the slides and their placeholders.`

  return sendChatMessage(sessionId, initialMessage)
}
