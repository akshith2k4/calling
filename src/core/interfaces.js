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
