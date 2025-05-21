// 'use server';
/**
 * @fileOverview AI moderation flow for detecting and filtering NSFW content in chats.
 *
 * - moderateText - A function that moderates text content.
 * - ModerateTextInput - The input type for the moderateText function.
 * - ModerateTextOutput - The return type for the moderateText function.
 */

'use server';

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const ModerateTextInputSchema = z.object({
  text: z.string().describe('The text to moderate.'),
});
export type ModerateTextInput = z.infer<typeof ModerateTextInputSchema>;

const ModerateTextOutputSchema = z.object({
  isSafe: z.boolean().describe('Whether the text is safe for all audiences.'),
  reason: z.string().optional().describe('The reason the text was flagged as unsafe.'),
});
export type ModerateTextOutput = z.infer<typeof ModerateTextOutputSchema>;

export async function moderateText(input: ModerateTextInput): Promise<ModerateTextOutput> {
  return moderateTextFlow(input);
}

const moderateTextPrompt = ai.definePrompt({
  name: 'moderateTextPrompt',
  input: {schema: ModerateTextInputSchema},
  output: {schema: ModerateTextOutputSchema},
  prompt: `You are an AI content moderator.  Your job is to determine whether the given text is safe for all audiences.

  Text: {{{text}}}

  Respond with a JSON object that contains two fields:
  - isSafe: true if the text is safe for all audiences, false otherwise.
  - reason: If isSafe is false, provide a brief explanation of why the text is not safe.

  If the text contains hate speech, sexually explicit content, harassment, dangerous content, or promotes civic integrity violations, it is not safe.
  `,
  config: {
    safetySettings: [
      {
        category: 'HARM_CATEGORY_HATE_SPEECH',
        threshold: 'BLOCK_ONLY_HIGH',
      },
      {
        category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
        threshold: 'BLOCK_NONE',
      },
      {
        category: 'HARM_CATEGORY_HARASSMENT',
        threshold: 'BLOCK_MEDIUM_AND_ABOVE',
      },
      {
        category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
        threshold: 'BLOCK_LOW_AND_ABOVE',
      },
      {
        category: 'HARM_CATEGORY_CIVIC_INTEGRITY',
        threshold: 'BLOCK_NONE',
      },
    ],
  },
});

const moderateTextFlow = ai.defineFlow(
  {
    name: 'moderateTextFlow',
    inputSchema: ModerateTextInputSchema,
    outputSchema: ModerateTextOutputSchema,
  },
  async input => {
    const {output} = await moderateTextPrompt(input);
    return output!;
  }
);
