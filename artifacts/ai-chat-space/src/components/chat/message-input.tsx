import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Paperclip, Send, X, File as FileIcon, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface MessageInputProps {
  onSend: (content: string, file?: { name: string; content: string; isBase64: boolean }) => void;
  disabled?: boolean;
}

export function MessageInput({ onSend, disabled }: MessageInputProps) {
  const [content, setContent] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      // Return focus to input after picking a file
      setTimeout(() => textareaRef.current?.focus(), 10);
    }
    // reset so same file can be picked again if removed
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = async () => {
    if ((!content.trim() && !file) || disabled) return;

    let fileData = undefined;

    if (file) {
      const isImage = file.type.startsWith("image/");
      const reader = new FileReader();

      const readFile = new Promise<{ content: string; isBase64: boolean }>((resolve) => {
        reader.onload = (e) => {
          const result = e.target?.result as string;
          resolve({ content: result, isBase64: isImage });
        };
        if (isImage) {
          reader.readAsDataURL(file);
        } else {
          // For non-images, try to read as text. If it's binary, it might look messy but we'll extract what we can.
          reader.readAsText(file);
        }
      });

      fileData = {
        name: file.name,
        ...(await readFile),
      };
    }

    onSend(content.trim() || "What's in this file?", fileData);
    setContent("");
    setFile(null);
    
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const adjustHeight = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    setContent(el.value);
  }, []);

  return (
    <div className="relative bg-card rounded-3xl border border-border shadow-lg shadow-black/5 flex flex-col transition-all focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20">
      {file && (
        <div className="flex items-center gap-3 px-4 pt-3 pb-1">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-background border border-border text-xs text-foreground max-w-[200px] animate-in fade-in slide-in-from-bottom-2">
            {file.type.startsWith("image/") ? (
              <ImageIcon className="w-3.5 h-3.5 text-primary" />
            ) : (
              <FileIcon className="w-3.5 h-3.5 text-primary" />
            )}
            <span className="truncate font-medium">{file.name}</span>
            <button 
              onClick={() => setFile(null)}
              className="ml-1 p-0.5 rounded-full hover:bg-muted-foreground/20 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
      
      <div className="flex items-end gap-2 px-2 py-2">
        <input 
          type="file" 
          ref={fileInputRef} 
          onChange={handleFileChange} 
          className="hidden" 
          accept="image/*,.txt,.md,.pdf,.csv,.json"
        />
        
        <Button 
          type="button" 
          variant="ghost" 
          size="icon" 
          onClick={() => fileInputRef.current?.click()}
          className="mb-1 w-10 h-10 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-full flex-shrink-0 transition-colors"
          disabled={disabled}
        >
          <Paperclip className="w-5 h-5" />
        </Button>
        
        <textarea
          ref={textareaRef}
          value={content}
          onChange={adjustHeight}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything..."
          className="flex-1 max-h-[200px] min-h-[44px] w-full resize-none bg-transparent py-3 px-1 text-base outline-none placeholder:text-muted-foreground/60 scrollbar-none font-sans"
          rows={1}
          disabled={disabled}
        />
        
        <Button 
          type="button"
          size="icon"
          onClick={handleSubmit}
          disabled={(!content.trim() && !file) || disabled}
          className={cn(
            "mb-1 w-10 h-10 rounded-full flex-shrink-0 transition-all duration-300",
            content.trim() || file 
              ? "bg-primary text-primary-foreground shadow-md hover:bg-primary/90 hover:scale-105" 
              : "bg-muted text-muted-foreground"
          )}
        >
          <Send className="w-4 h-4 ml-0.5" />
        </Button>
      </div>
    </div>
  );
}
