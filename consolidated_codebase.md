# Consolidated Codebase
Generated from: `/Users/akshith/LG/calling`

---

## File: `.env.example`

```
TWILIO_ACCOUNT_SID=ACxxx
TWILIO_AUTH_TOKEN=xxx
TWILIO_FROM_NUMBER=+16592517038
TO_NUMBER=+918341582042
DOMAIN=xxxx.ngrok-free.app
ELEVENLABS_API_KEY=eleven_xxx
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
OPENAI_API_KEY=sk-xxx
CEREBRAS_API_KEY=cbs-xxx
GROQ_API_KEY=gsk-xxx
PORT=3000

DATABASE_URL=postgres://user:pass@ep-xxx.neon.tech/dbname?sslmode=require
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx
AWS_S3_BUCKET=linengrass-recordings

```

---

## File: `package.json`

```json
{
  "name": "calling",
  "version": "1.0.0",
  "type": "module",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js",
    "call": "node src/index.js --call",
    "tunnel": "npx ngrok http 3000 --url spied-unlovable-playable.ngrok-free.dev",
    "simulate": "node src/simulate.js"
  },
  "dependencies": {
    "@aws-sdk/client-s3": "^3.1089.0",
    "@aws-sdk/s3-request-presigner": "^3.1089.0",
    "@fastify/websocket": "^8.3.1",
    "dotenv": "^16.4.5",
    "fastify": "^4.28.1",
    "openai": "^4.56.0",
    "pg": "^8.22.0",
    "twilio": "^5.2.0",
    "ws": "^8.18.0"
  }
}

```

---

## File: `tsconfig.json`

```json
{
  "compilerOptions": {
    // Environment setup & latest features
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "Preserve",
    "moduleDetection": "force",
    "jsx": "react-jsx",
    "allowJs": true,

    // Bundler mode
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,

    // Best practices
    "strict": true,
    "skipLibCheck": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,

    // Some stricter flags (disabled by default)
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noPropertyAccessFromIndexSignature": false
  }
}

```

---

## File: `src/config.js`

```javascript
// src/config.js
import 'dotenv/config';

export const config = {
  PORT: process.env.PORT || 3000,
  DOMAIN: process.env.DOMAIN,
  TO_NUMBER: process.env.TO_NUMBER,
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
  TWILIO_FROM_NUMBER: process.env.TWILIO_FROM_NUMBER,
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
  ELEVENLABS_VOICE_ID: process.env.ELEVENLABS_VOICE_ID,
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  DATABASE_URL: process.env.DATABASE_URL,
  AWS_REGION: process.env.AWS_REGION || 'us-east-1',
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
  AWS_S3_BUCKET: process.env.AWS_S3_BUCKET,
};

```

---

## File: `src/index.js`

```javascript
// src/index.js
import { config } from './config.js';
import { linenGrassReminderAgent as agent } from './agents/linenGrassReminder.js';
import { createPipelineFactory } from './core/PipelineFactory.js';
import { FillerManager } from './core/FillerManager.js';
import { ElevenLabsTTS } from './providers/tts/ElevenLabsTTS.js';
import { TwilioTelephony } from './providers/telephony/TwilioTelephony.js';
import { createServer } from './server/createServer.js';
import { makeCall } from './server/makeCall.js';

async function main() {
  // 1. Shared filler cache (pre-warmed once at startup)
  const fillers = new FillerManager({
    fillers: agent.fillers,
    prefetchFn: (text) => ElevenLabsTTS.prefetch({
      apiKey: config.ELEVENLABS_API_KEY,
      voiceId: agent.providers.tts.voiceId,
      model: agent.providers.tts.model,
      outputFormat: agent.providers.tts.outputFormat,
      text,
      speed: agent.providers.tts.speed || 1.0,
    }),
  });
  await fillers.prewarm();

  // 2. Pipeline factory (creates a fresh pipeline per call)
  const pipelineFactory = createPipelineFactory(agent, config, fillers);

  // 3. Telephony provider
  const telephony = new TwilioTelephony({
    accountSid: config.TWILIO_ACCOUNT_SID,
    authToken: config.TWILIO_AUTH_TOKEN,
    fromNumber: config.TWILIO_FROM_NUMBER,
    domain: config.DOMAIN,
    pipelineFactory,
  });

  // 4. Start server
  await createServer({ telephony, port: config.PORT });

  // 5. If invoked with --call, place an outbound call
  if (process.argv.includes('--call')) {
    await makeCall(telephony);
  }
}

main().catch(console.error);

```

---

## File: `src/simulate.js`

