# Consolidated Codebase
Generated from: `/Users/akshith/LG/calling`

---

## File: `.env.example`

```
TWILIO_ACCOUNT_SID=ACxxx
TWILIO_AUTH_TOKEN=xxx
TWILIO_FROM_NUMBER=+1659251038
TO_NUMBER=+918341582042
DOMAIN=xxxx.ngrok-free.app
ELEVENLABS_API_KEY=eleven_xxx
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
OPENAI_API_KEY=sk-xxx
CEREBRAS_API_KEY=cbs-xxx
GROQ_API_KEY=gsk-xxx
PORT=3000

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
    "call": "node src/index.js --call"
  },
  "dependencies": {
    "@fastify/websocket": "^8.3.1",
    "fastify": "^4.28.1",
    "openai": "^4.56.0",
    "ws": "^8.18.0",
    "dotenv": "^16.4.5",
    "twilio": "^5.2.0"
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

    if (text.length > this.minLength && now - this.speechStart > this.speechStartMs) {
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
    if (!startTime) return;
    const dur = (Date.now() - startTime) / 1000;
    const twilioVoice = (dur / 60) * this.rates.twilioVoicePerMin;
    const twilioStream = (dur / 60) * this.rates.twilioStreamPerMin;
    const stt = (dur / 3600) * this.rates.sttPerHour;
    const llmIn = this.llmInputTokens * (this.rates.llmInputPerM / 1e6);
    const llmOut = this.llmOutputTokens * (this.rates.llmOutputPerM / 1e6);
    const tts = this.ttsChars * (this.rates.ttsPer1kChars / 1000);
    const total = twilioVoice + twilioStream + stt + llmIn + llmOut + tts;

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
    if (this.fillers.length < 2) return this.fillers[0];
    let pick;
    do {
      pick = this.fillers[Math.floor(Math.random() * this.fillers.length)];
    } while (pick === exclude);
    return pick;
  }

  get(text) {
    return this.cache[text];
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
    try { this.stt?.close(); } catch {}
    try { this.tts?.close(); } catch {}
    this.cost.report(this.startTime);
  }

  // ─── Greeting ────────────────────────────────────────────

  _playGreeting() {
    const greet = typeof this.agent.greeting === 'function'
      ? this.agent.greeting(this.agent.context)
      : this.agent.greeting;

    this.conversation.pushAssistant(greet);
    greet.split(/(\s+)/).forEach(w => this.tts.sendTextChunk(w, true));
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

    // Final committed transcript
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.bargeIn.resetSpeechStart();

    this._processTurn(text).finally(() => { this.isProcessing = false; });
  }

  _handleBargeIn(text) {
    console.log(`[Barge-in] "${text}"`);
    this.bargeIn.recordBargeIn();
    this.turnId++;
    this.aborter?.abort();
    this.transport.sendClear();
    this.tts.interrupt(false); // soft interrupt
    this.isSpeaking = false;
  }

  // ─── Turn Processing ─────────────────────────────────────

  async _processTurn(userText) {
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
      }
    }

    const myTurn = ++this.turnId;
    this.aborter?.abort();
    this.aborter = new AbortController();
    this.currentTurnStart = Date.now();
    this.firstAudioLogged = false;
    this.tts.clearInterrupt();

    this.conversation.truncate();
    this.conversation.pushUser(userText);
    console.log(`[STT] Final: "${userText}"`);

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
        console.log(`[Latency] TTFT: ${firstTokenTime - this.currentTurnStart}ms`);
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

    this.conversation.pushAssistant(full);
    this.cost.trackLLM(this.conversation.toJSON(), full);
    console.log(`[LLM] Response: "${full}"`);
  }

  // ─── TTS Callbacks ───────────────────────────────────────

  _onTTSAudio(b64, isFinal) {
    if (this.bargeIn.isGreeting && !this.firstAudioLogged) {
      this.firstAudioLogged = true;
      console.log(`[Net] Greeting TTS first byte: ${Date.now() - this.startTime}ms after start`);
    } else if (this.currentTurnStart && !this.firstAudioLogged) {
      this.firstAudioLogged = true;
      console.log(`[Net] TTS first byte: ${Date.now() - this.currentTurnStart}ms`);
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
    });
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
import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import { TelephonyProvider } from '../../core/interfaces.js';
import { TwilioTransport } from './TwilioTransport.js';

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
    let sanitizedContext = null;
    if (context && typeof context === 'object') {
      try {
        sanitizedContext = JSON.parse(JSON.stringify(context));
      } catch (err) {
        throw new Error(`Invalid context payload: ${err.message}`);
      }
    }

    const call = await this.client.calls.create({
      to: to.trim(),
      from: this.fromNumber,
      url: `https://${this.domain}/voice`,
      machineDetection: machineDetection ? 'Enable' : undefined,
      asyncAmd: machineDetection ? 'true' : undefined,
    });
    if (sanitizedContext) {
      this.callContexts.set(call.sid, sanitizedContext);
    }
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
        const context = this.callContexts.get(callSid);
        const pipeline = this.pipelineFactory(context);
        const prewarmPromise = pipeline.prewarm();
        this.prewarmed.set(callSid, { pipeline, prewarmPromise });
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
      let customerStream = null;
      let botStream = null;

      const recordingsDir = path.join(process.cwd(), 'recordings');
      if (!fs.existsSync(recordingsDir)) {
        fs.mkdirSync(recordingsDir, { recursive: true });
      }

      ws.on('message', async (raw) => {
        const data = JSON.parse(raw.toString());

        if (data.event === 'start') {
          const streamSid = data.start.streamSid;
          const callSid = data.start.callSid;
          req.log.info({ streamSid, callSid }, 'call started');

          customerStream = fs.createWriteStream(path.join(recordingsDir, `${callSid}-customer.raw`));
          botStream = fs.createWriteStream(path.join(recordingsDir, `${callSid}-bot.raw`));

          const pre = this.prewarmed.get(callSid);
          if (pre) {
            pipeline = pre.pipeline;
            await pre.prewarmPromise;
            this.prewarmed.delete(callSid);
            this.callContexts.delete(callSid);
            console.log(`[Pre-warm] Using pre-warmed pipeline for ${callSid}`);
          } else {
            const context = this.callContexts.get(callSid);
            pipeline = this.pipelineFactory(context);
            this.callContexts.delete(callSid);
            await pipeline.prewarm();
          }

          transport = new TwilioTransport(ws, streamSid);
          
          transport.on('outboundMedia', (b64) => {
            if (botStream) {
              botStream.write(Buffer.from(b64, 'base64'));
            }
          });

          pipeline.attachTransport(transport);
          pipeline.start({ callSid, streamSid });
        }

        if (data.event === 'media' && pipeline && pipeline.isStarted) {
          if (!firstMediaLogged && pipeline.startTime) {
            firstMediaLogged = true;
            console.log(`[Net] Twilio→server first media: ${Date.now() - pipeline.startTime}ms`);
          }
          if (customerStream && data.media?.payload) {
            customerStream.write(Buffer.from(data.media.payload, 'base64'));
          }
          pipeline.handleIncomingAudio(data.media.payload);
        }

        if (data.event === 'mark' && transport) {
          transport.emit('mark', data.mark?.name);
        }

        if (data.event === 'stop' && pipeline) {
          pipeline.stop();
          customerStream?.end();
          botStream?.end();
        }
      });

      ws.on('close', () => {
        pipeline?.stop();
        customerStream?.end();
        botStream?.end();
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
                inactivityTimeout = 180, onAudio, onOpen }) {
    super({ onAudio });
    this.apiKey = apiKey;
    this.voiceId = voiceId;
    this.model = model;
    this.outputFormat = outputFormat;
    this.optimizeStreamingLatency = optimizeStreamingLatency;
    this.inactivityTimeout = inactivityTimeout;
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
          voice_settings: { stability: 0.45, similarity_boost: 0.8 },
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
    try { this.ws?.close(); } catch {}
  }

  // Static REST prefetch for filler cache (independent of WS lifecycle)
  static async prefetch({ apiKey, voiceId, model, outputFormat, text }) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${outputFormat}`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: model, voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
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
    `- Be direct, friendly, and helpful.`,

  // Greeting played on call connect (Shortened to sound human)
  greeting: (ctx) =>
    `Hi, this is Krish from LinenGrass. Is this ${ctx.contactName || 'the manager'}?`,

  // Cached filler phrases to mask LLM latency
  fillers: [
    'Let me check that.',
    'One second.',
    'Okay, let me see.',
    'Sure, let me check your last order details.',
  ],

  // ── Provider config (swap any of these) ────────────────
  providers: {
    stt: {
      name: 'elevenlabs',
      model: 'scribe_v2_realtime',
      language: null, // Enable auto-detection of language (English/Hindi/Kannada)
      audioFormat: 'ulaw_8000',
      vadSilenceThresholdSecs: 1.25,
      vadThreshold: 0.90,
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
      model: 'llama-3.1-8b-instant',
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
      vadSilenceThresholdSecs: 1.25,
      vadThreshold: 0.90,
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
      model: 'llama-3.1-8b-instant',
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

export async function createServer({ telephony, port = 3000 }) {
  const app = Fastify({ logger: true });
  await app.register(fastifyWs);

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
  app.all('/voice', telephony.webhookHandler());

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

