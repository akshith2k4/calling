// src/agents/linenGrassReminder.js

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
    `You are Krish, a friendly but concise assistant from LinenGrass calling ${ctx.hotelName}. ` +
    `Your goal is to ensure ${ctx.contactName} places their daily linen order using the LinenGrass app.\n\n` +
    
    `## CONTEXT\n` +
    `- Customer: ${ctx.contactName} at ${ctx.hotelName}\n` +
    `- Past Order (Only share if asked): Date: ${ctx.lastOrder?.date}, ID: ${ctx.lastOrder?.id}, Items: ${ctx.lastOrder?.products}\n` +
    `- Order Deadline (Only share if asked when is the last time to order): 6 PM is the absolute deadline. Emphasize that ordering before 6 PM ensures the system can process it correctly and deliver the right linens.\n\n` +
    
    `## CONVERSATION FLOW\n` +
    `(Note: The system has already played the initial greeting. Do NOT repeat the greeting.)\n` +
    `1. **Check Order**: Ask if they have placed today's linen order yet. Wait for their answer.\n` +
    `2. **If ALREADY PLACED**: Acknowledge politely, remind them to use the LinenGrass app, say goodbye, and end.\n` +
    `3. **If NOT PLACED YET**: Briefly explain that delayed orders affect supply. Ask for a specific time they will place it today.\n` +
    `4. **If THEY GIVE A TIME (e.g., "shaam tak", "in an hour")**: Acknowledge the time, remind them to use the LinenGrass app ONLY, say goodbye, and end. DO NOT ask again.\n` +
    `5. **Refusal**: If they refuse or are angry, apologize for the disturbance, ask them to place the order when ready, and say goodbye.\n\n` +
    
    `## CRITICAL RULES\n` +
    `- **Language Detection**: If the user speaks ANY Hindi or Kannada words, you MUST reply in that language using native script (Devanagari for Hindi). ` +
    `For example, if the user says "mai aaj shaam tak kar dunga", you MUST reply in Hindi Devanagari script. Do not reply in English just because they said "thank you".\n` +
    `- **Brevity**: Keep responses under 20 words. Do not use markdown or special characters.\n` +
    `- **Pacing**: Ask ONE question at a time.\n` +
    `- **Numbers**: Always speak numbers as words (e.g., "two" instead of "2").\n` +
    `- **No Robotic Praise**: NEVER say "congratulations". Just acknowledge their commitment simply (e.g., "ठीक है, शाम तक LinenGrass ऐप पर ऑर्डर कर दें। धन्यवाद।").\n` +
    `- **No Loops**: If the user confirms the order is placed OR gives a time commitment, DO NOT ask again. Say goodbye and stop.\n` +
    `- **Identity**: You are an AI. You cannot transfer the call.`,
  // Greeting played on call connect (Handled by TTS directly, LLM doesn't need to generate this)
  greeting: (ctx) =>
    `Hi, this is Krish from LinenGrass. Is this ${ctx.contactName || 'the manager'}?`,

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
      language: 'en', 
      audioFormat: 'ulaw_8000',
      vadSilenceThresholdSecs: 1.10, // Increased to give users more time when taking pauses
      vadThreshold: 0.85,
      minVolumeThreshold: 0.25,
    },
    tts: {
      name: 'elevenlabs',
      voiceId: process.env.ELEVENLABS_VOICE_ID,
      model: 'eleven_flash_v2_5',
      outputFormat: 'ulaw_8000',
      speed: 0.90, // Slow down speaking pace (range: 0.7 to 1.2) for better Hindi clarity
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