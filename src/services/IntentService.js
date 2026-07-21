// src/services/IntentService.js
import OpenAI from 'openai';
import { config } from '../config.js';

export async function extractCallOutcome(transcript) {
  if (!transcript || transcript.length === 0) return { status: 'unknown' };
  
  const client = new OpenAI({
    apiKey: config.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1'
  });

  const transcriptText = transcript
    .map(m => `${m.role}: ${m.content}`)
    .join('\n');

  try {
    const response = await client.chat.completions.create({
      model: 'openai/gpt-oss-120b',
      temperature: 0,
      max_tokens: 1000,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Analyze the phone call transcript. Identify the user's final commitment regarding placing their daily linen order. 
Return ONLY a JSON object with a "status" field and a "details" field.
Status must be one of: "already_placed", "will_place_today", "no_requirement_today", "refused", "callback_requested", "busy_or_hangup", "wrong_number_or_person", "unknown".

CRITICAL CLASSIFICATION RULES:
1. Handle Hindi/Hinglish Negations: Recognize phrases like "nako aaj", "aaj nahi chahiye", "zaroorat nahi hai", or "no requirement today" as "no_requirement_today". If the customer states they do not need linens today, prioritize this classification even if they politely acknowledge the bot with "Okay" or "Yeah" at the very end.
2. Only set status to "will_place_today" or "already_placed" if the USER explicitly states, confirms, or agrees to it. 
3. DO NOT attribute deadlines or times mentioned by the bot (e.g. "6 PM") to the user unless the user explicitly names or confirms that time themselves. Never assume or hallucinate a time like "before 6 PM" if the user did not say it.
4. If the user indicates they cannot hear, cannot understand, or if the conversation ends in confusion/audio issues without any commitment, classify status as "unknown" or "busy_or_hangup".
5. If "will_place_today" or "callback_requested", extract the time/details in "details" (e.g., "evening", "1 hour", "shaam tak", "tomorrow at 10 AM"). 
6. If "no_requirement_today", set "details" to "no requirement".`
        },
        { role: 'user', content: transcriptText }
      ],
    });

    return JSON.parse(response.choices[0].message.content);
  } catch (err) {
    console.error('[IntentService] Error extracting outcome:', err);
    return { status: 'error', details: err.message };
  }
}
