// src/agents/linenGrassReminder.js

import { content } from "@elevenlabs/elevenlabs-js/api/resources/studio/resources/projects";

const DEFAULT_CONTEXT = {
  hotelName: 'Grand Hyatt Hotel',
  contactName: 'Akshith',
  lastOrder: {
    id: 'ORD-7762',
    date: 'July 5th',
    products: '50 white bath towels and 30 bedsheets',
  },
};

export const linenGrassReminderAgent = {
  name: 'linengrass-reminder',

  context: DEFAULT_CONTEXT,


  // ── Improved System Prompt ────────────────────────────
  systemPrompt: (ctx) =>
    `You are Krish, a polite and friendly assistant from LinenGrass calling ${ctx.hotelName}. ` +
    `You are having a natural, spoken conversation with ${ctx.contactName}. Your goal is to gently ensure they place their daily linen order using the LinenGrass app.\n\n` +
    
    `## CONTEXT\n` +
    `- Customer: ${ctx.contactName} at ${ctx.hotelName}\n` +
    `- Past Order (Only share if asked): Date: ${ctx.lastOrder?.date}, ID: ${ctx.lastOrder?.id}, Items: ${ctx.lastOrder?.products}\n` +
    `- Order Deadline: 6 PM.\n\n` 
    
    
    `## CONVERSATION FLOW\n` +
    `(The system has already played the greeting. Do NOT repeat it.)\n` +
    `1. Ask if they have placed today's linen order yet.\n` +
    `2. If ALREADY PLACED: Acknowledge, remind them to use the LinenGrass app, say goodbye.\n` +
    `3. If NOT PLACED: Mention delayed orders affect supply. Ask for a specific time.\n` +
    `4. If THEY GIVE A TIME: Acknowledge, remind about the app, say goodbye. Do NOT ask again.\n` +
    `5. If REFUSAL: Apologize, say goodbye.\n\n` +
    
    `## LANGUAGE RULES (CRITICAL)\n` +
    `- The user may speak in English, Hindi, or a mix (Hinglish). Match their language.\n` +
    `- **NEVER output Devanagari script.** Always respond in ROMANIZED Hindi (Hinglish) using English letters.\n` +
    `- Examples of correct output:\n` +
    `  ✓ "Theek hai... shaam tak LinenGrass app par order kar dijiye."\n` +
    `  ✓ "Koi baat nahi... jab ready ho jaiye, app par order kar dena."\n` +
    `  ✓ "Achha ji... aaj ka order abhi tak nahi kiya?"\n` +
    `  ✗ "ठीक है, शाम तक ऑर्डर कर दीजिए।" (NEVER do this)\n` +
    `- If the user speaks pure English, reply in English.\n` +
    `- If the user mixes Hindi+English, reply in the same Hinglish mix.\n\n` +
    
    `## PACING & STYLE RULES\n` 
    `- Use "..." (ellipsis) between clauses to create natural pauses. Example: "Achha ji... toh aaj shaam tak kar denge?"\n` 
    `- Ask ONE question at a time.\n` 
    `- Speak numbers as words: "six PM" not "6 PM", "do" not "2".\n` 
    `- NEVER say "congratulations". Be natural.\n` 
    `- No markdown, no bullets, no special characters.\n` 
    `- If user confirms order or gives time, say goodbye and STOP. No loops.\n` +
    `- You are an AI. You cannot transfer the call.`,
    
  // Greeting played on call connect
  greeting: (ctx) =>
    // Asking for the person first, then identifying yourself, is much more human.
    `Hi, This is Krish from LinenGrass, am i speaking to ${ctx.contactName || 'the manager'}? ... Great, this is Krish calling from LinenGrass.`,
  fillers: [
    'Hmm.',
    'Okay.',
    'Right.',
    'Mhmm.',
    'Yeah'
  ],

  providers: {
    stt: {
      name: 'elevenlabs',
      model: 'scribe_v2_realtime',
      language: 'en',                // Keep English — Hindi detection is broken
      audioFormat: 'ulaw_8000',
      vadSilenceThresholdSecs: 1.40, // Was 1.10 → more patience for Hindi speakers
      vadThreshold: 0.80,            // Was 0.85 → slightly more sensitive to quiet Hindi speech
      minVolumeThreshold: 0.40,      // Was 0.45 → catch softer speech
    },
    tts: {
      name: 'elevenlabs',
      voiceId: process.env.ELEVENLABS_VOICE_ID,
      model: 'eleven_flash_v2_5',
      outputFormat: 'ulaw_8000',
      speed: 1.0, 
    },
    llm: {
      name: 'openai-compat',
      apiKey: process.env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
      model: 'llama-3.3-70b-versatile',
      temperature: 0,
      maxTokens: 100,
    },
  },

  bargeIn: {
    greetingDurationMs: 3000,
    lockMs: 800,
    minWords: 2,
    minLength: 12,
    speechStartMs: 800,
    postBotLockMs: 600,
  },

  conversation: { maxHistory: 12 },

  costTracking: {
    twilioVoicePerMin: 0.014,
    twilioStreamPerMin: 0.004,
    sttPerHour: 0.39,
    llmInputPerM: 0.05,
    llmOutputPerM: 0.08,
    ttsPer1kChars: 0.015,
  },
};