```javascript
// src/simulate.js
import readline from 'readline';
import dotenv from 'dotenv';
import { ConversationManager } from './core/ConversationManager.js';
import { OpenAICompatLLM } from './providers/llm/OpenAICompatLLM.js';
import { linenGrassReminderAgent } from './agents/linenGrassReminder.js';
import { orderStatusAgent } from './agents/orderStatus.js';

dotenv.config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const agents = {
  reminder: linenGrassReminderAgent,
  status: orderStatusAgent
};

async function selectAgent() {
  return new Promise((resolve) => {
    rl.question('Select agent to test (1 for linengrass-reminder, 2 for order-status) [1]: ', (answer) => {
      if (answer.trim() === '2') {
        resolve('status');
      } else {
        resolve('reminder');
      }
    });
  });
}

async function main() {
  const agentKey = await selectAgent();
  const agent = agents[agentKey];
  console.log(`\n--- Simulating Agent: ${agent.name} ---`);
  
  // Set up context
  const context = {
    hotelName: "Grand Hyatt Hotel",
    contactName: "Akshith",
    lastOrder: {
      id: "ORD-7762",
      date: "July fifth",
      products: "fifty white towels and thirty bedsheets"
    }
  };

  const systemPrompt = typeof agent.systemPrompt === 'function'
    ? agent.systemPrompt(context)
    : agent.systemPrompt;

  const conversation = new ConversationManager({
    systemPrompt,
    maxHistory: 12
  });

  const llm = new OpenAICompatLLM({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
    model: agent.llm?.model || 'llama-3.3-70b-versatile',
    temperature: agent.llm?.temperature || 0,
    maxTokens: agent.llm?.maxTokens || 100
  });

  const greetingText = typeof agent.greeting === 'function'
    ? agent.greeting(context)
    : agent.greeting;

  conversation.pushAssistant(greetingText);
  console.log(`\nBot Greeting: \x1b[32m"${greetingText}"\x1b[0m\n`);

  const promptUser = () => {
    rl.question('\nYou: ', async (userInput) => {
      const input = userInput.trim();
      if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
        console.log('Exiting simulation...');
        rl.close();
        return;
      }

      if (!input) {
        promptUser();
        return;
      }

      conversation.pushUser(input);
      process.stdout.write('Bot: \x1b[32m');

      try {
        let fullResponse = '';
        const stream = llm.stream(conversation.getMessages());
        for await (const chunk of stream) {
          process.stdout.write(chunk);
          fullResponse += chunk;
        }
        process.stdout.write('\x1b[0m\n');
        conversation.pushAssistant(fullResponse);
      } catch (err) {
        console.log(`\x1b[31m\n[Error] LLM request failed: ${err.message}\x1b[0m`);
      }

      promptUser();
    });
  };

  promptUser();
}

main();

```

---

## File: `src/core/BargeInController.js`

```javascript
// src/core/BargeInController.js

const DEFAULT_BACKCHANNELS = ['mm', 'yeah', 'okay', 'uh', 'hmm', 'ah'];

export class BargeInController {
  constructor({
    greetingDurationMs = 2500,
    lockMs = 800,
    minWords = 2,
    minLength = 12,
    speechStartMs = 800,
    postBotLockMs = 600,
    backchannels = DEFAULT_BACKCHANNELS,
  } = {}) {
    this.greetingDurationMs = greetingDurationMs;
    this.lockMs = lockMs;
    this.minWords = minWords;
    this.minLength = minLength;
    this.speechStartMs = speechStartMs;
    this.postBotLockMs = postBotLockMs;
    this.backchannels = backchannels;

    this.isGreeting = false;
    this.lockUntil = 0;
    this.lastBotFinish = 0;
    this.speechStart = 0;
  }

  lockForGreeting(durationMs) {
    this.isGreeting = true;
    setTimeout(() => { this.isGreeting = false; }, durationMs ?? this.greetingDurationMs);
  }

  onBotFinished() {
    if (this.isGreeting) this.isGreeting = false;
    this.lastBotFinish = Date.now();
    this.speechStart = 0;
  }

  /**
   * Returns true if the partial transcript should trigger a barge-in.
   * @param {string} text - partial transcript
   * @param {boolean} isSpeaking - whether the bot is currently speaking
   */
  shouldBargeIn(text, isSpeaking) {
    if (this.isGreeting) return false;
    if (!isSpeaking) return false;
    if (Date.now() < this.lockUntil) return false;
    if (Date.now() - this.lastBotFinish < this.postBotLockMs) return false;

    const now = Date.now();
    if (this.speechStart === 0 || (this.lastPartialTime && now - this.lastPartialTime > 1000)) {
      this.speechStart = now;
    }
    this.lastPartialTime = now;

    if (text.length >= this.minLength && now - this.speechStart >= this.speechStartMs) {
      const lower = text.toLowerCase().trim();
      if (this.backchannels.includes(lower)) return false;
      if (text.trim().split(/\s+/).length < this.minWords) return false;
      return true;
    }
    return false;
  }

  recordBargeIn() {
    this.lockUntil = Date.now() + this.lockMs;
    this.speechStart = 0;
  }

  resetSpeechStart() {
    this.speechStart = 0;
    this.lastPartialTime = 0;
  }
}

```

---

## File: `src/core/ConversationManager.js`

```javascript
// src/core/ConversationManager.js

export class ConversationManager {
  constructor({ systemPrompt, maxHistory = 12 }) {
    this.systemPrompt = systemPrompt;
    this.maxHistory = maxHistory;
    this.messages = [{ role: 'system', content: systemPrompt }];
  }

  pushUser(text) {
    this.messages.push({ role: 'user', content: text });
  }

  pushAssistant(text) {
    this.messages.push({ role: 'assistant', content: text });
  }

  truncate() {
    if (this.messages.length > this.maxHistory) {
      this.messages = [this.messages[0], ...this.messages.slice(-(this.maxHistory - 1))];
    }
  }

  getMessages() {
    return this.messages;
  }

  toJSON() {
    return JSON.stringify(this.messages);
  }

  reset() {
    this.messages = [{ role: 'system', content: this.systemPrompt }];
  }
}

```

---

## File: `src/core/CostTracker.js`

```javascript
// src/core/CostTracker.js

export class CostTracker {
  constructor(rates = {}) {
    this.rates = {
      twilioVoicePerMin: 0.014,
      twilioStreamPerMin: 0.004,
      sttPerHour: 0.39,
      llmInputPerM: 0.05,
      llmOutputPerM: 0.08,
      ttsPer1kChars: 0.015,
      ...rates,
    };
    this.llmInputTokens = 0;
    this.llmOutputTokens = 0;
    this.ttsChars = 0;
  }

  trackLLM(messagesJson, outputText) {
    this.llmInputTokens += Math.round(messagesJson.length / 4);
    this.llmOutputTokens += Math.round(outputText.length / 4);
    this.ttsChars += outputText.length;
  }

  report(startTime) {
    if (!startTime) return { total: 0 };
    const dur = (Date.now() - startTime) / 1000;
    const twilioVoice = (dur / 60) * this.rates.twilioVoicePerMin;
    const twilioStream = (dur / 60) * this.rates.twilioStreamPerMin;
    const stt = (dur / 3600) * this.rates.sttPerHour;
    const llmIn = this.llmInputTokens * (this.rates.llmInputPerM / 1e6);
    const llmOut = this.llmOutputTokens * (this.rates.llmOutputPerM / 1e6);
    const tts = this.ttsChars * (this.rates.ttsPer1kChars / 1000);
    const total = twilioVoice + twilioStream + stt + llmIn + llmOut + tts;

    this.totalCost = total;
    this.breakdown = {
      twilioVoice,
      twilioStream,
      stt,
      llmIn,
      llmOut,
      tts,
      total,
      duration: dur,
      llmInputTokens: this.llmInputTokens,
      llmOutputTokens: this.llmOutputTokens,
      ttsChars: this.ttsChars
    };

    console.log(`
=============================================================
                     CALL COST REPORT
=============================================================
Duration:            ${dur.toFixed(1)}s
Twilio Voice:        $${twilioVoice.toFixed(5)}
Twilio Stream:       $${twilioStream.toFixed(5)}
STT:                 $${stt.toFixed(5)}
LLM Input:           ${this.llmInputTokens} tokens  $${llmIn.toFixed(5)}
LLM Output:          ${this.llmOutputTokens} tokens  $${llmOut.toFixed(5)}
TTS:                 ${this.ttsChars} chars   $${tts.toFixed(5)}
-------------------------------------------------------------
GRAND TOTAL:         $${total.toFixed(5)}
=============================================================`);
    return this.breakdown;
  }
}

```

---

## File: `src/core/FillerManager.js`

```javascript
// src/core/FillerManager.js

export class FillerManager {
  constructor({ fillers = [], prefetchFn }) {
    this.fillers = fillers;
    this.prefetchFn = prefetchFn;
    this.cache = {};
  }

  async prewarm() {
    if (!this.fillers.length || !this.prefetchFn) return;
    console.log('[Filler Cache] Pre-warming fillers...');
    for (const text of this.fillers) {
      try {
        this.cache[text] = await this.prefetchFn(text);
        console.log(`[Filler Cache] Cached: "${text}" (${this.cache[text].length} bytes)`);
      } catch (err) {
        console.error(`[Filler Cache] Failed to cache "${text}":`, err.message);
      }
    }
  }

  getRandom(exclude) {
    if (!this.fillers || this.fillers.length === 0) return undefined;
    const available = this.fillers.filter(f => f !== exclude);
    if (available.length === 0) return this.fillers[0];
    return available[Math.floor(Math.random() * available.length)];
  }

  get(text) {
    return this.cache[text];
  }

  async prewarmText(text) {
    if (!this.prefetchFn) return;
    try {
      this.cache[text] = await this.prefetchFn(text);
      console.log(`[Filler Cache] Custom Pre-warmed: "${text}" (${this.cache[text].length} bytes)`);
    } catch (err) {
      console.error(`[Filler Cache] Failed to cache custom text "${text}":`, err.message);
    }
  }
}

```

---

## File: `src/core/PipelineFactory.js`

```javascript
// src/core/PipelineFactory.js

import { VoicePipeline } from './VoicePipeline.js';
import { CostTracker } from './CostTracker.js';

import { ElevenLabsSTT } from '../providers/stt/ElevenLabsSTT.js';
import { ElevenLabsTTS } from '../providers/tts/ElevenLabsTTS.js';
import { OpenAICompatLLM } from '../providers/llm/OpenAICompatLLM.js';

// ── Registry: add new providers here ────────────────────────
const STT_REGISTRY = {
  'elevenlabs': (cfg, env) => new ElevenLabsSTT({ apiKey: env.ELEVENLABS_API_KEY, ...cfg }),
  // 'deepgram':  (cfg, env) => new DeepgramSTT({ apiKey: env.DEEPGRAM_API_KEY, ...cfg }),
};

const TTS_REGISTRY = {
  'elevenlabs': (cfg, env) => new ElevenLabsTTS({ apiKey: env.ELEVENLABS_API_KEY, ...cfg }),
  // 'cartesia':  (cfg, env) => new CartesiaTTS({ apiKey: env.CARTESIA_API_KEY, ...cfg }),
};

const LLM_REGISTRY = {
  'openai-compat': (cfg, env) => new OpenAICompatLLM(cfg), // apiKey passed in cfg
  // 'anthropic':   (cfg, env) => new AnthropicLLM(cfg),
};

export function createPipelineFactory(agent, env, fillers) {
  return function createPipeline(contextOverride) {
    const sttConfig = {
      ...agent.providers.stt,
      language: contextOverride?.language || agent.providers.stt.language
    };

    const stt = STT_REGISTRY[sttConfig.name](sttConfig, env);
    const tts = TTS_REGISTRY[agent.providers.tts.name](agent.providers.tts, env);
    const llm = LLM_REGISTRY[agent.providers.llm.name](agent.providers.llm, env);
    const cost = new CostTracker(agent.costTracking);

    const dynamicAgent = contextOverride
      ? { ...agent, context: { ...agent.context, ...contextOverride } }
      : agent;

    return new VoicePipeline({ stt, tts, llm, agent: dynamicAgent, cost, fillers });
  };
}

```

---

## File: `src/core/VoicePipeline.js`

```javascript
// src/core/VoicePipeline.js

import { ConversationManager } from './ConversationManager.js';
import { BargeInController } from './BargeInController.js';
import { CostTracker } from './CostTracker.js';
import { logEvent } from '../services/ObservabilityService.js';

export class VoicePipeline {
  constructor({ stt, tts, llm, agent, cost: costTracker, fillers }) {
    this.stt = stt;
    this.tts = tts;
    this.llm = llm;
    this.agent = agent;
    this.fillers = fillers;

    this.conversation = new ConversationManager({
      systemPrompt: typeof agent.systemPrompt === 'function'
        ? agent.systemPrompt(agent.context)
        : agent.systemPrompt,
      maxHistory: agent.conversation?.maxHistory ?? 12,
    });

    this.bargeIn = new BargeInController(agent.bargeIn ?? {});
    this.cost = costTracker ?? new CostTracker(agent.costTracking);

    // Per-call state
    this.transport = null;
    this.callSid = null;
    this.streamSid = null;
    this.startTime = null;
    this.turnId = 0;
    this.aborter = null;
    this.isSpeaking = false;
    this.isProcessing = false;
    this.currentMark = null;
    this.currentTurnStart = null;
    this.firstAudioLogged = false;
    this.lastFiller = null;
    this.prewarmPromise = null;
    this.isStarted = false;

    // Additional state initialization
    this.trueLatencyStart = null;
    this.fillerPlayedThisTurn = false;
    this.lastFillerPlayTime = 0;
  }

  // ─── Lifecycle ───────────────────────────────────────────

  prewarm() {
    if (this.prewarmPromise) return this.prewarmPromise;
    this.prewarmPromise = this._doPrewarm();
    return this.prewarmPromise;
  }

  async _doPrewarm() {
    // Wire provider callbacks to pipeline methods
    this.stt.onTranscript = (text, isFinal, raw) => this._onTranscript(text, isFinal, raw);
    this.stt.onError = (e) => console.error('[STT error]', e);
    this.tts.onAudio = (b64, isFinal) => this._onTTSAudio(b64, isFinal);

    this.stt.connect();          // fire-and-forget (auto-reconnects internally)
    await this.tts.connect();    // must be open before sending text
  }

  attachTransport(transport) {
    this.transport = transport;
    transport.on('mark', (name) => this._onMark(name));
  }

  start({ callSid, streamSid }) {
    this.callSid = callSid;
    this.streamSid = streamSid;
    this.startTime = Date.now();
    this.isStarted = true;
    logEvent(this.callSid, 'stt_connect', { timestamp: Date.now() });
    this._playGreeting();
  }

  handleIncomingAudio(b64) {
    this.stt.sendAudio(b64);
  }

  stop() {
    try {
      this.aborter?.abort();
    } catch (err) {
      console.error('[Pipeline] Error aborting during stop:', err);
    } finally {
      this.aborter = null;
    }
    try { this.stt?.close(); } catch (err) { console.error('[Pipeline] Error closing STT:', err); }
    try { this.tts?.close(); } catch (err) { console.error('[Pipeline] Error closing TTS:', err); }
    this.cost.report(this.startTime);
  }

  // ─── Greeting ────────────────────────────────────────────

  _playGreeting() {
    const greet = typeof this.agent.greeting === 'function'
      ? this.agent.greeting(this.agent.context)
      : this.agent.greeting;

    this.conversation.pushAssistant(greet);
    greet.split(/(\s+)/).filter(w => w.trim()).forEach(w => this.tts.sendTextChunk(w, true));
    this.tts.flush();

    this.bargeIn.lockForGreeting(this.agent.bargeIn?.greetingDurationMs ?? 2500);
  }

  // ─── STT Callbacks ───────────────────────────────────────

  _onTranscript(text, isFinal) {
    if (!isFinal) {
      if (this.bargeIn.shouldBargeIn(text, this.isSpeaking)) {
        this._handleBargeIn(text);
      }
      return;
    }

    if (this.bargeIn.isGreeting) return; // Block final transcripts during the greeting

    // Final committed transcript
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.bargeIn.resetSpeechStart();

    if (this.callSid) {
      const vadThresholdSecs = this.agent.providers?.stt?.vadSilenceThresholdSecs || 1.25;
      logEvent(this.callSid, 'stt_final', { 
        text,
        estimatedVadMs: Math.round(vadThresholdSecs * 1000)
      });
    }

    this._processTurn(text).finally(() => { this.isProcessing = false; });
  }

  _handleBargeIn(text) {
    console.log(`[Barge-in] "${text}"`);
    if (this.callSid) {
      logEvent(this.callSid, 'barge_in', { text });
    }
    this.bargeIn.recordBargeIn();
    this.turnId++;
    this.aborter?.abort();
    this.transport.sendClear();
    this.tts.interrupt(false); // soft interrupt
    this.isSpeaking = false;
  }

  // ─── Turn Processing ─────────────────────────────────────

  async _processTurn(userText) {
    this.fillerPlayedThisTurn = false;
    this.lastFillerPlayTime = 0;
    // Play cached filler to mask LLM latency (skip during greeting)
    if (!this.bargeIn.isGreeting) {
      const fillerText = this.fillers.getRandom(this.lastFiller);
      this.lastFiller = fillerText;
      const cached = this.fillers.get(fillerText);
      if (cached) {
        console.log(`[Filler] Playing cached: "${fillerText}"`);
        this.isSpeaking = true;
        this.transport.sendMedia(cached);
        this.currentMark = `filler-${Date.now()}`;
        this.transport.sendMark(this.currentMark);
        this.fillerPlayedThisTurn = true;

        // Calculate actual filler duration in ms: (bufferLength / 8000) * 1000
        const bufferLength = Buffer.from(cached, 'base64').length;
        this.lastFillerPlayTime = Math.round(bufferLength / 8);
      }
    }

    const myTurn = ++this.turnId;
    this.aborter?.abort();
    this.aborter = new AbortController();
    this.currentTurnStart = Date.now();
    this.firstAudioLogged = false;
    this.tts.clearInterrupt();

    this.trueLatencyStart = null;
    this.conversation.truncate();
    this.conversation.pushUser(userText);
    console.log(`[STT] Final: "${userText}"`);

    this.trueLatencyStart = Date.now();
    try {
      await this._streamLLM(myTurn);
    } catch (err) {
      console.error('[LLM Error]', err);
      if (myTurn === this.turnId) {
        const fb = "I'm sorry, I am experiencing a temporary connection issue. Could you please repeat that?";
        this.tts.clearInterrupt();
        fb.split(/(\s+)/).forEach(w => this.tts.sendTextChunk(w, true));
        this.tts.flush();
        this.conversation.pushAssistant(fb);
      }
    }
  }

  async _streamLLM(myTurn) {
    let firstTokenTime = null;
    let full = '';
    let buffer = '';
    let isFirstChunk = true;

    for await (const token of this.llm.stream(this.conversation.getMessages(), this.aborter.signal)) {
      if (myTurn !== this.turnId) return;

      if (!firstTokenTime && this.currentTurnStart) {
        firstTokenTime = Date.now();
        const latency = firstTokenTime - this.currentTurnStart;
        console.log(`[Latency] TTFT: ${latency}ms`);
        if (this.callSid) {
          logEvent(this.callSid, 'ttft', { latency });
        }
      }

      buffer += token;
      full += token;

      // Dynamic buffering: first chunk fast, subsequent chunks at phrase boundaries
      if (isFirstChunk) {
        const wordCount = buffer.trim().split(/\s+/).length;
        if (wordCount >= 1 || buffer.length >= 5 || /[\.\?\!\,\;]$/.test(buffer)) {
          this.tts.sendTextChunk(buffer, true);
          buffer = '';
          isFirstChunk = false;
        }
      } else {
        if (/[\,\.\?\!\;]$/.test(buffer) || (buffer.length >= 40 && /\s$/.test(buffer))) {
          this.tts.sendTextChunk(buffer, true);
          buffer = '';
        }
      }
    }

    if (myTurn !== this.turnId) return;
    if (buffer) this.tts.sendTextChunk(buffer, true);
    this.tts.flush();

    const inputJson = this.conversation.toJSON();
    this.conversation.pushAssistant(full);
    this.cost.trackLLM(inputJson, full);
    console.log(`[LLM] Response: "${full}"`);
    if (this.callSid) {
      logEvent(this.callSid, 'llm_response', { text: full });
    }
  }

  // ─── TTS Callbacks ───────────────────────────────────────

  _onTTSAudio(b64, isFinal) {
    if (!this.transport) return;

    if (this.bargeIn.isGreeting && !this.firstAudioLogged) {
      this.firstAudioLogged = true;
      const latency = Date.now() - this.startTime;
      console.log(`[Net] Greeting TTS first byte: ${latency}ms after start`);
      if (this.callSid) {
        logEvent(this.callSid, 'tts_first_byte', { latency, type: 'greeting' });
      }
    } else if (this.trueLatencyStart && !this.firstAudioLogged) {
      this.firstAudioLogged = true;
      const latencyMs = Date.now() - this.trueLatencyStart;
      
      if (this.fillerPlayedThisTurn) {
        const fillerMs = this.lastFillerPlayTime || 0;
        const perceivedMs = latencyMs + fillerMs;

        if (this.callSid) {
          logEvent(this.callSid, 'true_voice_latency', { 
            ms: latencyMs,
            fillerMs,
            perceivedMs,
            fillerPlayed: true
          });
        }
        console.log(`[Latency] True Voice Latency: ${latencyMs}ms (filler: ${fillerMs}ms, perceived: ${perceivedMs}ms)`);
        
        // Interrupt/clear the Twilio playback queue to cut off the filler instantly
        console.log('[Filler] Cutting off filler playback to play actual response');
        this.transport.sendClear();
      } else {
        if (this.callSid) {
          logEvent(this.callSid, 'true_voice_latency', { 
            ms: latencyMs,
            fillerPlayed: false
          });
        }
        console.log(`[Latency] True Voice Latency (no filler): ${latencyMs}ms`);
      }
    } else if (this.currentTurnStart && !this.firstAudioLogged) {
      this.firstAudioLogged = true;
      const latency = Date.now() - this.currentTurnStart;
      console.log(`[Net] TTS first byte: ${latency}ms`);
      if (this.callSid) {
        logEvent(this.callSid, 'tts_first_byte', { latency, type: 'turn' });
      }
    }

    this.isSpeaking = true;
    this.transport.sendMedia(b64);

    if (isFinal) {
      this.currentMark = `tts-${Date.now()}`;
      this.transport.sendMark(this.currentMark);
    }
  }

  // ─── Transport Events ────────────────────────────────────

  _onMark(name) {
    if (name === this.currentMark || this.bargeIn.isGreeting) {
      this.isSpeaking = false;
      this.bargeIn.onBotFinished();
    }
  }
}

```

---

## File: `src/core/interfaces.js`

```javascript
// src/core/interfaces.js

/**
 * Every provider extends these so the pipeline never imports
 * a concrete implementation — it only talks to the interface.
 */

export class STTProvider {
  constructor({ onTranscript, onError } = {}) {
    this.onTranscript = onTranscript; // (text, isFinal, raw) => void
    this.onError = onError;
  }
  async connect() { throw new Error('STTProvider.connect() not implemented'); }
  sendAudio(/* b64 */) { throw new Error('STTProvider.sendAudio() not implemented'); }
  async close() {}
}

export class TTSProvider {
  constructor({ onAudio } = {}) {
    this.onAudio = onAudio; // (b64, isFinal) => void
  }
  async connect() { throw new Error('TTSProvider.connect() not implemented'); }
  sendTextChunk(/* text, trigger */) { throw new Error('not implemented'); }
  interrupt(/* hard */) {}
  flush() {}
  clearInterrupt() {}
  async close() {}
  static async prefetch() { throw new Error('TTSProvider.prefetch() not implemented'); }
}

export class LLMProvider {
  async *stream(/* messages, signal */) { throw new Error('LLMProvider.stream() not implemented'); }
}

export class TelephonyProvider {
  webhookHandler() { throw new Error('not implemented'); }       // Fastify route
  mediaStreamHandler() { throw new Error('not implemented'); }   // WS route
  async createCall(/* opts */) { throw new Error('not implemented'); }
}

```

---

## File: `src/providers/llm/OpenAICompatLLM.js`

```javascript
// src/providers/llm/OpenAICompatLLM.js
import OpenAI from 'openai';
import { LLMProvider } from '../../core/interfaces.js';

export class OpenAICompatLLM extends LLMProvider {
  constructor({ apiKey, baseURL, model, temperature = 0, maxTokens = 100 }) {
    super();
    this.client = new OpenAI({ apiKey, baseURL });
    this.model = model;
    this.temperature = temperature;
    this.maxTokens = maxTokens;
  }

  async *stream(messages, signal) {
    const s = await this.client.chat.completions.create({
      model: this.model,
      messages,
      stream: true,
      temperature: this.temperature,
      max_tokens: this.maxTokens,
    }, { signal });
    for await (const chunk of s) {
      if (signal?.aborted) break;
      const t = chunk.choices[0]?.delta?.content || '';
      if (t) yield t;
    }
  }
}

```

---

## File: `src/providers/telephony/TwilioTelephony.js`

```javascript
// src/providers/telephony/TwilioTelephony.js
import twilio from 'twilio';
import { TelephonyProvider } from '../../core/interfaces.js';
import { TwilioTransport } from './TwilioTransport.js';
import { startCall, endCall, logEvent } from '../../services/ObservabilityService.js';
import { createWavBuffer } from '../../utils/wav.js';
import { uploadWavFile } from '../../services/S3Service.js';
import { extractCallOutcome } from '../../services/IntentService.js';

export class TwilioTelephony extends TelephonyProvider {
  constructor({ accountSid, authToken, fromNumber, domain, pipelineFactory }) {
    super();
    this.client = twilio(accountSid, authToken);
    this.fromNumber = fromNumber;
    this.domain = domain;
    this.pipelineFactory = pipelineFactory;
    this.prewarmed = new Map();
    this.callContexts = new Map();
  }

  async createCall({ to, context, machineDetection = true }) {
    if (!to || typeof to !== 'string' || !/^\+?[1-9]\d{1,14}$/.test(to.trim())) {
      throw new Error(`Invalid "to" phone number format: ${to}`);
    }
    let sanitizedContext = {};
    if (context && typeof context === 'object') {
      try {
        sanitizedContext = JSON.parse(JSON.stringify(context));
      } catch (err) {
        throw new Error(`Invalid context payload: ${err.message}`);
      }
    }
    sanitizedContext.toNumber = to.trim();

    const call = await this.client.calls.create({
      to: to.trim(),
      from: this.fromNumber,
      url: `https://${this.domain}/voice`,
      machineDetection: machineDetection ? 'Enable' : undefined,
    });
    
    this.callContexts.set(call.sid, sanitizedContext);
    return call;
  }

  // ── HTTP webhook: AMD check + pre-warm + TwiML ──────────
  webhookHandler() {
    return (req, reply) => {
      const answeredBy = req.body?.AnsweredBy || req.query?.AnsweredBy || '';
      if (answeredBy.startsWith('machine')) {
        req.log.info({ answeredBy }, 'Answering machine detected. Hanging up.');
        return reply.type('text/xml')
          .send('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
      }

      const callSid = req.body?.CallSid || req.query?.CallSid;
      if (callSid) {
        console.log(`[Pre-warm] Creating pipeline for CallSid: ${callSid}`);
        const context = this.callContexts.get(callSid) || {};
        context.toNumber = req.body?.To || req.query?.To || context.toNumber || 'unknown';
        this.callContexts.set(callSid, context);
        const pipeline = this.pipelineFactory(context);
        const prewarmPromise = pipeline.prewarm();
        this.prewarmed.set(callSid, { pipeline, prewarmPromise });

        // Memory leak cleanup: if WebSocket does not connect in 60s, clean up
        setTimeout(() => {
          if (this.prewarmed.has(callSid)) {
            console.log(`[Cleanup] Cleaning up stale pre-warmed pipeline for CallSid: ${callSid}`);
            const entry = this.prewarmed.get(callSid);
            try { entry.pipeline.stop(); } catch {}
            this.prewarmed.delete(callSid);
          }
          this.callContexts.delete(callSid);
        }, 60000);
      }

      reply.type('text/xml').send(
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<Response><Connect><Stream url="wss://${this.domain}/media"/></Connect></Response>`
      );
    };
  }

  // ── WebSocket media-stream handler ──────────────────────
  mediaStreamHandler() {
    return (connection, req) => {
      const ws = connection.socket ?? connection;
      let transport = null;
      let pipeline = null;
      let firstMediaLogged = false;

      let customerAudioBuffer = Buffer.alloc(0);
      let botAudioBuffer = Buffer.alloc(0);
      let callSid = null;
      let toNumber = 'unknown';
      let callEnded = false;

      const finishCall = async () => {
        if (callEnded) return;
        callEnded = true;

        if (pipeline) {
          pipeline.stop();
          const durationSecs = Math.round((Date.now() - pipeline.startTime) / 1000);
          const finalCost = pipeline.cost ? (pipeline.cost.totalCost || 0) : 0;
          const costBreakdown = pipeline.cost ? (pipeline.cost.breakdown || {}) : {};
          const transcript = pipeline.conversation ? pipeline.conversation.getMessages() : [];
          
          // Process S3 uploads and DB inserts asynchronously (background task)
          (async () => {
            try {
              const customerWav = createWavBuffer(customerAudioBuffer);
              const botWav = createWavBuffer(botAudioBuffer);

              const [customerUrl, botUrl] = await Promise.all([
                uploadWavFile(callSid, 'customer', customerWav),
                uploadWavFile(callSid, 'bot', botWav)
              ]);

              const recordingUrls = { customer: customerUrl, bot: botUrl };
              
              // Extract call outcome/status using IntentService
              const outcome = await extractCallOutcome(transcript);
              if (callSid) {
                await logEvent(callSid, 'call_outcome', outcome);
              }
              console.log(`[Intent] Call ${callSid} outcome:`, outcome);

              // ── SEND TO YOUR EXTERNAL API ──
              if (outcome.status !== 'unknown' && outcome.status !== 'error') {
                try {
                  console.log(`[External API] Would send outcome for ${callSid} to external API.`);
                } catch (apiErr) {
                  console.error('[External API] Failed to send outcome:', apiErr);
                }
              }

              await endCall(callSid, durationSecs, JSON.stringify(recordingUrls), transcript, finalCost, costBreakdown);
            } catch (err) {
              console.error('[TwilioTelephony] Error in background finishCall task:', err);
              try {
                await endCall(callSid, durationSecs, null, transcript, finalCost, costBreakdown);
              } catch (innerErr) {
                console.error('[TwilioTelephony] Failed to even end call in DB:', innerErr);
              }
            }
          })();
        }
      };

      ws.on('message', async (raw) => {
        try {
          const data = JSON.parse(raw.toString());

          if (data.event === 'start') {
            const streamSid = data.start.streamSid;
            callSid = data.start.callSid;
            req.log.info({ streamSid, callSid }, 'call started');

            const pre = this.prewarmed.get(callSid);
            if (pre) {
              pipeline = pre.pipeline;
              toNumber = pipeline.agent?.context?.toNumber || 'unknown';
              await pre.prewarmPromise;
              this.prewarmed.delete(callSid);
              this.callContexts.delete(callSid);
              console.log(`[Pre-warm] Using pre-warmed pipeline for ${callSid}`);
            } else {
              const context = this.callContexts.get(callSid) || {};
              toNumber = context.toNumber || 'unknown';
              pipeline = this.pipelineFactory(context);
              this.callContexts.delete(callSid);
              await pipeline.prewarm();
            }

            // Log start call to observability
            await startCall(callSid, toNumber, pipeline.agent?.name || 'unknown');

            transport = new TwilioTransport(ws, streamSid);
            
            // Listen to outbound bot audio
            transport.on('outboundMedia', (b64) => {
              const audioChunk = Buffer.from(b64, 'base64');
              botAudioBuffer = Buffer.concat([botAudioBuffer, audioChunk]);
            });

            pipeline.attachTransport(transport);
            pipeline.start({ callSid, streamSid });
          }

          if (data.event === 'media' && pipeline && pipeline.isStarted) {
            const audioChunk = Buffer.from(data.media.payload, 'base64');
            customerAudioBuffer = Buffer.concat([customerAudioBuffer, audioChunk]);

            if (!firstMediaLogged && pipeline.startTime) {
              firstMediaLogged = true;
              console.log(`[Net] Twilio→server first media: ${Date.now() - pipeline.startTime}ms`);
            }
            pipeline.handleIncomingAudio(data.media.payload);
          }

          if (data.event === 'mark' && transport) {
            transport.emit('mark', data.mark?.name);
          }

          if (data.event === 'stop') {
            await finishCall();
          }
        } catch (parseErr) {
          console.error('[TwilioTelephony] Error processing WebSocket message:', parseErr);
        }
      });

      ws.on('close', async () => {
        await finishCall();
      });
    };
  }
}

```

---

## File: `src/providers/telephony/TwilioTransport.js`

```javascript
// src/providers/telephony/TwilioTransport.js
import { EventEmitter } from 'events';

export class TwilioTransport extends EventEmitter {
  constructor(ws, streamSid) {
    super();
    this.ws = ws;
    this.streamSid = streamSid;
  }

  _send(obj) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  sendMedia(b64) {
    this.emit('outboundMedia', b64);
    this._send({ event: 'media', streamSid: this.streamSid, media: { payload: b64 } });
  }

  sendMark(name) {
    this._send({ event: 'mark', streamSid: this.streamSid, mark: { name } });
  }

  sendClear() {
    this._send({ event: 'clear', streamSid: this.streamSid });
  }
}

```

---

## File: `src/providers/tts/ElevenLabsTTS.js`

```javascript
// src/providers/tts/ElevenLabsTTS.js
import WebSocket from 'ws';
import { TTSProvider } from '../../core/interfaces.js';

export class ElevenLabsTTS extends TTSProvider {
  constructor({ apiKey, voiceId, model, outputFormat, optimizeStreamingLatency = 4,
                inactivityTimeout = 180, speed = 1.0, onAudio, onOpen }) {
    super({ onAudio });
    this.apiKey = apiKey;
    this.voiceId = voiceId;
    this.model = model;
    this.outputFormat = outputFormat;
    this.optimizeStreamingLatency = optimizeStreamingLatency;
    this.inactivityTimeout = inactivityTimeout;
    this.speed = speed;
    this.onOpen = onOpen;
    this.ws = null;
    this.queue = [];
    this.isClosedExplicitly = false;
    this.ignoringAudio = false;
  }

  connect() {
    this.isClosedExplicitly = false;
    this.ignoringAudio = false;
    return new Promise((resolve) => {
      const url = `wss://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream-input?model_id=${this.model}&output_format=${this.outputFormat}&optimize_streaming_latency=${this.optimizeStreamingLatency}&inactivity_timeout=${this.inactivityTimeout}`;
      
      try {
        this.ws = new WebSocket(url, { headers: { 'xi-api-key': this.apiKey } });
      } catch (err) {
        console.error('[TTS] WebSocket instantiation error:', err);
        resolve();
        return;
      }

      let opened = false;

      this.ws.on('open', () => {
        opened = true;
        this.ws.send(JSON.stringify({
          text: ' ',
          voice_settings: { stability: 0.45, similarity_boost: 0.8, speed: this.speed },
          generation_config: { chunk_length_schedule: [50, 90, 120], flush_after_eos: true },
        }));
        while (this.queue.length) this.ws.send(this.queue.shift());
        this.onOpen?.();
        resolve();
      });

      this.ws.on('message', (raw) => {
        try {
          const m = JSON.parse(raw.toString());
          if (this.ignoringAudio) {
            if (m.isFinal) this.ignoringAudio = false;
            return;
          }
          if (m.audio) this.onAudio?.(m.audio, m.isFinal);
        } catch {}
      });

      this.ws.on('close', (c) => {
        console.log(`[TTS] Closed: ${c}`);
        if (!opened) resolve();
        if (!this.isClosedExplicitly && (c === 1006 || c === 1005)) {
          this.queue = [];
          console.log('[TTS] Reconnecting in 1s...');
          setTimeout(() => this.connect(), 1000);
        }
      });

      this.ws.on('error', (err) => {
        console.error('[TTS] WebSocket error:', err);
        if (!opened) resolve();
      });
    });
  }

  sendTextChunk(text, trigger = true) {
    const p = JSON.stringify({ text, try_trigger_generation: trigger });
    if (this.ws?.readyState === 1) this.ws.send(p);
    else this.queue.push(p);
  }

  interrupt(hard = false) {
    this.queue = [];
    if (hard) {
      try { this.ws?.close(); } catch {}
      this.connect();
    } else {
      this.ignoringAudio = true;
      if (this.ws?.readyState === 1)
        this.ws.send(JSON.stringify({ text: '', flush: true }));
    }
  }

  flush() {
    if (this.ws?.readyState === 1)
      this.ws.send(JSON.stringify({ text: '', flush: true }));
  }

  clearInterrupt() { this.ignoringAudio = false; }

  close() {
    this.isClosedExplicitly = true;
    this.queue = [];
    try { this.ws?.close(); } catch {}
  }

  // Static REST prefetch for filler cache (independent of WS lifecycle)
  static async prefetch({ apiKey, voiceId, model, outputFormat, text, speed = 1.0 }) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${outputFormat}`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: model, voice_settings: { stability: 0.5, similarity_boost: 0.75, speed } }),
    });
    if (!res.ok) throw new Error(`ElevenLabs TTS HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer()).toString('base64');
  }
}

