// src/agents/orderStatus.js

const ORDER = {
  id: 'ORD-12345',
  status: 'Shipped',
  total: '32,990 rupees',
  items: 'Sony WH-1000XM5 and 2 USB-C cables',
  tracking: 'BD1234567890',
  eta: 'July 12 by 7 PM',
};

export const orderStatusAgent = {
  name: 'order-status',

  // Business context available to systemPrompt / greeting
  context: { order: ORDER },

  // Dynamic system prompt (receives context)
  systemPrompt: (ctx) =>
    `You are an order assistant. Order=${JSON.stringify(ctx.order)}. ` +
    `Answer in under 15 words. Never use markdown. Speak numbers as words. Be extremely direct.`,

  // Greeting played on call connect
  greeting: (ctx) =>
    `Hi, your order ${ctx.order.id} is ${ctx.order.status}, arriving ${ctx.order.eta}. What would you like to know?`,

  // Cached filler phrases to mask LLM latency
  fillers: [
    'Let me check that.',
    'One second.',
    'Okay, let me see.',
    'Sure, let me look at that.',
  ],

  // ── Provider config (swap any of these) ────────────────
  providers: {
    stt: {
      name: 'elevenlabs',
      model: 'scribe_v2_realtime',
      language: 'en',
      audioFormat: 'ulaw_8000',
      vadSilenceThresholdSecs: 1.50, // Increased to give users more time when taking pauses
      vadThreshold: 0.90,
      minVolumeThreshold: 0.25,
    },
    tts: {
      name: 'elevenlabs',
      voiceId: process.env.ELEVENLABS_VOICE_ID,
      model: 'eleven_flash_v2_5',
      outputFormat: 'ulaw_8000',
      speed: 0.90, // Slow down speaking pace (range: 0.7 to 1.2) for better clarity
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

  // ── Behaviour tuning ───────────────────────────────────
  bargeIn: {
    greetingDurationMs: 2500,
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
