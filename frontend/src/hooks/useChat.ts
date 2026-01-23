import { useState, useCallback, useRef } from 'react'
import type { ChatMessage, MappingJson } from '@appTypes/index'
import type { ChatResponse } from '@appTypes/api'
import { invokeFunctionStream, StreamEvent } from '@lib/supabase'

interface UseChatReturn {
  messages: ChatMessage[]
  loading: boolean
  error: string | null
  mappingComplete: boolean
  mappingJson: MappingJson | null
  mappingId: string | null
  sendMessage: (content: string, hideUserMessage?: boolean) => Promise<ChatResponse | null>
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

  // Use ref to track the current streaming message content
  const streamingContentRef = useRef('')

  const sendMessage = useCallback(
    async (content: string, hideUserMessage = false): Promise<ChatResponse | null> => {
      // Only show user message if not hidden (for auto-triggered messages)
      if (!hideUserMessage) {
        const userMessage: ChatMessage = { role: 'user', content }
        setMessages((prev) => [...prev, userMessage])
      }

      setLoading(true)
      setError(null)
      streamingContentRef.current = ''

      // Add empty assistant message that will be updated during streaming
      setMessages((prev) => [...prev, { role: 'assistant', content: '' }])

      try {
        let finalResponse: ChatResponse | null = null

        await invokeFunctionStream(
          'chat',
          sessionId,
          { message: content },
          (event: StreamEvent) => {
            if (event.type === 'delta' && event.text) {
              // Update the streaming content
              streamingContentRef.current += event.text
              // Update the last message (assistant) with new content
              setMessages((prev) => {
                const newMessages = [...prev]
                const lastMessage = newMessages[newMessages.length - 1]
                if (lastMessage && lastMessage.role === 'assistant') {
                  lastMessage.content = streamingContentRef.current
                }
                return newMessages
              })
            } else if (event.type === 'done') {
              // Streaming complete
              finalResponse = {
                message: event.message || streamingContentRef.current,
                mappingComplete: event.mappingComplete || false,
                mappingJson: event.mappingJson as MappingJson | null,
                mappingId: event.mappingId,
              }

              if (event.mappingComplete) {
                setMappingComplete(true)
                setMappingJson(event.mappingJson as MappingJson | null)
                if (event.mappingId) {
                  setMappingId(event.mappingId)
                }
              }
            } else if (event.type === 'error') {
              setError(event.error || 'Unknown error')
            }
          }
        )

        return finalResponse
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Failed to send message'
        setError(message)
        // Remove the empty assistant message on error
        setMessages((prev) => prev.slice(0, -1))
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
    streamingContentRef.current = ''
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