```

---

## File: `src/providers/stt/ElevenLabsSTT.js`

```javascript
// src/providers/stt/ElevenLabsSTT.js
import WebSocket from 'ws';
import { STTProvider } from '../../core/interfaces.js';

export class ElevenLabsSTT extends STTProvider {
  constructor({ apiKey, model, language, audioFormat, commitStrategy = 'vad',
                vadSilenceThresholdSecs, vadThreshold, minVolumeThreshold,
                onTranscript, onError }) {
    super({ onTranscript, onError });
    if (!apiKey) throw new Error('ElevenLabsSTT: apiKey is required');
    if (!model) throw new Error('ElevenLabsSTT: model is required');
    if (!audioFormat) throw new Error('ElevenLabsSTT: audioFormat is required');

    this.apiKey = apiKey;
    this.params = { model_id: model, language_code: language, audio_format: audioFormat,
                    commit_strategy: commitStrategy, vad_silence_threshold_secs: vadSilenceThresholdSecs,
                    vad_threshold: vadThreshold, min_volume_threshold: minVolumeThreshold };
    this.ws = null;
    this.pingTimer = null;
    this.audioQueue = [];
    this.isClosedExplicitly = false;
  }

  connect() {
    this.isClosedExplicitly = false;
    const cleanParams = Object.fromEntries(
      Object.entries(this.params).filter(([_, val]) => val !== undefined && val !== null && val !== '')
    );
    const url = `wss://api.elevenlabs.io/v1/speech-to-text/realtime?${new URLSearchParams(cleanParams)}`;
    console.log(`[STT] Connecting: ${url}`);
    this.ws = new WebSocket(url, { headers: { 'xi-api-key': this.apiKey } });

    this.ws.on('open', () => {
      console.log('[STT] Connected');
      while (this.audioQueue.length) this.ws.send(this.audioQueue.shift());
      this.pingTimer = setInterval(() => {
        try { if (this.ws?.readyState === 1) this.ws.ping(); } catch {}
      }, 15000);
    });

    this.ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.message_type === 'committed_transcript' && msg.text)
          this.onTranscript?.(msg.text, true, msg);
        if (msg.message_type === 'partial_transcript' && msg.text)
          this.onTranscript?.(msg.text, false, msg);
      } catch (err) {
        console.error('[STT] Parse error:', err);
      }
    });

    this.ws.on('close', (code) => {
      console.log(`[STT] Closed: ${code}`);
      clearInterval(this.pingTimer);
      if (!this.isClosedExplicitly && (code === 1006 || code === 1005)) {
        console.log('[STT] Reconnecting in 1s...');
        setTimeout(() => this.connect(), 1000);
      }
    });

    this.ws.on('error', (e) => {
      console.error('[STT] Error:', e.message);
      this.onError?.(e);
    });
  }

  sendAudio(b64) {
    const payload = JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: b64 });
    if (this.ws?.readyState === 1) this.ws.send(payload);
    else this.audioQueue.push(payload);
  }

  close() {
    this.isClosedExplicitly = true;
    clearInterval(this.pingTimer);
    this.ws?.close();
  }
}

