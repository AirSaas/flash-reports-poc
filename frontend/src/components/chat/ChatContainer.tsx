import { useEffect, useRef } from 'react'
import type { ChatMessage as ChatMessageType } from '@appTypes/index'
import { ChatMessage } from './ChatMessage'
import { ChatInput } from './ChatInput'
import { TypingIndicator } from './TypingIndicator'

interface ChatContainerProps {
  messages: ChatMessageType[]
  loading: boolean
  error: string | null
  onSendMessage: (content: string) => void
  disabled?: boolean
}

export function ChatContainer({
  messages,
  loading,
  error,
  onSendMessage,
  disabled = false,
}: ChatContainerProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message, index) => (
          <ChatMessage key={index} message={message} />
        ))}
        {loading && <TypingIndicator />}
        {error && (
          <div className="text-red-600 text-sm p-2 bg-red-50 rounded-lg">
            Error: {error}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <div className="border-t border-gray-200 p-4">
        <ChatInput
          onSend={onSendMessage}
          disabled={disabled || loading}
          placeholder={disabled ? 'Mapping complete!' : 'Type your message...'}
        />
      </div>
    </div>
  )
}
