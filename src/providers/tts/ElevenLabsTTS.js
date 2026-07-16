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
      this.ws = new WebSocket(url, { headers: { 'xi-api-key': this.apiKey } });

      this.ws.on('open', () => {
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
        if (!this.isClosedExplicitly && (c === 1006 || c === 1005)) {
          console.log('[TTS] Reconnecting in 1s...');
          setTimeout(() => this.connect(), 1000);
        }
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
