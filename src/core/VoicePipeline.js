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
    if (this.callSid) {
      logEvent(this.callSid, 'stt_connect', { timestamp: Date.now() });
    }
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

        // Estimate filler duration (approx 2.5 words per second)
        const wordCount = fillerText.trim().split(/\s+/).length;
        this.lastFillerPlayTime = Math.round((wordCount / 2.5) * 1000);
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

    this.conversation.pushAssistant(full);
    this.cost.trackLLM(this.conversation.toJSON(), full);
    console.log(`[LLM] Response: "${full}"`);
    if (this.callSid) {
      logEvent(this.callSid, 'llm_response', { text: full });
    }
  }

  // ─── TTS Callbacks ───────────────────────────────────────

  _onTTSAudio(b64, isFinal) {
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
      const fillerMs = this.lastFillerPlayTime || 0;
      const perceivedMs = latencyMs + fillerMs;

      if (this.callSid) {
        logEvent(this.callSid, 'true_voice_latency', { 
          ms: latencyMs,
          fillerMs,
          perceivedMs
        });
      }
      console.log(`[Latency] True Voice Latency: ${latencyMs}ms (filler: ${fillerMs}ms, perceived: ${perceivedMs}ms)`);
      
      const latency = Date.now() - this.currentTurnStart;
      if (this.callSid) {
        logEvent(this.callSid, 'tts_first_byte', { latency, type: 'turn' });
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
