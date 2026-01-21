import { useState, useCallback } from 'react'
import type { ChatMessage, MappingJson } from '@appTypes/index'
import type { ChatResponse } from '@appTypes/api'
import { invokeFunction } from '@lib/supabase'

interface UseChatReturn {
  messages: ChatMessage[]
  loading: boolean
  error: string | null
  mappingComplete: boolean
  mappingJson: MappingJson | null
  mappingId: string | null
  sendMessage: (content: string) => Promise<ChatResponse | null>
  clearMessages: () => void
  setInitialMessages: (messages: ChatMessage[]) => void
}

export function useChat(sessionId: string): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mappingComplete, setMappingComplete] = useState(false)
  const [mappingJson, setMappingJson] = useState<MappingJson | null>(null)
  const [mappingId, setMappingId] = useState<string | null>(null)

  const sendMessage = useCallback(
    async (content: string): Promise<ChatResponse | null> => {
      const userMessage: ChatMessage = { role: 'user', content }
      setMessages((prev) => [...prev, userMessage])
      setLoading(true)
      setError(null)

      try {
        const response = await invokeFunction<ChatResponse>('chat', sessionId, {
          message: content,
        })

        const assistantMessage: ChatMessage = {
          role: 'assistant',
          content: response.message,
        }
        setMessages((prev) => [...prev, assistantMessage])

        if (response.mappingComplete) {
          setMappingComplete(true)
          setMappingJson(response.mappingJson)
          if (response.mappingId) {
            setMappingId(response.mappingId)
          }
        }

        return response
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Failed to send message'
        setError(message)
        return null
      } finally {
        setLoading(false)
      }
    },
    [sessionId]
  )

  const clearMessages = useCallback(() => {
    setMessages([])
    setMappingComplete(false)
    setMappingJson(null)
    setMappingId(null)
    setError(null)
  }, [])

  const setInitialMessages = useCallback((initialMessages: ChatMessage[]) => {
    setMessages(initialMessages)
  }, [])

  return {
    messages,
    loading,
    error,
    mappingComplete,
    mappingJson,
    mappingId,
    sendMessage,
    clearMessages,
    setInitialMessages,
  }
}