```

---

## File: `src/agents/linenGrassReminder.js`

```javascript
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
    `You are Krish, a polite and friendly assistant from LinenGrass calling ${ctx.hotelName}. ` +
    `You are having a natural, spoken conversation with ${ctx.contactName}. Your goal is to gently ensure they place their daily linen order using the LinenGrass app.\n\n` +
    
    `## CONTEXT\n` +
    `- Customer: ${ctx.contactName} at ${ctx.hotelName}\n` +
    `- Past Order (Only share if asked): Date: ${ctx.lastOrder?.date}, ID: ${ctx.lastOrder?.id}, Items: ${ctx.lastOrder?.products}\n` +
    `- Order Deadline: 6 PM. (Emphasize that ordering before 6 PM ensures the system can process it correctly and deliver the right linens).\n\n` +
    
    `## CONVERSATION FLOW\n` +
    `(Note: The system has already played the initial greeting. Do NOT repeat the greeting.)\n` +
    `1. **Check Order**: Ask if they have placed today's linen order yet. Wait for their answer.\n` +
    `2. **If ALREADY PLACED**: Acknowledge politely, remind them to use the LinenGrass app, say goodbye, and end.\n` +
    `3. **If NOT PLACED YET**: Briefly mention that delayed orders affect supply. Ask for a specific time they will place it today.\n` +
    `4. **If THEY GIVE A TIME (e.g., "shaam tak", "in an hour")**: Acknowledge the time, remind them to use the LinenGrass app ONLY, say goodbye, and end. DO NOT ask again.\n` +
    `5. **Refusal**: If they refuse or are angry, apologize for the disturbance, ask them to place the order when ready, and say goodbye.\n\n` +
    
    `## CRITICAL HUMAN-LIKE RULES\n` +
    `- **Language Detection**: If the user speaks ANY Hindi or Kannada words, you MUST reply in that language using native script (Devanagari for Hindi). ` +
    `For example, if the user says "mai aaj shaam tak kar dunga", you MUST reply in Hindi Devanagari script. Do not reply in English just because they said "thank you".\n` +
    `- **Natural Brevity**: Speak naturally in 1 to 2 short sentences. Do not use markdown, bullet points, or special characters.\n` +
    `- **Pacing**: Ask ONE question at a time. Do not overwhelm the user with multiple questions.\n` +
    `- **Numbers**: Always speak numbers as words (e.g., "two" instead of "2", "six PM" instead of "6 PM").\n` +
    `- **Empathy over Praise**: NEVER say "congratulations". Acknowledge their commitment naturally and simply (e.g., "ठीक है, शाम तक LinenGrass ऐप पर ऑर्डर कर दें। धन्यवाद।").\n` +
    `- **No Loops**: If the user confirms the order is placed OR gives a time commitment, DO NOT ask again. Say goodbye and stop.\n` +
    `- **Identity**: You are an AI. You cannot transfer the call.`,
    
  // Greeting played on call connect
  greeting: (ctx) =>
    // Asking for the person first, then identifying yourself, is much more human.
    `Hi, is this ${ctx.contactName || 'the manager'}? ... Great, this is Krish calling from LinenGrass.`,

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
      minVolumeThreshold: 0.45,
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
```

---

## File: `src/agents/orderStatus.js`

```javascript
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
      minVolumeThreshold: 0.45,
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

