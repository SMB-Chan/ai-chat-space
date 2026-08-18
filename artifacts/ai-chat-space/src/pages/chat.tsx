import { useState, useRef, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useGetOpenaiConversation, 
  useCreateOpenaiConversation,
  getGetOpenaiConversationQueryKey,
  getListOpenaiConversationsQueryKey,
  OpenaiMessage
} from "@workspace/api-client-react";
import { MessageFeed } from "@/components/chat/message-feed";
import { MessageInput } from "@/components/chat/message-input";
import { Sparkles } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function streamMessage(
  conversationId: number, 
  content: string, 
  onChunk: (text: string) => void, 
  onDone: () => void,
  onError: (err: Error) => void
) {
  try {
    const res = await fetch(`${BASE}/api/openai/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    
    if (!res.ok) {
      throw new Error(`Failed to send message: ${res.statusText}`);
    }
    
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const parsed = JSON.parse(line.slice(6));
            if (parsed.content) onChunk(parsed.content);
            if (parsed.done) onDone();
          } catch {}
        }
      }
    }
    onDone();
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)));
  }
}

export function ChatPage() {
  const params = useParams();
  const [_, setLocation] = useLocation();
  const conversationId = params.id ? parseInt(params.id) : null;
  const queryClient = useQueryClient();
  
  const { data: conversation, isLoading, isError } = useGetOpenaiConversation(
    conversationId as number,
    { query: { enabled: !!conversationId, queryKey: getGetOpenaiConversationQueryKey(conversationId as number) } }
  );

  const createConversation = useCreateOpenaiConversation();
  
  const [streamingContent, setStreamingContent] = useState<string>("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [optimisticUserMessage, setOptimisticUserMessage] = useState<OpenaiMessage | null>(null);

  const handleSend = async (content: string, fileData?: { name: string; content: string; isBase64: boolean }) => {
    let finalContent = content;
    
    if (fileData) {
      if (fileData.isBase64) {
        finalContent = `[Image: ${fileData.name}]\n\n${fileData.content}\n\n---\n\nUser question: ${content}`;
      } else {
        finalContent = `[File: ${fileData.name}]\n\n${fileData.content}\n\n---\n\nUser question: ${content}`;
      }
    }

    let targetId = conversationId;

    // Create a new conversation if we don't have one
    if (!targetId) {
      const title = content.split(" ").slice(0, 4).join(" ") + (content.split(" ").length > 4 ? "..." : "");
      try {
        const newConv = await createConversation.mutateAsync({ data: { title: title || "New Conversation" } });
        targetId = newConv.id;
        queryClient.invalidateQueries({ queryKey: getListOpenaiConversationsQueryKey() });
        // We do not navigate yet to avoid unmounting the component during stream, or we can navigate and keep state.
        // Actually, better to navigate immediately but replace history so it doesn't break back button
        setLocation(`/conversations/${newConv.id}`, { replace: true });
      } catch (err) {
        console.error("Failed to create conversation", err);
        return;
      }
    }

    if (!targetId) return;

    // Set optimistic user message
    setOptimisticUserMessage({
      id: Date.now(),
      conversationId: targetId,
      role: "user",
      content: finalContent,
      createdAt: new Date().toISOString()
    });

    setIsStreaming(true);
    setStreamingContent("");

    streamMessage(
      targetId,
      finalContent,
      (chunk) => {
        setStreamingContent((prev) => prev + chunk);
      },
      () => {
        setIsStreaming(false);
        setOptimisticUserMessage(null);
        queryClient.invalidateQueries({ queryKey: getGetOpenaiConversationQueryKey(targetId!) });
      },
      (err) => {
        console.error("Stream error:", err);
        setIsStreaming(false);
        setOptimisticUserMessage(null);
      }
    );
  };

  const allMessages = [
    ...(conversation?.messages || []),
    ...(optimisticUserMessage ? [optimisticUserMessage] : []),
    ...(isStreaming ? [{
      id: Date.now() + 1,
      conversationId: conversationId || 0,
      role: "assistant",
      content: streamingContent,
      createdAt: new Date().toISOString()
    }] : [])
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-hidden flex flex-col">
        {!conversationId && !optimisticUserMessage ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 max-w-2xl mx-auto w-full">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-6 shadow-inner border border-primary/20">
              <Sparkles className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-3xl font-serif font-medium mb-3 text-foreground tracking-tight">
              Good evening.
            </h2>
            <p className="text-muted-foreground mb-8 text-lg max-w-md font-sans font-light">
              What are we working on tonight? Attach a document or just start typing.
            </p>
          </div>
        ) : (
          <MessageFeed 
            messages={allMessages} 
            isLoading={isLoading && !isStreaming && allMessages.length === 0} 
          />
        )}
      </div>
      
      <div className="p-4 md:p-6 bg-gradient-to-t from-background via-background to-transparent pt-10">
        <div className="max-w-3xl mx-auto">
          <MessageInput onSend={handleSend} disabled={isStreaming || createConversation.isPending} />
        </div>
      </div>
    </div>
  );
}
