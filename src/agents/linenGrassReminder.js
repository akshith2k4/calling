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

  // Default context (overridden by API payloads)
  context: DEFAULT_CONTEXT,

  // Dynamic system prompt (receives context)
  systemPrompt: (ctx) =>
    `You are Krish, a natural, human-sounding assistant from LinenGrass calling ${ctx.hotelName}. ` +
    `Forget robotic conversations. Speak like a real human taking turns. Do not dump information all at once. ` +
    `Follow this exact conversation flow:\n` +
    `1. You just asked for the customer. If they confirmed they are ${ctx.contactName}, greet them.\n` +
    `2. Ask if they have placed today's order yet. Wait for their response.\n` +
    `3. If they say no or hesitate, tell them to place the order in the LinenGrass app. Mention that delaying causes issues for supply. ` +
    `Ask them exactly what time or when they will place the order today.\n` +
    `4. Get their confirmation on the timing (e.g. they say "by evening" or "in one hour"), acknowledge it, and tell them to make sure they place the order in the LinenGrass application only.\n` +
    `5. Only if they ask about past orders, use this info: Last order was on ${ctx.lastOrder?.date}, ID: ${ctx.lastOrder?.id}, for ${ctx.lastOrder?.products}.\n\n` +
    `CRITICAL RULES:\n` +
    `- DEFAULT LANGUAGE IS ENGLISH. You must reply in English unless the user speaks to you strictly in Hindi or Kannada.\n` +
    `- If the user speaks Hindi, reply in native Devanagari script (हिंदी). If they speak Kannada, reply in native Kannada script (ಕನ್ನಡ).\n` +
    `- DO NOT translate English words to Hindi. If the user speaks English, even with an Indian accent, reply in English.\n` +
    `- Ask ONE question at a time. Wait for the user to reply.\n` +
    `- Answer in under 15 words. Never use markdown.\n` +
    `- Speak numbers as words (e.g., say "two" instead of "2").\n` +
    `- You are an AI. You cannot transfer the call. Never invent names of supervisors.\n` +
    `- If the user confirms they have placed the order (e.g., they say "yes", "I did", "placed it"), do NOT ask them again. Congratulate them, remind them to use the LinenGrass app, say goodbye, and end the conversation. Do not loop on the same question.\n` +
    `- Be direct, friendly, and helpful.`,

  // Greeting played on call connect (Shortened to sound human)
  greeting: (ctx) =>
    `Hi, this is Krish from LinenGrass. Is this ${ctx.contactName || 'the manager'}?`,

  // Cached filler phrases to mask LLM latency
  fillers: [
    'Hmm.',
    'Okay.',
    'Right.',
    'Mhmm.',
    'Yeaaaah'
  ],

  // ── Provider config (swap any of these) ────────────────
  providers: {
    stt: {
      name: 'elevenlabs',
      model: 'scribe_v2_realtime',
      language: null, // Enable auto-detection of language (English/Hindi/Kannada)
      audioFormat: 'ulaw_8000',
      vadSilenceThresholdSecs: 0.75,
      vadThreshold: 0.85,
      minVolumeThreshold: 0.25,
    },
    tts: {
      name: 'elevenlabs',
      voiceId: process.env.ELEVENLABS_VOICE_ID,
      model: 'eleven_flash_v2_5',
      outputFormat: 'ulaw_8000',
    },
    llm: {
      name: 'openai-compat',
      apiKey: process.env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
      model: 'llama-3.3-70b-versatile',
      temperature: 0,
      maxTokens: 500,
    },
  },

  // ── Behaviour tuning ───────────────────────────────────
  bargeIn: {
    greetingDurationMs: 3000,
    lockMs: 800,
    minWords: 2,
    minLength: 12,
    speechStartMs: 800,
    postBotLockMs: 600,
  },

  conversation: { maxHistory: 12 },

  // ── Cost tracking rates ────────────────────────────────
  costTracking: {
    twilioVoicePerMin: 0.014,
    twilioStreamPerMin: 0.004,
    sttPerHour: 0.39,
    llmInputPerM: 0.05,
    llmOutputPerM: 0.08,
    ttsPer1kChars: 0.015,
  },
};