```

---

## File: `src/server/createServer.js`

```javascript
// src/server/createServer.js
import Fastify from 'fastify';
import fastifyWs from '@fastify/websocket';
import { attachObservabilityWebSocket } from '../services/ObservabilityService.js';

export async function createServer({ telephony, port = 3000 }) {
  const app = Fastify({ logger: true });
  await app.register(fastifyWs);
  attachObservabilityWebSocket(app);

  // URL-encoded body parser for Twilio webhooks
  app.addContentTypeParser('application/x-www-form-urlencoded', (req, payload, done) => {
    let body = '';
    payload.on('data', c => { body += c; });
    payload.on('end', () => {
      try { done(null, Object.fromEntries(new URLSearchParams(body))); }
      catch (err) { done(err); }
    });
  });

  // Twilio voice webhook (AMD + TwiML + pre-warm)
  app.post('/voice', telephony.webhookHandler());

  // Trigger outbound call API endpoint
  app.post('/api/call', async (req, reply) => {
    const { to, context } = req.body || {};
    if (!to) {
      return reply.code(400).send({ error: 'Missing "to" phone number' });
    }
    try {
      const call = await telephony.createCall({ to, context });
      return { success: true, callSid: call.sid };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: err.message });
    }
  });

  // Twilio media stream (WebSocket)
  app.register(async (f) => {
    f.get('/media', { websocket: true }, telephony.mediaStreamHandler());
  });

  await app.listen({ port, host: '0.0.0.0' });
  console.log(`[Server] Listening on :${port}`);
  return app;
}

