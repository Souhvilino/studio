
"use client";

import type { ChatMessage } from '@/types';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Languages, Loader2 } from 'lucide-react';
// import { translateMessage, type TranslateMessageInput } from '@/ai/flows/real-time-translation'; // Already in ChatApp
import { useToast } from '@/hooks/use-toast';
import React from 'react';

interface MessageItemProps {
  message: ChatMessage;
  onTranslate: (messageId: string, textToTranslate: string, context: string) => Promise<{ translatedText: string } | { error: string }>;
  conversationContext: string;
}

// Wrap with React.memo
export const MessageItem = React.memo(function MessageItem({ message, onTranslate, conversationContext }: MessageItemProps) {
  const { toast } = useToast();
  const [currentText, setCurrentText] = React.useState(message.text);
  const [isTranslating, setIsTranslating] = React.useState(false);
  const [isTranslated, setIsTranslated] = React.useState(false);

  // Update currentText if the message prop's text changes (e.g., from an external update)
  React.useEffect(() => {
    setCurrentText(message.text);
    // Reset translated state if original text reappears
    if (message.text === (message.originalText || message.text) && message.text !== message.translatedText) {
      setIsTranslated(false);
    } else if (message.translatedText && message.text === message.translatedText) {
      setIsTranslated(true);
    }
  }, [message.text, message.originalText, message.translatedText]);

  const handleTranslate = React.useCallback(async () => { // Wrapped with useCallback
    setIsTranslating(true);
    try {
      // Use originalText for translation if available and not already translated to current view
      const textToActuallyTranslate = (isTranslated && message.originalText) ? message.originalText : currentText;
      const result = await onTranslate(message.id, textToActuallyTranslate, conversationContext);
      
      if ('translatedText' in result) {
        // setCurrentText(result.translatedText); // Handled by prop update from ChatApp
        // setIsTranslated(true);
        toast({ title: "Message translated", description: "The message has been translated." });
      } else {
        toast({ title: "Translation Error", description: result.error, variant: "destructive" });
      }
    } catch (error) {
      console.error("Translation error in MessageItem:", error);
      toast({ title: "Translation Error", description: "Could not translate message.", variant: "destructive" });
    } finally {
      setIsTranslating(false);
    }
  }, [currentText, isTranslated, message.id, message.originalText, onTranslate, conversationContext, toast]);
  
  const handleShowOriginal = React.useCallback(() => { // Wrapped with useCallback
    if (message.originalText) {
      // setCurrentText(message.originalText); // Handled by prop update from ChatApp
      // setIsTranslated(false);
      // Request parent to revert to original text if necessary
      // This might require onTranslate to handle a "revert" action or ChatApp to manage "current view" text
      // For now, this button will just visually indicate it, actual text change relies on ChatApp's message update
       onTranslate(message.id, message.originalText, conversationContext); // This will trigger re-render if parent updates message.text
    }
  },[message.id, message.originalText, onTranslate, conversationContext]);

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
          {message.isLocalUser ? "You" : "S"}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1">
        <p className="text-sm text-foreground whitespace-pre-wrap break-words">{currentText}</p>
        <p className="text-xs text-muted-foreground mt-1">
          {new Date(message.timestamp).toLocaleTimeString()}
        </p>
        {!message.isLocalUser && message.originalText && ( // Show translate button only if original text exists
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
});

MessageItem.displayName = 'MessageItem';

