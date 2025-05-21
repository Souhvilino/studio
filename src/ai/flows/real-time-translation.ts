'use server';
/**
 * @fileOverview Implements real-time translation of chat messages, considering conversation context for improved accuracy.
 *
 * - translateMessage - A function that translates a given message based on context.
 * - TranslateMessageInput - The input type for the translateMessage function.
 * - TranslateMessageOutput - The return type for the translateMessage function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const TranslateMessageInputSchema = z.object({
  text: z.string().describe('The message to translate.'),
  sourceLanguage: z.string().describe('The language of the original message.'),
  targetLanguage: z.string().describe('The desired language for the translation.'),
  context: z.string().describe('The ongoing conversation context to improve translation accuracy.'),
});
export type TranslateMessageInput = z.infer<typeof TranslateMessageInputSchema>;

const TranslateMessageOutputSchema = z.object({
  translatedText: z.string().describe('The translated message.'),
});
export type TranslateMessageOutput = z.infer<typeof TranslateMessageOutputSchema>;

export async function translateMessage(input: TranslateMessageInput): Promise<TranslateMessageOutput> {
  return translateMessageFlow(input);
}

const translateTool = ai.defineTool(
  {
    name: 'translateText',
    description: 'Translates text from a source language to a target language, using conversation context to improve translation relevance.',
    inputSchema: z.object({
      text: z.string().describe('The text to translate.'),
      sourceLanguage: z.string().describe('The language of the original text.'),
      targetLanguage: z.string().describe('The desired language for the translation.'),
      context: z.string().describe('The current conversation context.'),
    }),
    outputSchema: z.string(),
  },
  async input => {
    // In a real application, this would call the Google Translate API or another translation service.
    // For this example, we'll just return a placeholder translation.
    console.log(`Translating ${input.text} from ${input.sourceLanguage} to ${input.targetLanguage} with context: ${input.context}`);
    return `Translated to ${input.targetLanguage}: ${input.text}`;
  }
);

const translateMessagePrompt = ai.definePrompt({
  name: 'translateMessagePrompt',
  tools: [translateTool],
  input: {schema: TranslateMessageInputSchema},
  output: {schema: TranslateMessageOutputSchema},
  prompt: `You are a helpful translation assistant. The user will provide a message, the source language, the target language, and the current conversation context.

Translate the message from the source language to the target language, using the context to ensure an accurate and relevant translation. Use the translateText tool for translation.

Message: {{{text}}}
Source Language: {{{sourceLanguage}}}
Target Language: {{{targetLanguage}}}
Context: {{{context}}}
`,
});

const translateMessageFlow = ai.defineFlow(
  {
    name: 'translateMessageFlow',
    inputSchema: TranslateMessageInputSchema,
    outputSchema: TranslateMessageOutputSchema,
  },
  async input => {
    const {output} = await translateMessagePrompt(input);
    return {translatedText: output!.translatedText};
  }
);
