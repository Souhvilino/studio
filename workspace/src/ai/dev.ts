import { config } from 'dotenv';
config();

import '@/ai/flows/real-time-translation.ts';
import '@/ai/flows/ai-moderation.ts';
import '@/ai/flows/get-ip-location-flow.ts'; // Added import for the new flow