```

---

## File: `src/server/makeCall.js`

```javascript
// src/server/makeCall.js
import { config } from '../config.js';

export async function makeCall(telephony, { to = config.TO_NUMBER } = {}) {
  const call = await telephony.createCall({ to, machineDetection: true });
  console.log('Calling', call.sid);
  return call;
}

```

---

## File: `src/utils/wav.js`

```javascript
// src/utils/wav.js

/**
 * Injects a 44-byte WAV header for 8kHz, 8-bit, mono µ-law audio.
 * @param {Buffer} rawAudioBuffer - The raw µ-law audio bytes from Twilio
 * @returns {Buffer} - A perfectly valid WAV file buffer
 */
export function createWavBuffer(rawAudioBuffer) {
  const sampleRate = 8000;
  const numChannels = 1;
  const bitsPerSample = 8;
  const audioFormat = 7; // 7 = µ-law. (DO NOT USE 1, which is PCM)
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const chunkSize = 36 + rawAudioBuffer.length;
  const subChunkSize = rawAudioBuffer.length;

  const header = Buffer.alloc(44);

  // RIFF header
  header.write('RIFF', 0);
  header.writeUInt32LE(chunkSize, 4);
  header.write('WAVE', 8);

  // fmt subchunk
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);         // Subchunk1 size for PCM/µ-law
  header.writeUInt16LE(audioFormat, 20); // 7 = µ-law
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);

  // data subchunk
  header.write('data', 36);
  header.writeUInt32LE(subChunkSize, 40);

  return Buffer.concat([header, rawAudioBuffer]);
}


