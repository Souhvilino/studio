
"use client";

import type { ChatMessage } from '@/types';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Languages, Loader2 } from 'lucide-react';
import { translateMessage, type TranslateMessageInput } from '@/ai/flows/real-time-translation';
import { useToast } from '@/hooks/use-toast';
import React from 'react';

interface MessageItemProps {
  message: ChatMessage;
  onTranslate: (messageId: string, textToTranslate: string, context: string) => Promise<{ translatedText: string } | { error: string }>;
  conversationContext: string; // Pass recent messages as context
}

export function MessageItem({ message, onTranslate, conversationContext }: MessageItemProps) {
  const { toast } = useToast();
  const [currentText, setCurrentText] = React.useState(message.text);
  const [isTranslating, setIsTranslating] = React.useState(false);
  const [isTranslated, setIsTranslated] = React.useState(false);

  const handleTranslate = async () => {
    setIsTranslating(true);
    try {
      const result = await onTranslate(message.id, currentText, conversationContext);
      if ('translatedText' in result) {
        setCurrentText(result.translatedText);
        setIsTranslated(true);
        toast({ title: "Message translated", description: "The message has been translated." });
      } else {
        toast({ title: "Translation Error", description: result.error, variant: "destructive" });
      }
    } catch (error) {
      console.error("Translation error:", error);
      toast({ title: "Translation Error", description: "Could not translate message.", variant: "destructive" });
    } finally {
      setIsTranslating(false);
    }
  };
  
  const handleShowOriginal = () => {
    setCurrentText(message.originalText || message.text);
    setIsTranslated(false);
  }

  return (
    <div
      className={cn(
        "flex items-start gap-3 p-3 rounded-lg shadow-sm my-2",
        message.isLocalUser ? "bg-primary/10 ml-auto flex-row-reverse" : "bg-secondary/80 mr-auto"
      )}
      style={{ maxWidth: '80%' }}
    >
      <Avatar className="h-8 w-8">
        <AvatarFallback className={cn(message.isLocalUser ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground")}>
          {message.isLocalUser ? "You" : "S"} {/* Changed "P" to "S" for Stranger */}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1">
        <p className="text-sm text-foreground whitespace-pre-wrap break-words">{currentText}</p>
        <p className="text-xs text-muted-foreground mt-1">
          {new Date(message.timestamp).toLocaleTimeString()}
        </p>
        {!message.isLocalUser && (
          <div className="mt-1">
            {isTranslated ? (
               <Button variant="link" size="sm" onClick={handleShowOriginal} className="text-xs p-0 h-auto text-accent hover:text-accent/80">
                Show Original
              </Button>
            ) : (
              <Button
                variant="link"
                size="sm"
                onClick={handleTranslate}
                disabled={isTranslating}
                className="text-xs p-0 h-auto text-accent hover:text-accent/80"
              >
                {isTranslating ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <Languages className="h-3 w-3 mr-1" />
                )}
                Translate
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

