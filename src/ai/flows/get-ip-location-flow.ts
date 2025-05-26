'use server';
/**
 * @fileOverview A Genkit flow to get IP-based location information.
 *
 * - getIpLocation - A function that fetches location data for the server's IP.
 * - GetIpLocationInput - The input type (empty for this version).
 * - GetIpLocationOutput - The return type for the getIpLocation function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const GetIpLocationInputSchema = z.object({}).describe("Empty input for now, as it geolocates the server's IP.");
export type GetIpLocationInput = z.infer<typeof GetIpLocationInputSchema>;

const GetIpLocationOutputSchema = z.object({
  query: z.string().optional().describe('The IP address that was queried.'),
  status: z.string().optional().describe('Status of the API request (e.g., "success").'),
  country: z.string().optional().describe('Country name.'),
  countryCode: z.string().optional().describe('Two-letter country code (ISO 3166-1 alpha-2).'),
  region: z.string().optional().describe('Region/state short code (FIPS or ISO).'),
  regionName: z.string().optional().describe('Region/state name.'),
  city: z.string().optional().describe('City name.'),
  zip: z.string().optional().describe('Zip code.'),
  lat: z.number().optional().describe('Latitude.'),
  lon: z.number().optional().describe('Longitude.'),
  timezone: z.string().optional().describe('Timezone (tz database).'),
  isp: z.string().optional().describe('ISP name.'),
  org: z.string().optional().describe('Organization name.'),
  as: z.string().optional().describe('AS number and organization, separated by space (RIR).'),
  message: z.string().optional().describe('Error message if status is not "success".')
});
export type GetIpLocationOutput = z.infer<typeof GetIpLocationOutputSchema>;

export async function getIpLocation(input: GetIpLocationInput): Promise<GetIpLocationOutput> {
  return getIpLocationFlow(input);
}

const getIpLocationFlow = ai.defineFlow(
  {
    name: 'getIpLocationFlow',
    inputSchema: GetIpLocationInputSchema,
    outputSchema: GetIpLocationOutputSchema,
  },
  async (input) => {
    try {
      // NOTE: Calling without an IP will geolocate the server's IP.
      const response = await fetch('http://ip-api.com/json/');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      // Validate with Zod, though ip-api.com is fairly stable.
      // For simplicity, directly returning data. In production, add Zod parsing.
      return data as GetIpLocationOutput;
    } catch (error) {
      console.error("Error fetching IP location:", error);
      return { status: "fail", message: error instanceof Error ? error.message : "Unknown error" };
    }
  }
);