```

---

## File: `src/services/IntentService.js`

```javascript
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

```

---

## File: `src/services/ObservabilityService.js`

```javascript
import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

// Create pool if DATABASE_URL is defined, otherwise fallback gracefully for testing
let pool = null;
if (config.DATABASE_URL) {
  pool = new Pool({
    connectionString: config.DATABASE_URL,
    ssl: config.DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : false
  });
  pool.on('error', (err) => {
    console.error('Unexpected error on idle pg client', err);
  });
} else {
  console.warn('DATABASE_URL is not set. Database operations will be mocked.');
}

const clients = new Set();

function broadcast(event) {
  const message = JSON.stringify(event);
  for (const client of clients) {
    if (client.readyState === 1) { // OPEN
      try {
        client.send(message);
      } catch (err) {
        console.error('Error broadcasting event to WS client', err);
      }
    }
  }
}

export async function startCall(callSid, toNumber, agentName, timestamp = new Date()) {
  console.log(`[Observability] startCall: ${callSid}, ${toNumber}, ${agentName}`);
  const eventTime = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const event = {
    type: 'start_call',
    callSid,
    toNumber,
    agentName,
    startedAt: eventTime.toISOString()
  };
  broadcast(event);

  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO calls (call_sid, to_number, status, started_at, agent_name) 
       VALUES ($1, $2, 'in-progress', $3, $4)
       ON CONFLICT (call_sid) DO UPDATE 
       SET to_number = EXCLUDED.to_number, status = 'in-progress', agent_name = EXCLUDED.agent_name`,
      [callSid, toNumber, eventTime, agentName]
    );
  } catch (err) {
    console.error('Error inserting call into DB:', err);
  }
}

export async function endCall(callSid, duration, recordingUrl, transcript, totalCost, costBreakdown) {
  console.log(`[Observability] endCall: ${callSid}, duration: ${duration}, url: ${recordingUrl}, cost: ${totalCost}`);
  
  const serializedTranscript = JSON.stringify(transcript);
  const serializedCostBreakdown = JSON.stringify(costBreakdown);

  const event = {
    type: 'end_call',
    callSid,
    durationSecs: duration,
    recordingUrl,
    transcript: serializedTranscript,
    totalCost,
    costBreakdown: serializedCostBreakdown,
    endedAt: new Date().toISOString()
  };
  broadcast(event);

  if (!pool) return;
  try {
    await pool.query(
      `UPDATE calls 
       SET status = 'completed', ended_at = NOW(), duration_secs = $1, recording_url = $2, transcript = $3, total_cost = $4, cost_breakdown = $5
       WHERE call_sid = $6`,
      [duration, recordingUrl, serializedTranscript, totalCost, serializedCostBreakdown, callSid]
    );
  } catch (err) {
    console.error('Error updating call in DB:', err);
  }
}

export async function logEvent(callSid, eventType, payload, timestamp = new Date()) {
  console.log(`[Observability] logEvent: ${callSid}, type: ${eventType}`);
  const eventTime = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const event = {
    type: 'call_event',
    callSid,
    eventType,
    payload,
    createdAt: eventTime.toISOString()
  };
  broadcast(event);

  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO call_events (call_sid, event_type, payload, created_at) 
       VALUES ($1, $2, $3, $4)`,
      [callSid, eventType, JSON.stringify(payload), eventTime]
    );
  } catch (err) {
    console.error('Error inserting call event into DB:', err);
  }
}

export function attachObservabilityWebSocket(server) {
  server.get('/ws/observability', { websocket: true }, (connection, req) => {
    const ws = connection.socket ?? connection;
    clients.add(ws);
    console.log(`[Observability WS] Client connected. Total clients: ${clients.size}`);
    
    ws.on('close', () => {
      clients.delete(ws);
      console.log(`[Observability WS] Client disconnected. Total clients: ${clients.size}`);
    });

    ws.on('error', (err) => {
      console.error('[Observability WS] Socket error', err);
      clients.delete(ws);
    });
  });
}

```

---

## File: `src/services/S3Service.js`

```javascript
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config.js';

let s3Client = null;
if (config.AWS_ACCESS_KEY_ID && config.AWS_ACCESS_KEY_ID !== 'xxx') {
  s3Client = new S3Client({
    region: config.AWS_REGION,
    credentials: {
      accessKeyId: config.AWS_ACCESS_KEY_ID,
      secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
    },
  });
} else {
  console.warn('AWS S3 credentials are not configured. S3 uploads will return mocked public URLs.');
}

export async function uploadWavFile(callSid, trackName, wavBuffer) {
  const key = `recordings/${callSid}-${trackName}.wav`;
  const bucketName = config.AWS_S3_BUCKET || 'linengrass-recordings';
  const region = config.AWS_REGION || 'us-east-1';
  const publicUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;

  console.log(`[S3Service] Uploading ${key} to bucket ${bucketName}...`);

  if (!s3Client) {
    console.log(`[S3Service] Mock upload complete. URL: ${publicUrl}`);
    return publicUrl;
  }

  try {
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: wavBuffer,
      ContentType: 'audio/wav',
    });
    await s3Client.send(command);

    // Generate a 7-day presigned URL (604800 seconds)
    const getCommand = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });
    const presignedUrl = await getSignedUrl(s3Client, getCommand, { expiresIn: 604800 });
    console.log(`[S3Service] Upload success. Presigned URL: ${presignedUrl}`);
    return presignedUrl;
  } catch (err) {
    console.error(`[S3Service] Upload failed for ${key}:`, err);
    return publicUrl;
  }
}

```

---

